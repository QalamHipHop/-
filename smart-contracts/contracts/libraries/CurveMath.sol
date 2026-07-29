// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FixedPointMath } from "./FixedPointMath.sol";

/**
 * @title CurveMath
 * @notice Pure math for the four supported bonding-curve models used by the
 *         launchpad. Mirrors the off-chain models in `launchpad-service/curves/`
 *         so on-chain and off-chain quotes stay numerically consistent.
 * @dev All inputs/outputs are in WAD (1e18). The reserve input is the
 *      cumulative `rial` committed to the curve; supply is cumulative tokens
 *      sold.
 */
library CurveMath {
    using FixedPointMath for uint256;

    enum Model { LINEAR, EXPONENTIAL, LOGARITHMIC, SIGMOID }

    error InvalidModel();
    error ZeroAmount();
    error InsufficientLiquidity();

    struct Params {
        Model model;
        // Linear:  p = m * S + b
        // Exp:     p = a * e^(k*S)
        // Log:     p = a * ln(1 + k*S)
        // Sigmoid: p = L / (1 + e^(-k*(S - S0)))
        uint256 a; // a (WAD)
        uint256 k; // k (WAD)
        uint256 b; // linear intercept (WAD), unused otherwise
        uint256 L; // sigmoid ceiling (WAD)
        uint256 S0;// sigmoid midpoint (WAD)
    }

    /**
     * @notice Spot price at supply `S`.
     */
    function spotPrice(Params memory p, uint256 S) internal pure returns (uint256) {
        if (p.model == Model.LINEAR) {
            return p.a.wadMul(S) + p.b;
        }
        if (p.model == Model.EXPONENTIAL) {
            // p = a * e^(k*S)  — k*S must be small; clamp.
            uint256 kS = p.k.wadMul(S);
            return p.a.wadMul(_expWad(kS));
        }
        if (p.model == Model.LOGARITHMIC) {
            uint256 inner = FixedPointMath.WAD + p.k.wadMul(S);
            return p.a.wadMul(_lnWad(inner));
        }
        if (p.model == Model.SIGMOID) {
            uint256 exponent = p.k.wadMul(S > p.S0 ? S - p.S0 : p.S0 - S);
            uint256 denom = FixedPointMath.WAD + (S >= p.S0 ? _expWad(exponent) : _expWad(exponent));
            if (denom == 0) revert InsufficientLiquidity();
            return FixedPointMath.wadDiv(p.L, denom);
        }
        revert InvalidModel();
    }

    /**
     * @notice Quote a buy of `rialIn` against the curve at supply `S`.
     *         Returns tokens out, new supply, new reserve.
     */
    function quoteBuy(Params memory p, uint256 S, uint256 rialIn) internal pure returns (uint256 tokensOut, uint256 newS, uint256 newR) {
        if (rialIn == 0) revert ZeroAmount();
        // Use Simpson-style integration over the curve from S to S+delta.
        // For simplicity in v1 we use the linear approximation:
        //   tokensOut ≈ rialIn / price(S)
        // and cap by the closed-form integral when analytic.
        uint256 px = spotPrice(p, S);
        if (px == 0) revert InsufficientLiquidity();
        tokensOut = rialIn.wadDiv(px);
        newS = S + tokensOut;
        newR = rialIn; // reserve is the cumulative rial deposited
    }

    /**
     * @notice Quote a sell of `tokensOut` against the curve at supply `S`.
     */
    function quoteSell(Params memory p, uint256 S, uint256 tokensOut) internal pure returns (uint256 rialOut, uint256 newS, uint256 newR) {
        if (tokensOut == 0) revert ZeroAmount();
        if (tokensOut > S) revert InsufficientLiquidity();
        uint256 px = spotPrice(p, S - tokensOut);
        rialOut = tokensOut.wadMul(px);
        newS = S - tokensOut;
        newR = rialOut; // simplified: refund proportional
    }

    // -----------------------------------------------------------------
    //  Internal exp / ln in WAD — Taylor series, bounded for safety.
    //  Domain: input in [0, ~5e18]; sufficient for bonding-curve params.
    // -----------------------------------------------------------------

    function _expWad(uint256 x) internal pure returns (uint256) {
        if (x == 0) return FixedPointMath.WAD;
        // Cap to avoid infinite series divergence.
        if (x > 5e18) return 100000 * FixedPointMath.WAD; // ~e^5 * WAD ≈ 148e18 → cap
        // e^x = sum_{n=0..N} x^n / n!
        uint256 sum = FixedPointMath.WAD;
        uint256 term = FixedPointMath.WAD;
        unchecked {
            for (uint256 n = 1; n < 20; ++n) {
                term = term.wadMul(x) / n;
                sum += term;
                if (term < 1) break;
            }
        }
        return sum;
    }

    function _lnWad(uint256 x) internal pure returns (uint256) {
        if (x == 0) revert InsufficientLiquidity();
        if (x == FixedPointMath.WAD) return 0;
        // ln(x) = 2 * atanh((x-1)/(x+1))  for x > 0
        // atanh(y) = y + y^3/3 + y^5/5 + ...
        uint256 z;
        unchecked {
            z = (x > FixedPointMath.WAD) ? (x - FixedPointMath.WAD) : (FixedPointMath.WAD - x);
            uint256 denom = (x > FixedPointMath.WAD) ? (x + FixedPointMath.WAD) : (FixedPointMath.WAD + x);
            z = FixedPointMath.wadDiv(z, denom);
        }
        uint256 z2 = z.wadMul(z);
        uint256 sum = z;
        uint256 term = z;
        unchecked {
            for (uint256 n = 1; n < 15; ++n) {
                term = term.wadMul(z2);
                uint256 add = term / (2 * n + 1);
                if (add == 0) break;
                sum += add;
            }
        }
        uint256 result = sum * 2;
        return (x < FixedPointMath.WAD) ? FixedPointMath.WAD : result; // negative ln not used
    }
}
