//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {BaseRegistrarImplementation} from "./BaseRegistrarImplementation.sol";
import {StringUtils} from "../utils/StringUtils.sol";
import {Resolver} from "../resolvers/Resolver.sol";
import {ECNS} from "../registry/ECNS.sol";
import {IReverseRegistrar} from "../reverseRegistrar/IReverseRegistrar.sol";
import {IDefaultReverseRegistrar} from "../reverseRegistrar/IDefaultReverseRegistrar.sol";
import {IETCRegistrarController, IPriceOracle} from "./IETCRegistrarController.sol";
import {ERC20Recoverable} from "../utils/ERC20Recoverable.sol";

/// @dev A registrar controller for registering and renewing names at fixed cost.
contract ETCRegistrarController is
    Ownable,
    IETCRegistrarController,
    ERC165,
    ERC20Recoverable
{
    using StringUtils for *;

    /// @notice The bitmask for the Ethereum reverse record.
    uint8 constant REVERSE_RECORD_ETHEREUM_BIT = 1;

    /// @notice The bitmask for the default reverse record.
    uint8 constant REVERSE_RECORD_DEFAULT_BIT = 2;

    /// @notice The minimum duration for a registration.
    uint256 public constant MIN_REGISTRATION_DURATION = 28 days;

    // @notice The node (i.e. namehash) for the .etc TLD.
    bytes32 private constant ETC_NODE =
        0x2f142013fcc88d47bffe42e5d883f6081cbaa75abaa20e7f34f3043bbc8162c9;

    /// @notice The maximum expiry time for a registration.
    uint64 private constant MAX_EXPIRY = type(uint64).max;

    /// @notice The ENS registry.
    ECNS public immutable ecns;

    // @notice The base registrar implementation for the eth TLD.
    BaseRegistrarImplementation immutable base;

    /// @notice The minimum time a commitment must exist to be valid.
    uint256 public immutable minCommitmentAge;

    /// @notice The maximum time a commitment can exist to be valid.
    uint256 public immutable maxCommitmentAge;

    /// @notice The registrar for addr.reverse. (i.e. reverse for coinType 60)
    IReverseRegistrar public immutable reverseRegistrar;

    /// @notice The registrar for default.reverse. (i.e. fallback reverse for all EVM chains)
    IDefaultReverseRegistrar public immutable defaultReverseRegistrar;

    /// @notice The price oracle for the eth TLD.
    IPriceOracle public immutable prices;

    /// @notice A mapping of commitments to their timestamp.
    mapping(bytes32 => uint256) public commitments;

    /// @notice A mapping of reserved label hashes that cannot be registered.
    mapping(bytes32 => bool) public reservedNames;

    /// @notice Thrown when a commitment is not found.
    error CommitmentNotFound(bytes32 commitment);

    /// @notice Thrown when a commitment is too new.
    error CommitmentTooNew(
        bytes32 commitment,
        uint256 minimumCommitmentTimestamp,
        uint256 currentTimestamp
    );

    /// @notice Thrown when a commitment is too old.
    error CommitmentTooOld(
        bytes32 commitment,
        uint256 maximumCommitmentTimestamp,
        uint256 currentTimestamp
    );

    /// @notice Thrown when a name is not available to register.
    error NameNotAvailable(string name);

    /// @notice Thrown when a name is reserved and cannot be registered.
    error NameReserved(string name);

    /// @notice Thrown when the duration supplied for a registration is too short.
    error DurationTooShort(uint256 duration);

    /// @notice Thrown when data is supplied for a registration without a resolver.
    error ResolverRequiredWhenDataSupplied();

    /// @notice Thrown when a reverse record is requested without a resolver.
    error ResolverRequiredForReverseRecord();

    /// @notice Thrown when a matching unexpired commitment exists.
    error UnexpiredCommitmentExists(bytes32 commitment);

    /// @notice Thrown when the value sent for a registration is insufficient.
    error InsufficientValue();

    /// @notice Thrown when the maximum commitment age is too low.
    error MaxCommitmentAgeTooLow();

    /// @notice Thrown when the maximum commitment age is too high.
    error MaxCommitmentAgeTooHigh();

    /// @notice Emitted when a name is registered.
    ///
    /// @param label The label of the name.
    /// @param labelhash The keccak256 hash of the label.
    /// @param owner The owner of the name.
    /// @param baseCost The base cost of the name.
    /// @param premium The premium cost of the name.
    /// @param expires The expiry time of the name.
    /// @param referrer The referrer of the registration.
    event NameRegistered(
        string label,
        bytes32 indexed labelhash,
        address indexed owner,
        uint256 baseCost,
        uint256 premium,
        uint256 expires,
        bytes32 referrer
    );

    /// @notice Emitted when a name is renewed.
    ///
    /// @param label The label of the name.
    /// @param labelhash The keccak256 hash of the label.
    /// @param cost The cost of the name.
    /// @param expires The expiry time of the name.
    /// @param referrer The referrer of the registration.
    event NameRenewed(
        string label,
        bytes32 indexed labelhash,
        uint256 cost,
        uint256 expires,
        bytes32 referrer
    );

    /// @notice Emitted when a name is reserved.
    ///
    /// @param labelhash The keccak256 hash of the label.
    event NameReservedEvent(bytes32 indexed labelhash);

    /// @notice Emitted when a name is unreserved.
    ///
    /// @param labelhash The keccak256 hash of the label.
    event NameUnreserved(bytes32 indexed labelhash);

    /// @notice Constructor for the ETCRegistrarController.
    ///
    /// @param _base The base registrar implementation for the eth TLD.
    /// @param _prices The price oracle for the eth TLD.
    /// @param _minCommitmentAge The minimum time a commitment must exist to be valid.
    /// @param _maxCommitmentAge The maximum time a commitment can exist to be valid.
    /// @param _reverseRegistrar The registrar for addr.reverse.
    /// @param _defaultReverseRegistrar The registrar for default.reverse.
    /// @param _ecns The ENS registry.
    constructor(
        BaseRegistrarImplementation _base,
        IPriceOracle _prices,
        uint256 _minCommitmentAge,
        uint256 _maxCommitmentAge,
        IReverseRegistrar _reverseRegistrar,
        IDefaultReverseRegistrar _defaultReverseRegistrar,
        ECNS _ecns
    ) {
        if (_maxCommitmentAge <= _minCommitmentAge)
            revert MaxCommitmentAgeTooLow();

        if (_maxCommitmentAge > block.timestamp)
            revert MaxCommitmentAgeTooHigh();

        ecns = _ecns;
        base = _base;
        prices = _prices;
        minCommitmentAge = _minCommitmentAge;
        maxCommitmentAge = _maxCommitmentAge;
        reverseRegistrar = _reverseRegistrar;
        defaultReverseRegistrar = _defaultReverseRegistrar;
    }

    /// @notice Returns the price of a registration for the given label and duration.
    ///
    /// @param label The label of the name.
    /// @param duration The duration of the registration.
    /// @return price The price of the registration.
    function rentPrice(
        string calldata label,
        uint256 duration
    ) public view override returns (IPriceOracle.Price memory price) {
        bytes32 labelhash = keccak256(bytes(label));
        price = _rentPrice(label, labelhash, duration);
    }

    /// @notice Returns true if the label is valid for registration.
    ///
    /// @param label The label to check.
    /// @return True if the label is valid, false otherwise.
    function valid(string calldata label) public pure returns (bool) {
        return label.strlen() >= 3;
    }

    /// @notice Returns true if the label is valid and available for registration.
    ///
    /// @param label The label to check.
    /// @return True if the label is valid and available, false otherwise.
    function available(
        string calldata label
    ) public view override returns (bool) {
        bytes32 labelhash = keccak256(bytes(label));
        return _available(label, labelhash);
    }

    /// @notice Returns the commitment for a registration.
    ///
    /// @param registration The registration to make a commitment for.
    /// @return commitment The commitment for the registration.
    function makeCommitment(
        Registration calldata registration
    ) public pure override returns (bytes32 commitment) {
        if (registration.data.length > 0 && registration.resolver == address(0))
            revert ResolverRequiredWhenDataSupplied();

        if (
            registration.reverseRecord != 0 &&
            registration.resolver == address(0)
        ) revert ResolverRequiredForReverseRecord();

        if (registration.duration < MIN_REGISTRATION_DURATION)
            revert DurationTooShort(registration.duration);

        return keccak256(abi.encode(registration));
    }

    /// @notice Commits a registration.
    ///
    /// @param commitment The commitment to commit.
    function commit(bytes32 commitment) public override {
        if (commitments[commitment] + maxCommitmentAge >= block.timestamp) {
            revert UnexpiredCommitmentExists(commitment);
        }
        commitments[commitment] = block.timestamp;
    }

    /// @notice Registers a name.
    ///
    /// @param registration The registration to register.
    /// @param registration.label The label of the name.
    /// @param registration.owner The owner of the name.
    /// @param registration.duration The duration of the registration.
    /// @param registration.resolver The resolver for the name.
    /// @param registration.data The data for the name.
    /// @param registration.reverseRecord Which reverse record(s) to set.
    /// @param registration.referrer The referrer of the registration.
    function register(
        Registration calldata registration
    ) public payable override {
        bytes32 labelhash = keccak256(bytes(registration.label));
        IPriceOracle.Price memory price = _rentPrice(
            registration.label,
            labelhash,
            registration.duration
        );
        uint256 totalPrice = price.base + price.premium;
        if (msg.value < totalPrice) revert InsufficientValue();

        if (!_available(registration.label, labelhash))
            revert NameNotAvailable(registration.label);

        bytes32 commitment = makeCommitment(registration);
        uint256 commitmentTimestamp = commitments[commitment];

        // Require an old enough commitment.
        if (commitmentTimestamp + minCommitmentAge > block.timestamp)
            revert CommitmentTooNew(
                commitment,
                commitmentTimestamp + minCommitmentAge,
                block.timestamp
            );

        // If the commitment is too old, or the name is registered, stop
        if (commitmentTimestamp + maxCommitmentAge <= block.timestamp) {
            if (commitmentTimestamp == 0) revert CommitmentNotFound(commitment);
            revert CommitmentTooOld(
                commitment,
                commitmentTimestamp + maxCommitmentAge,
                block.timestamp
            );
        }

        delete (commitments[commitment]);

        uint256 expires;

        if (registration.resolver == address(0)) {
            expires = base.registerWithLabel(
                uint256(labelhash),
                registration.owner,
                registration.duration,
                registration.label
            );
        } else {
            expires = base.registerWithLabel(
                uint256(labelhash),
                address(this),
                registration.duration,
                registration.label
            );

            bytes32 namehash = keccak256(abi.encodePacked(ETC_NODE, labelhash));
            ecns.setRecord(
                namehash,
                registration.owner,
                registration.resolver,
                0
            );
            if (registration.data.length > 0)
                Resolver(registration.resolver).multicallWithNodeCheck(
                    namehash,
                    registration.data
                );

            base.transferFrom(
                address(this),
                registration.owner,
                uint256(labelhash)
            );

            if (registration.reverseRecord & REVERSE_RECORD_ETHEREUM_BIT != 0)
                reverseRegistrar.setNameForAddr(
                    msg.sender,
                    msg.sender,
                    registration.resolver,
                    string.concat(registration.label, ".etc")
                );
            if (registration.reverseRecord & REVERSE_RECORD_DEFAULT_BIT != 0)
                defaultReverseRegistrar.setNameForAddr(
                    msg.sender,
                    string.concat(registration.label, ".etc")
                );
        }

        emit NameRegistered(
            registration.label,
            labelhash,
            registration.owner,
            price.base,
            price.premium,
            expires,
            registration.referrer
        );

        if (msg.value > totalPrice)
            payable(msg.sender).transfer(msg.value - totalPrice);
    }

    /// @notice Renews a name.
    ///
    /// @param label The label of the name.
    /// @param duration The duration of the registration.
    /// @param referrer The referrer of the registration.
    function renew(
        string calldata label,
        uint256 duration,
        bytes32 referrer
    ) external payable override {
        bytes32 labelhash = keccak256(bytes(label));

        IPriceOracle.Price memory price = _rentPrice(
            label,
            labelhash,
            duration
        );
        if (msg.value < price.base) revert InsufficientValue();

        uint256 expires = base.renew(uint256(labelhash), duration);

        emit NameRenewed(label, labelhash, price.base, expires, referrer);

        if (msg.value > price.base)
            payable(msg.sender).transfer(msg.value - price.base);
    }

    /// @notice Withdraws the balance of the contract to the owner.
    function withdraw() public {
        payable(owner()).transfer(address(this).balance);
    }

    /// @notice Reserves a name so it cannot be registered.
    ///
    /// @param label The label to reserve.
    function reserveName(string calldata label) external onlyOwner {
        bytes32 labelhash = keccak256(bytes(label));
        reservedNames[labelhash] = true;
        emit NameReservedEvent(labelhash);
    }

    /// @notice Reserves multiple names at once.
    ///
    /// @param labels The labels to reserve.
    function reserveNames(string[] calldata labels) external onlyOwner {
        for (uint256 i = 0; i < labels.length; i++) {
            bytes32 labelhash = keccak256(bytes(labels[i]));
            reservedNames[labelhash] = true;
            emit NameReservedEvent(labelhash);
        }
    }

    /// @notice Unreserves a name so it can be registered.
    ///
    /// @param label The label to unreserve.
    function unreserveName(string calldata label) external onlyOwner {
        bytes32 labelhash = keccak256(bytes(label));
        reservedNames[labelhash] = false;
        emit NameUnreserved(labelhash);
    }

    /// @notice Returns true if a name is reserved.
    ///
    /// @param label The label to check.
    /// @return True if the name is reserved, false otherwise.
    function isReserved(string calldata label) public view returns (bool) {
        bytes32 labelhash = keccak256(bytes(label));
        return reservedNames[labelhash];
    }

    /// @inheritdoc IERC165
    function supportsInterface(
        bytes4 interfaceID
    ) public view override returns (bool) {
        return
            interfaceID == type(IETCRegistrarController).interfaceId ||
            super.supportsInterface(interfaceID);
    }

    /* Internal functions */

    function _rentPrice(
        string calldata label,
        bytes32 labelhash,
        uint256 duration
    ) internal view returns (IPriceOracle.Price memory price) {
        price = prices.price(
            label,
            base.nameExpires(uint256(labelhash)),
            duration
        );
    }

    function _available(
        string calldata label,
        bytes32 labelhash
    ) internal view returns (bool) {
        return valid(label) && !reservedNames[labelhash] && base.available(uint256(labelhash));
    }
}
