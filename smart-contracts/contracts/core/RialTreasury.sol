// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControl } from "../security/AccessControl.sol";

/**
 * @title RialTreasury
 * @notice Receives protocol fees. Can only forward funds to addresses approved
 *         by ADMIN_ROLE. Tracks per-source balance for transparent reporting.
 */
contract RialTreasury is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SPENDER_ROLE = keccak256("SPENDER_ROLE");

    mapping(address token => uint256) public received;

    event Received(address indexed token, address indexed from, uint256 amount);
    event Spent(address indexed token, address indexed to, uint256 amount, bytes32 indexed ref);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    function deposit(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        received[token] += amount;
        emit Received(token, msg.sender, amount);
    }

    function spend(address token, address to, uint256 amount, bytes32 ref) external onlyRole(SPENDER_ROLE) {
        IERC20(token).safeTransfer(to, amount);
        emit Spent(token, to, amount, ref);
    }
}
