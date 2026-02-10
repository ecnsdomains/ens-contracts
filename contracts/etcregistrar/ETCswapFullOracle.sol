//SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ETCswap Full Oracle for ECNS
/// @notice Aggregates ETC/USD price from ETCswap V2, V3, and V4 pools
/// @dev Returns price in Chainlink-compatible format (8 decimals)
/// @dev V4 support is prepared for post-Olympia upgrade when EIP-1153 is available
contract ETCswapFullOracle is Ownable {
    // ============ V2 ============
    IETCswapV2Pair public immutable v2Pair;
    bool public immutable v2WetcIsToken0;

    // ============ V3 ============
    IETCswapV3Pool public immutable v3Pool;
    bool public immutable v3WetcIsToken0;

    // ============ V4 ============
    /// @notice V4 StateView for reading pool state (set when V4 launches)
    IStateView public v4StateView;
    /// @notice V4 PoolId for WETC/USC pool (set when V4 launches)
    bytes32 public v4PoolId;
    bool public v4WetcIsToken0;
    bool public v4Enabled;

    // ============ Constants ============
    uint256 private constant USC_DECIMALS = 6;
    uint256 private constant WETC_DECIMALS = 18;
    uint256 private constant PRICE_DECIMALS = 8;

    // ============ Configuration ============
    uint256 public v2MinLiquidity = 100 * 10**USC_DECIMALS;
    uint256 public maxDeviation = 1000; // 10% max deviation in basis points
    uint32 public twapWindow = 300; // 5 minutes for V3/V4 TWAP

    // ============ Errors ============
    error InsufficientLiquidity();
    error PriceDeviationTooHigh(int256[] prices, uint256 maxDev);
    error NoPriceAvailable();

    // ============ Events ============
    event V4Configured(address stateView, bytes32 poolId, bool wetcIsToken0);
    event PriceAggregated(int256 v2Price, int256 v3Price, int256 v4Price, int256 finalPrice);

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

    /// @notice Configure V4 after Olympia upgrade
    /// @param _stateView V4 StateView contract address
    /// @param _poolId V4 WETC/USC pool ID
    /// @param _wetcIsToken0 Whether WETC is token0 in the V4 pool
    function configureV4(
        address _stateView,
        bytes32 _poolId,
        bool _wetcIsToken0
    ) external onlyOwner {
        v4StateView = IStateView(_stateView);
        v4PoolId = _poolId;
        v4WetcIsToken0 = _wetcIsToken0;
        v4Enabled = true;
        emit V4Configured(_stateView, _poolId, _wetcIsToken0);
    }

    /// @notice Disable V4 (e.g., if pool lacks liquidity)
    function disableV4() external onlyOwner {
        v4Enabled = false;
    }

    /// @notice Returns the latest ETC/USD price
    /// @return price in 8 decimal format (e.g., 2000000000 = $20.00)
    function latestAnswer() external view returns (int256) {
        int256 v2Price = _getV2Price();
        int256 v3Price = _getV3Price();
        int256 v4Price = v4Enabled ? _getV4Price() : int256(0);

        // Collect valid prices
        uint256 validCount;
        int256 sum;
        int256[] memory prices = new int256[](3);

        if (v2Price > 0) {
            prices[validCount++] = v2Price;
            sum += v2Price;
        }
        if (v3Price > 0) {
            prices[validCount++] = v3Price;
            sum += v3Price;
        }
        if (v4Price > 0) {
            prices[validCount++] = v4Price;
            sum += v4Price;
        }

        if (validCount == 0) revert NoPriceAvailable();

        // Calculate average
        int256 avgPrice = sum / int256(validCount);

        // Sanity check: ensure no single price deviates too much from average
        for (uint256 i = 0; i < validCount; i++) {
            uint256 deviation = _calculateDeviation(prices[i], avgPrice);
            if (deviation > maxDeviation) {
                revert PriceDeviationTooHigh(prices, deviation);
            }
        }

        return avgPrice;
    }

    /// @notice Get V2 spot price from reserves
    function _getV2Price() internal view returns (int256) {
        if (address(v2Pair) == address(0)) return 0;

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

    /// @notice Get V3 price from slot0
    function _getV3Price() internal view returns (int256) {
        if (address(v3Pool) == address(0)) return 0;

        try v3Pool.slot0() returns (
            uint160 sqrtPriceX96,
            int24,
            uint16,
            uint16,
            uint16,
            uint8,
            bool
        ) {
            return _sqrtPriceToPrice(sqrtPriceX96, v3WetcIsToken0);
        } catch {
            return 0;
        }
    }

    /// @notice Get V4 price from StateView
    function _getV4Price() internal view returns (int256) {
        if (!v4Enabled || address(v4StateView) == address(0)) return 0;

        try v4StateView.getSlot0(v4PoolId) returns (
            uint160 sqrtPriceX96,
            int24,
            uint24,
            uint24
        ) {
            return _sqrtPriceToPrice(sqrtPriceX96, v4WetcIsToken0);
        } catch {
            return 0;
        }
    }

    /// @notice Convert sqrtPriceX96 to price with 8 decimals
    /// @dev Used for both V3 and V4 which use the same price encoding
    function _sqrtPriceToPrice(uint160 sqrtPriceX96, bool wetcIsToken0) internal pure returns (int256) {
        if (sqrtPriceX96 == 0) return 0;

        uint256 sqrtPrice = uint256(sqrtPriceX96);

        // V3/V4 price encoding: sqrtPriceX96 = sqrt(token1/token0) * 2^96
        // USC has 6 decimals, WETC has 18 decimals
        // We need: USD per ETC with 8 decimals

        if (wetcIsToken0) {
            // price0 = sqrtPrice^2 / 2^192 (gives USC per WETC in raw units)
            // Adjust: multiply by 10^(18-6+8) = 10^20, divide by 2^192
            uint256 price = (sqrtPrice * sqrtPrice * 10**20) >> 192;
            return int256(price);
        } else {
            // Inverted: price = 2^192 / sqrtPrice^2 * 10^20
            uint256 price = (uint256(1) << 192) * 10**20 / (sqrtPrice * sqrtPrice);
            return int256(price);
        }
    }

    /// @notice Calculate deviation between price and average in basis points
    function _calculateDeviation(int256 price, int256 avg) internal pure returns (uint256) {
        if (price <= 0 || avg <= 0) return type(uint256).max;

        int256 diff = price > avg ? price - avg : avg - price;
        return uint256(diff * 10000 / avg);
    }

    /// @notice Get individual prices for transparency/debugging
    function getPrices() external view returns (
        int256 v2Price,
        int256 v3Price,
        int256 v4Price,
        bool v4Active
    ) {
        v2Price = _getV2Price();
        v3Price = _getV3Price();
        v4Price = v4Enabled ? _getV4Price() : int256(0);
        v4Active = v4Enabled;
    }

    // ============ Admin Functions ============

    function setV2MinLiquidity(uint256 _minLiquidity) external onlyOwner {
        v2MinLiquidity = _minLiquidity;
    }

    function setMaxDeviation(uint256 _maxDeviation) external onlyOwner {
        maxDeviation = _maxDeviation;
    }

    function setTwapWindow(uint32 _twapWindow) external onlyOwner {
        twapWindow = _twapWindow;
    }
}

// ============ External Interfaces ============

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

/// @notice V4 StateView interface (for post-Olympia)
interface IStateView {
    function getSlot0(bytes32 poolId) external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint24 protocolFee,
        uint24 lpFee
    );
    function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity);
}
