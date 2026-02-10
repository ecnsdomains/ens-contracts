//SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ETCswap V2 Price Oracle for ECNS
/// @notice Reads ETC/USD price from ETCswap V2 WETC/USC pool
/// @dev Returns price in Chainlink-compatible format (8 decimals)
contract ETCswapV2Oracle is Ownable {
    /// @notice The ETCswap V2 pair contract
    IETCswapV2Pair public immutable pair;

    /// @notice Whether WETC is token0 in the pair
    bool public immutable wetcIsToken0;

    /// @notice USC has 6 decimals, WETC has 18 decimals
    /// @dev Price = USC_reserve / WETC_reserve, adjusted for decimals
    uint256 private constant USC_DECIMALS = 6;
    uint256 private constant WETC_DECIMALS = 18;
    uint256 private constant PRICE_DECIMALS = 8; // Chainlink standard

    /// @notice Minimum liquidity required for a valid price (in USC, 6 decimals)
    /// @dev Default: 100 USC minimum liquidity
    uint256 public minLiquidity = 100 * 10**USC_DECIMALS;

    error InsufficientLiquidity();

    constructor(address _pair, bool _wetcIsToken0) {
        pair = IETCswapV2Pair(_pair);
        wetcIsToken0 = _wetcIsToken0;
    }

    /// @notice Returns the latest ETC/USD price
    /// @return price in 8 decimal format (e.g., 2000000000 = $20.00)
    function latestAnswer() external view returns (int256) {
        (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();

        uint256 uscReserve;
        uint256 wetcReserve;

        if (wetcIsToken0) {
            wetcReserve = uint256(reserve0);
            uscReserve = uint256(reserve1);
        } else {
            uscReserve = uint256(reserve0);
            wetcReserve = uint256(reserve1);
        }

        // Ensure minimum liquidity
        if (uscReserve < minLiquidity) revert InsufficientLiquidity();

        // Calculate price: (USC_reserve / WETC_reserve) adjusted for decimals
        // USC has 6 decimals, WETC has 18 decimals, output needs 8 decimals
        // price = (uscReserve * 10^(18 - 6 + 8)) / wetcReserve
        // price = (uscReserve * 10^20) / wetcReserve
        uint256 price = (uscReserve * 10**(WETC_DECIMALS - USC_DECIMALS + PRICE_DECIMALS)) / wetcReserve;

        return int256(price);
    }

    /// @notice Update minimum liquidity requirement
    /// @param _minLiquidity New minimum in USC (6 decimals)
    function setMinLiquidity(uint256 _minLiquidity) external onlyOwner {
        minLiquidity = _minLiquidity;
    }
}

interface IETCswapV2Pair {
    function getReserves() external view returns (
        uint112 reserve0,
        uint112 reserve1,
        uint32 blockTimestampLast
    );
    function token0() external view returns (address);
    function token1() external view returns (address);
}
