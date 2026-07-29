// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FixedPointMath
 * @notice 18-decimal fixed-point helpers used across the platform.
 * @dev WAD = 1e18. All math in WAD to avoid floating-point drift.
 *      Functions guarded against overflow and divide-by-zero.
 */
library FixedPointMath {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant HALF_WAD = WAD / 2;

    error DivByZero();
    error Overflow();

    /**
     * @notice Multiply two WAD values, rounding half up.
     */
    function wadMul(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0 || b == 0) return 0;
        unchecked {
            // (a * b + WAD/2) / WAD
            uint256 product = a * b;
            if (product / a != b) revert Overflow();
            return (product + HALF_WAD) / WAD;
        }
    }

    /**
     * @notice Divide two WAD values, rounding half up.
     */
    function wadDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        if (b == 0) revert DivByZero();
        unchecked {
            // (a * WAD + b/2) / b
            uint256 numerator = a * WAD;
            if (numerator / WAD != a) revert Overflow();
            return (numerator + b / 2) / b;
        }
    }

    /**
     * @notice Full-precision mulDiv, equivalent to OZ Math.mulDiv.
     */
    function mulDiv(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            uint256 prod0;
            uint256 prod1;
            assembly {
                let mm := mulmod(x, y, not(0))
                prod0 := mul(x, y)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) {
                require(denominator > 0, "mulDiv: zero denom");
                return prod0 / denominator;
            }
            require(denominator > prod1, "mulDiv: overflow");
            uint256 remainder;
            assembly {
                remainder := mulmod(x, y, denominator)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }
            uint256 twos = denominator & (~denominator + 1);
            assembly {
                denominator := div(denominator, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;
            uint256 inverse = (3 * denominator) ^ 2;
            for (uint256 i; i < 6; ++i) inverse *= 2 - denominator * inverse;
            return prod0 * inverse;
        }
    }

    /**
     * @notice Clamp x into [lo, hi].
     */
    function clamp(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return x < lo ? lo : (x > hi ? hi : x);
    }

    /**
     * @notice Integer square root (Babylonian).
     */
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
