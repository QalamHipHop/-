// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl as OpenZeppelinAccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title AccessControl
 * @notice Compatibility wrapper around the audited OpenZeppelin v5 role system.
 * @dev Retaining this import path prevents accidental role-model divergence in
 * existing contracts while inheriting OpenZeppelin's admin authorization checks.
 */
abstract contract AccessControl is OpenZeppelinAccessControl {}
