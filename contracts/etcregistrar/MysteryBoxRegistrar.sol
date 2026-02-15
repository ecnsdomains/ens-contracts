// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BaseRegistrarImplementation} from "./BaseRegistrarImplementation.sol";
import {IPriceOracle} from "./IPriceOracle.sol";
import {IMysteryBoxRegistrar} from "./IMysteryBoxRegistrar.sol";

/// @title MysteryBoxRegistrar
/// @notice Gamified random name registration for ECNS.
///         Users commit-reveal to pull random names from tiered pools.
///         Supports single pulls and bulk packs (10, 25, 50, 100).
///         Pool names are reserved on ETCRegistrarController to block direct purchase.
///         This contract is added as a controller on BaseRegistrar to mint NFTs.
contract MysteryBoxRegistrar is IMysteryBoxRegistrar, Ownable {

    // =========================================================================
    // State
    // =========================================================================

    struct NamePool {
        string[] labels;
        uint256 remaining;
    }

    struct Commitment {
        BoxTier tier;
        uint8 quantity;
        uint256 timestamp;
        uint256 blockNumber;
    }

    /// @notice The base registrar that mints NFTs
    BaseRegistrarImplementation public immutable base;

    /// @notice The price oracle for USD → ETC conversion
    IPriceOracle public immutable priceOracle;

    /// @notice Name pools per tier
    mapping(BoxTier => NamePool) private pools;

    /// @notice Commit-reveal commitments
    mapping(bytes32 => Commitment) public commitments;

    /// @notice Minimum time between commit and reveal (seconds)
    uint256 public constant MIN_COMMITMENT_AGE = 60;

    /// @notice Maximum time a commitment stays valid (seconds)
    uint256 public constant MAX_COMMITMENT_AGE = 86400;

    /// @notice Registration duration for mystery names (1 year)
    uint256 public constant REGISTRATION_DURATION = 365 days;

    /// @notice Pool low-water mark for PoolLow event
    uint256 public constant POOL_LOW_THRESHOLD = 100;

    /// @notice USD prices per tier (in cents, to avoid decimals)
    /// Standard: $2 = 200 cents, Premium: $10 = 1000 cents, Elite: $50 = 5000 cents
    uint256[3] public tierPriceCents = [200, 1000, 5000];

    /// @notice Valid bulk quantities
    uint8[5] public VALID_QUANTITIES = [1, 10, 25, 50, 100];

    /// @notice Discount basis points per quantity tier (0%, 10%, 15%, 20%, 25%)
    uint16[5] public DISCOUNT_BPS = [0, 1000, 1500, 2000, 2500];

    // =========================================================================
    // Errors
    // =========================================================================

    error InvalidQuantity(uint8 quantity);
    error CommitmentNotFound();
    error CommitmentTooNew(uint256 commitTime, uint256 currentTime);
    error CommitmentTooOld(uint256 commitTime, uint256 currentTime);
    error CommitmentAlreadyExists();
    error InsufficientPayment(uint256 required, uint256 sent);
    error PoolEmpty(BoxTier tier);
    error PoolInsufficient(BoxTier tier, uint256 requested, uint256 available);

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(address _base, address _priceOracle) {
        base = BaseRegistrarImplementation(_base);
        priceOracle = IPriceOracle(_priceOracle);
    }

    // =========================================================================
    // Single commit-reveal
    // =========================================================================

    /// @notice Commit to a single mystery box pull
    function commit(BoxTier tier, bytes32 secret) external override {
        bytes32 commitHash = _makeCommitHash(msg.sender, tier, 1, secret);
        if (commitments[commitHash].timestamp != 0) revert CommitmentAlreadyExists();

        commitments[commitHash] = Commitment({
            tier: tier,
            quantity: 1,
            timestamp: block.timestamp,
            blockNumber: block.number
        });

        emit BoxCommitted(msg.sender, tier, 1, commitHash);
    }

    /// @notice Reveal a single mystery box pull
    function reveal(BoxTier tier, bytes32 secret) external payable override
        returns (string memory label, uint256 tokenId)
    {
        bytes32 commitHash = _makeCommitHash(msg.sender, tier, 1, secret);
        _validateCommitment(commitHash);

        uint256 price = getPrice(tier, 1);
        if (msg.value < price) revert InsufficientPayment(price, msg.value);

        Commitment memory c = commitments[commitHash];
        delete commitments[commitHash];

        // Pull random name from pool
        bytes32 entropy = keccak256(abi.encodePacked(secret, blockhash(c.blockNumber + 1), msg.sender));
        label = _pullFromPool(tier, entropy);

        // Register via BaseRegistrar
        uint256 id = uint256(keccak256(bytes(label)));
        base.registerWithLabel(id, msg.sender, REGISTRATION_DURATION, label);
        tokenId = id;

        emit BoxRevealed(msg.sender, tier, label, tokenId);

        // Refund excess
        if (msg.value > price) {
            (bool ok, ) = msg.sender.call{value: msg.value - price}("");
            require(ok, "Refund failed");
        }
    }

    // =========================================================================
    // Bulk commit-reveal
    // =========================================================================

    /// @notice Commit to a bulk mystery box pull
    function commitBatch(BoxTier tier, uint8 quantity, bytes32 secret) external override {
        _validateQuantity(quantity);
        bytes32 commitHash = _makeCommitHash(msg.sender, tier, quantity, secret);
        if (commitments[commitHash].timestamp != 0) revert CommitmentAlreadyExists();

        commitments[commitHash] = Commitment({
            tier: tier,
            quantity: quantity,
            timestamp: block.timestamp,
            blockNumber: block.number
        });

        emit BoxCommitted(msg.sender, tier, quantity, commitHash);
    }

    /// @notice Reveal a bulk mystery box pull
    function revealBatch(BoxTier tier, uint8 quantity, bytes32 secret) external payable override
        returns (string[] memory labels, uint256[] memory tokenIds)
    {
        _validateQuantity(quantity);
        bytes32 commitHash = _makeCommitHash(msg.sender, tier, quantity, secret);
        _validateCommitment(commitHash);

        uint256 price = getPrice(tier, quantity);
        if (msg.value < price) revert InsufficientPayment(price, msg.value);

        Commitment memory c = commitments[commitHash];
        delete commitments[commitHash];

        NamePool storage pool = pools[tier];
        if (pool.remaining < quantity) revert PoolInsufficient(tier, quantity, pool.remaining);

        labels = new string[](quantity);
        tokenIds = new uint256[](quantity);

        for (uint8 i = 0; i < quantity; i++) {
            // Sequential entropy: each name gets unique randomness
            bytes32 entropy = keccak256(abi.encodePacked(secret, blockhash(c.blockNumber + 1), msg.sender, i));
            labels[i] = _pullFromPool(tier, entropy);

            uint256 id = uint256(keccak256(bytes(labels[i])));
            base.registerWithLabel(id, msg.sender, REGISTRATION_DURATION, labels[i]);
            tokenIds[i] = id;

            emit BoxRevealed(msg.sender, tier, labels[i], id);
        }

        emit BatchRevealed(msg.sender, tier, quantity, tokenIds);

        // Refund excess
        if (msg.value > price) {
            (bool ok, ) = msg.sender.call{value: msg.value - price}("");
            require(ok, "Refund failed");
        }
    }

    // =========================================================================
    // Pricing
    // =========================================================================

    /// @notice Get the ETC price for a mystery box purchase
    /// @param tier The box tier (Standard, Premium, Elite)
    /// @param quantity Number of boxes (1, 10, 25, 50, or 100)
    /// @return etcAmount The total price in wei
    function getPrice(BoxTier tier, uint8 quantity) public view override returns (uint256 etcAmount) {
        uint256 unitPriceCents = tierPriceCents[uint8(tier)];
        uint256 totalCents = unitPriceCents * quantity;

        // Apply bulk discount
        uint16 discountBps = _getDiscountBps(quantity);
        totalCents = totalCents * (10000 - discountBps) / 10000;

        // Convert USD cents to ETC via price oracle
        // The oracle's price() returns the ETC cost for a name — we use a dummy call
        // to get the USD/ETC rate, then scale. The oracle returns Price{base, premium}
        // for a 1-year registration. We use a known baseline to derive the rate.
        //
        // Alternative: direct oracle query for $1 equivalent.
        // For now, use a simpler approach: the Standard tier ($2) for a 5-char name
        // costs $5/yr via direct registration. The oracle gives us $5 in ETC for
        // a 5-char, 1-year registration. We scale from there.
        //
        // $5/yr direct = oracle.price("aaaaa", 0, 365 days).base
        // So $1 in ETC = oracle.price("aaaaa", 0, 365 days).base / 5
        // And our cost = totalCents/100 * ($1 in ETC)

        IPriceOracle.Price memory oraclePrice = priceOracle.price("aaaaa", 0, REGISTRATION_DURATION);
        uint256 fiveDollarsInEtc = oraclePrice.base; // This is $5/yr for 5+ char
        // $1 in ETC = fiveDollarsInEtc / 500 (500 cents = $5)
        // totalCents * (fiveDollarsInEtc / 500)
        etcAmount = (totalCents * fiveDollarsInEtc) / 500;
    }

    // =========================================================================
    // Pool management (admin)
    // =========================================================================

    /// @notice Seed names into a pool. Owner only.
    function seedPool(BoxTier tier, string[] calldata labels) external onlyOwner {
        NamePool storage pool = pools[tier];
        for (uint256 i = 0; i < labels.length; i++) {
            pool.labels.push(labels[i]);
        }
        pool.remaining += labels.length;

        emit PoolSeeded(tier, labels.length, pool.remaining);
    }

    /// @notice Get remaining names in a pool
    function poolRemaining(BoxTier tier) external view override returns (uint256) {
        return pools[tier].remaining;
    }

    /// @notice Withdraw collected ETC. Owner only.
    function withdraw() external onlyOwner {
        (bool ok, ) = owner().call{value: address(this).balance}("");
        require(ok, "Withdraw failed");
    }

    /// @notice Update tier pricing. Owner only.
    function setTierPrice(BoxTier tier, uint256 priceCents) external onlyOwner {
        tierPriceCents[uint8(tier)] = priceCents;
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    function _makeCommitHash(
        address sender,
        BoxTier tier,
        uint8 quantity,
        bytes32 secret
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(sender, tier, quantity, secret));
    }

    function _validateCommitment(bytes32 commitHash) internal view {
        Commitment memory c = commitments[commitHash];
        if (c.timestamp == 0) revert CommitmentNotFound();
        if (block.timestamp < c.timestamp + MIN_COMMITMENT_AGE) {
            revert CommitmentTooNew(c.timestamp, block.timestamp);
        }
        if (block.timestamp > c.timestamp + MAX_COMMITMENT_AGE) {
            revert CommitmentTooOld(c.timestamp, block.timestamp);
        }
    }

    function _validateQuantity(uint8 quantity) internal pure {
        if (quantity != 1 && quantity != 10 && quantity != 25 && quantity != 50 && quantity != 100) {
            revert InvalidQuantity(quantity);
        }
    }

    function _getDiscountBps(uint8 quantity) internal pure returns (uint16) {
        if (quantity >= 100) return 2500; // 25%
        if (quantity >= 50)  return 2000; // 20%
        if (quantity >= 25)  return 1500; // 15%
        if (quantity >= 10)  return 1000; // 10%
        return 0;
    }

    /// @dev Pull a random name from a pool using swap-and-shrink.
    ///      The last element is swapped into the selected position, then remaining decremented.
    function _pullFromPool(BoxTier tier, bytes32 entropy) internal returns (string memory label) {
        NamePool storage pool = pools[tier];
        if (pool.remaining == 0) revert PoolEmpty(tier);

        uint256 idx = uint256(entropy) % pool.remaining;
        label = pool.labels[idx];

        // Swap with last active element
        pool.remaining--;
        if (idx < pool.remaining) {
            pool.labels[idx] = pool.labels[pool.remaining];
        }
        // Don't delete the last slot to save gas (it's past `remaining` now)

        // Emit low-pool warning
        if (pool.remaining > 0 && pool.remaining < POOL_LOW_THRESHOLD) {
            emit PoolLow(tier, pool.remaining);
        }
    }

    /// @dev Allow contract to receive ETC
    receive() external payable {}
}
