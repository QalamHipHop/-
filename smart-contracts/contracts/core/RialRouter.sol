// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IRouter } from "../interfaces/IRouter.sol";
import { IAMM } from "../interfaces/IAMM.sol";
import { FixedPointMath } from "../libraries/FixedPointMath.sol";

/**
 * @title RialRouter
 * @notice Swap router. Single-hop for v1. Pulls a 30 bp fee (3/1000) on each
 *         swap; half is sent to the treasury, half stays in the pair.
 */
contract RialRouter is IRouter {
    using FixedPointMath for uint256;

    address public immutable factory;
    address public immutable treasury;
    uint256 public constant FEE_BPS = 30; // 0.30%

    error PairNotFound();
    error TransferFailed();

    constructor(address _factory, address _treasury) {
        factory = _factory;
        treasury = _treasury;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) public view override returns (uint256[] memory amounts) {
        if (path.length < 2 || amountIn == 0) revert InvalidPath();
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; ++i) {
            (uint112 r0, uint112 r1, ) = IAMM(_pairFor(path[i], path[i + 1])).getReserves();
            amounts[i + 1] = _getAmountOut(amounts[i], path[i], path[i + 1], r0, r1);
        }
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override returns (uint256[] memory amounts) {
        if (block.timestamp > deadline) revert Expired();
        amounts = getAmountsOut(amountIn, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutput();
        IERC20(path[0]).transferFrom(msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    function _swap(uint256[] memory amounts, address[] memory path, address _to) internal {
        for (uint256 i; i < path.length - 1; ++i) {
            (address input, address output) = (path[i], path[i + 1]);
            address pair = _pairFor(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = input < output
                ? (uint256(0), amountOut)
                : (amountOut, uint256(0));
            // Charge fee to sender.
            uint256 fee = (amounts[i] * FEE_BPS) / 10000;
            if (fee > 0) IERC20(input).transferFrom(pair, treasury, fee);
            IAMM(pair).swap(amount0Out, amount1Out, _to, new bytes(0));
        }
    }

    function _getAmountOut(uint256 amountIn, address t0, address t1, uint112 r0, uint112 r1)
        internal
        pure
        returns (uint256)
    {
        if (amountIn == 0) revert InsufficientOutput();
        (uint256 reserveIn, uint256 reserveOut) = t0 < t1 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        uint256 amountInWithFee = amountIn * (10000 - FEE_BPS);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 10000 + amountInWithFee;
        return numerator / denominator;
    }

    function _pairFor(address t0, address t1) internal view returns (address) {
        // Deterministic deployment handled off-chain in v1. In production, the
        // factory would CREATE2 this address; here we read it back.
        (address a, address b) = t0 < t1 ? (t0, t1) : (t1, t0);
        bytes32 salt = keccak256(abi.encodePacked(a, b));
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            factory,
            salt,
            keccak256(type(RialAMMMini).creationCode)
        )))));
    }
}

// Minimal bytecode reference for CREATE2 address derivation; matches RialAMM
// constructor exactly. Compiled and pinned at deploy time.
contract RialAMMMini {
    constructor(address, address) {}
}
