// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IAMM } from "../interfaces/IAMM.sol";
import { FixedPointMath } from "../libraries/FixedPointMath.sol";

/**
 * @title RialAMM
 * @notice Minimal constant-product (Uniswap V2-style) AMM. Used as the
 *         post-graduation venue for launchpad tokens, and as a generic
 *         token↔rial pair. No fees in v1 — fees are taken at the router layer.
 */
contract RialAMM is ERC20, IAMM {
    using FixedPointMath for uint256;

    address public immutable token0;
    address public immutable token1;
    uint112 private _reserve0;
    uint112 private _reserve1;
    uint32  private _blockTimestampLast;
    // reentrancy guard flag (single-word uint256)
    uint256 private _locked = 1;

    error InsufficientLiquidity();
    error InvalidTo();
    error InsufficientOutputAmount();
    error InsufficientLiquidityMinted();
    error InvalidK();
    error Locked();
    error Overflow();

    modifier lock() {
        if (_locked == 2) revert Locked();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(address _tokenA, address _tokenB) ERC20("Rial LP", "RIAL-LP") {
        if (_tokenA == _tokenB || _tokenA == address(0) || _tokenB == address(0)) revert InvalidK();
        (token0, token1) = _tokenA < _tokenB ? (_tokenA, _tokenB) : (_tokenB, _tokenA);
    }

    function getReserves() public view override returns (uint112 r0, uint112 r1, uint32 ts) {
        return (_reserve0, _reserve1, _blockTimestampLast);
    }

    function mint(address to) external override lock returns (uint256 liquidity) {
        (uint112 r0, uint112 r1, ) = getReserves();
        uint256 bal0 = IERC20(token0).balanceOf(address(this));
        uint256 bal1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = bal0 - r0;
        uint256 amount1 = bal1 - r1;
        uint256 totalSupply_ = totalSupply();
        if (totalSupply_ == 0) {
            liquidity = FixedPointMath.sqrt(amount0 * amount1) - 1000;
            _mint(address(0xdead), 1000); // permanent lock to prevent divide-by-zero
        } else {
            liquidity = FixedPointMath.mulDiv(
                amount0, totalSupply_, r0
            ) < FixedPointMath.mulDiv(amount1, totalSupply_, r1)
                ? FixedPointMath.mulDiv(amount0, totalSupply_, r0)
                : FixedPointMath.mulDiv(amount1, totalSupply_, r1);
        }
        if (liquidity == 0) revert InsufficientLiquidityMinted();
        _update(bal0, bal1, r0, r1);
        _mint(to, liquidity);
        emit Mint(msg.sender, amount0, amount1);
    }

    function burn(address to) external override lock returns (uint256 amount0, uint256 amount1) {
        (uint112 r0, uint112 r1, ) = getReserves();
        uint256 liquidity = balanceOf(address(this));
        uint256 totalSupply_ = totalSupply();
        amount0 = FixedPointMath.mulDiv(liquidity, r0, totalSupply_);
        amount1 = FixedPointMath.mulDiv(liquidity, r1, totalSupply_);
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidity();
        _burn(address(this), liquidity);
        _safeTransfer(token0, to, amount0);
        _safeTransfer(token1, to, amount1);
        uint256 bal0 = IERC20(token0).balanceOf(address(this));
        uint256 bal1 = IERC20(token1).balanceOf(address(this));
        _update(bal0, bal1, _reserve0, _reserve1);
        emit Burn(msg.sender, amount0, amount1, to);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata /* data */)
        external
        override
        lock
    {
        if (amount0Out == 0 && amount1Out == 0) revert InsufficientOutputAmount();
        (uint112 r0, uint112 r1, ) = getReserves();
        if (amount0Out >= r0 || amount1Out >= r1) revert InsufficientLiquidity();
        if (to == token0 || to == token1) revert InvalidTo();
        if (amount0Out > 0) _safeTransfer(token0, to, amount0Out);
        if (amount1Out > 0) _safeTransfer(token1, to, amount1Out);
        uint256 bal0 = IERC20(token0).balanceOf(address(this));
        uint256 bal1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0In = bal0 > r0 - amount0Out ? bal0 - (r0 - amount0Out) : 0;
        uint256 amount1In = bal1 > r1 - amount1Out ? bal1 - (r1 - amount1Out) : 0;
        if (amount0In == 0 && amount1In == 0) revert InsufficientOutputAmount();
        // 0.3% fee on input, scaled in WAD.
        uint256 bal0Adj = bal0 * 1000 - amount0In * 3;
        uint256 bal1Adj = bal1 * 1000 - amount1In * 3;
        // (bal0Adj * bal1Adj) >= (r0 * r1) * 1000^2
        if (bal0Adj * bal1Adj < uint256(r0) * uint256(r1) * (1000 ** 2)) revert InsufficientLiquidity();
        _update(bal0, bal1, r0, r1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert Overflow();
    }

    function _update(uint256 bal0, uint256 bal1, uint112 r0, uint112 r1) private {
        if (bal0 > type(uint112).max || bal1 > type(uint112).max) revert Overflow();
        uint32 blockTimestamp = uint32(block.timestamp);
        _reserve0 = uint112(bal0);
        _reserve1 = uint112(bal1);
        if (blockTimestamp != _blockTimestampLast) {
            _blockTimestampLast = blockTimestamp;
        }
        // silence unused-variable warning when called from burn()
        r0; r1;
        emit Sync(_reserve0, _reserve1);
    }

    // Force balances to match reserves; useful when tokens are transferred directly.
    function skim(address to) external lock {
        (uint112 r0, uint112 r1, ) = getReserves();
        uint256 bal0 = IERC20(token0).balanceOf(address(this));
        uint256 bal1 = IERC20(token1).balanceOf(address(this));
        if (bal0 > r0) _safeTransfer(token0, to, bal0 - r0);
        if (bal1 > r1) _safeTransfer(token1, to, bal1 - r1);
    }
}
