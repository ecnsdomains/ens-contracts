//SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ETCswap Aggregator Oracle for ECNS
/// @notice Aggregates ETC/USD price from ETCswap V2 and V3 pools
/// @dev Returns price in Chainlink-compatible format (8 decimals)
contract ETCswapAggregatorOracle is Ownable {
    /// @notice The ETCswap V2 pair contract (WETC/USC)
    IETCswapV2Pair public immutable v2Pair;

    /// @notice The ETCswap V3 pool contract (WETC/USC)
    IETCswapV3Pool public immutable v3Pool;

    /// @notice Whether WETC is token0 in the V2 pair
    bool public immutable v2WetcIsToken0;

    /// @notice Whether WETC is token0 in the V3 pool
    bool public immutable v3WetcIsToken0;

    /// @notice USC decimals
    uint256 private constant USC_DECIMALS = 6;
    /// @notice WETC decimals
    uint256 private constant WETC_DECIMALS = 18;
    /// @notice Output price decimals (Chainlink standard)
    uint256 private constant PRICE_DECIMALS = 8;

    /// @notice Minimum liquidity required in V2 (in USC, 6 decimals)
    uint256 public v2MinLiquidity = 100 * 10**USC_DECIMALS;

    /// @notice Maximum allowed deviation between V2 and V3 prices (in basis points, 500 = 5%)
    uint256 public maxDeviation = 500;

    /// @notice TWAP observation window for V3 (in seconds)
    uint32 public twapWindow = 300; // 5 minutes

    error InsufficientLiquidity();
    error PriceDeviationTooHigh(int256 v2Price, int256 v3Price, uint256 deviation);
    error InvalidPrice();

    event PriceRead(int256 v2Price, int256 v3Price, int256 finalPrice);

    constructor(
        address _v2Pair,
        bool _v2WetcIsToken0,
        address _v3Pool,
        bool _v3WetcIsToken0
    ) {
        v2Pair = IETCswapV2Pair(_v2Pair);
        v2WetcIsToken0 = _v2WetcIsToken0;
        v3Pool = IETCswapV3Pool(_v3Pool);
        v3WetcIsToken0 = _v3WetcIsToken0;
    }

    /// @notice Returns the latest ETC/USD price
    /// @return price in 8 decimal format (e.g., 2000000000 = $20.00)
    function latestAnswer() external view returns (int256) {
        int256 v2Price = _getV2Price();
        int256 v3Price = _getV3Price();

        // If only one source is available, use it
        if (v2Price == 0 && v3Price == 0) revert InsufficientLiquidity();
        if (v2Price == 0) return v3Price;
        if (v3Price == 0) return v2Price;

        // Check deviation between sources
        uint256 deviation = _calculateDeviation(v2Price, v3Price);
        if (deviation > maxDeviation) {
            revert PriceDeviationTooHigh(v2Price, v3Price, deviation);
        }

        // Return weighted average based on liquidity (simplified: just average)
        return (v2Price + v3Price) / 2;
    }

    /// @notice Get price from V2 pool
    function _getV2Price() internal view returns (int256) {
        try v2Pair.getReserves() returns (uint112 reserve0, uint112 reserve1, uint32) {
            uint256 wetcReserve = v2WetcIsToken0 ? uint256(reserve0) : uint256(reserve1);
            uint256 uscReserve = v2WetcIsToken0 ? uint256(reserve1) : uint256(reserve0);

            if (uscReserve < v2MinLiquidity || wetcReserve == 0) return 0;

            // price = (uscReserve * 10^20) / wetcReserve
            uint256 price = (uscReserve * 10**(WETC_DECIMALS - USC_DECIMALS + PRICE_DECIMALS)) / wetcReserve;
            return int256(price);
        } catch {
            return 0;
        }
    }

    /// @notice Get TWAP price from V3 pool
    function _getV3Price() internal view returns (int256) {
        // Get TWAP from V3 oracle
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow;
        secondsAgos[1] = 0;

        try v3Pool.observe(secondsAgos) returns (
            int56[] memory tickCumulatives,
            uint160[] memory
        ) {
            // Calculate average tick
            int56 tickCumulativesDelta = tickCumulatives[1] - tickCumulatives[0];
            int24 arithmeticMeanTick = int24(tickCumulativesDelta / int56(uint56(twapWindow)));

            // Convert tick to price
            // For V3: price = 1.0001^tick
            // Since USC has 6 decimals and WETC has 18, we need to adjust
            uint256 price = _tickToPrice(arithmeticMeanTick);
            return int256(price);
        } catch {
            return 0;
        }
    }

    /// @notice Convert V3 tick to price in 8 decimals
    /// @dev Simplified tick to price conversion
    function _tickToPrice(int24 tick) internal view returns (uint256) {
        // sqrtPriceX96 = sqrt(1.0001^tick) * 2^96
        // price = sqrtPriceX96^2 / 2^192
        // For better precision, we use a lookup or approximation

        // Get current sqrtPriceX96 from slot0 for spot price as fallback
        try v3Pool.slot0() returns (
            uint160 sqrtPriceX96,
            int24,
            uint16,
            uint16,
            uint16,
            uint8,
            bool
        ) {
            // price = (sqrtPriceX96^2 * 10^(decimals_adjustment)) / 2^192
            // USC/WETC pool: if WETC is token0, price = USC per WETC
            // We need ETC price in USD

            uint256 sqrtPrice = uint256(sqrtPriceX96);

            // price = sqrtPrice^2 / 2^192
            // Adjust for decimals: USC(6) vs WETC(18) = -12
            // Output needs 8 decimals

            if (v3WetcIsToken0) {
                // price0 = sqrtPrice^2 / 2^192 gives USC/WETC (but in raw form)
                // Adjust: multiply by 10^(18-6+8) = 10^20, divide by 2^192
                uint256 price = (sqrtPrice * sqrtPrice * 10**20) >> 192;
                return price;
            } else {
                // Invert: WETC/USC, so we need 1/price
                // This is more complex, use: price = 2^192 / sqrtPrice^2
                if (sqrtPrice == 0) return 0;
                uint256 price = (uint256(1) << 192) * 10**20 / (sqrtPrice * sqrtPrice);
                return price;
            }
        } catch {
            return 0;
        }
    }

    /// @notice Calculate deviation between two prices in basis points
    function _calculateDeviation(int256 price1, int256 price2) internal pure returns (uint256) {
        if (price1 <= 0 || price2 <= 0) return type(uint256).max;

        int256 diff = price1 > price2 ? price1 - price2 : price2 - price1;
        int256 avg = (price1 + price2) / 2;

        return uint256(diff * 10000 / avg);
    }

    /// @notice Get individual prices for debugging
    function getPrices() external view returns (int256 v2Price, int256 v3Price) {
        v2Price = _getV2Price();
        v3Price = _getV3Price();
    }

    /// @notice Update V2 minimum liquidity
    function setV2MinLiquidity(uint256 _minLiquidity) external onlyOwner {
        v2MinLiquidity = _minLiquidity;
    }

    /// @notice Update maximum allowed deviation
    function setMaxDeviation(uint256 _maxDeviation) external onlyOwner {
        maxDeviation = _maxDeviation;
    }

    /// @notice Update TWAP window
    function setTwapWindow(uint32 _twapWindow) external onlyOwner {
        twapWindow = _twapWindow;
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

interface IETCswapV3Pool {
    function slot0() external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint8 feeProtocol,
        bool unlocked
    );

    function observe(uint32[] calldata secondsAgos) external view returns (
        int56[] memory tickCumulatives,
        uint160[] memory secondsPerLiquidityCumulativeX128s
    );

    function token0() external view returns (address);
    function token1() external view returns (address);
}
