// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IRouter
 * @notice Swap router for the Rial AMM. Single-hop, with explicit min-out and
 *         deadline. Wraps a constant-product pair.
 */
interface IRouter {
    error InvalidPath();
    error InsufficientOutput();
    error Expired();
    error ExcessiveInput();

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
}
