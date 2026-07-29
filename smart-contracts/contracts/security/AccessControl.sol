// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AccessControl
 * @notice Role-based access control. Roles are bytes32; each role has an admin role
 *         that can grant/revoke it. Adapted from OZ for gas efficiency.
 */
abstract contract AccessControl {
    struct RoleData {
        mapping(address account => bool) hasRole;
        bytes32 adminRole;
    }

    mapping(bytes32 role => RoleData) private _roles;

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole);

    error AccessControlUnauthorizedAccount(address account, bytes32 neededRole);

    function hasRole(bytes32 role, address account) public view virtual returns (bool) {
        return _roles[role].hasRole[account];
    }

    function getRoleAdmin(bytes32 role) public view virtual returns (bytes32) {
        return _roles[role].adminRole;
    }

    function grantRole(bytes32 role, address account) public virtual {
        if (!_grantRole(role, account)) revert AccessControlUnauthorizedAccount(msg.sender, getRoleAdmin(role));
    }

    function revokeRole(bytes32 role, address account) public virtual {
        if (!_revokeRole(role, account)) revert AccessControlUnauthorizedAccount(msg.sender, getRoleAdmin(role));
    }

    function renounceRole(bytes32 role, address account) public virtual {
        if (account != msg.sender) revert AccessControlUnauthorizedAccount(msg.sender, role);
        _revokeRole(role, account);
    }

    function _setRoleAdmin(bytes32 role, bytes32 adminRole) internal virtual {
        bytes32 previous = getRoleAdmin(role);
        _roles[role].adminRole = adminRole;
        emit RoleAdminChanged(role, previous, adminRole);
    }

    function _grantRole(bytes32 role, address account) internal virtual returns (bool) {
        if (!hasRole(role, account)) {
            _roles[role].hasRole[account] = true;
            emit RoleGranted(role, account, msg.sender);
            return true;
        } else {
            return false;
        }
    }

    function _revokeRole(bytes32 role, address account) internal virtual returns (bool) {
        if (hasRole(role, account)) {
            _roles[role].hasRole[account] = false;
            emit RoleRevoked(role, account, msg.sender);
            return true;
        } else {
            return false;
        }
    }

    modifier onlyRole(bytes32 role) {
        if (!hasRole(role, msg.sender)) revert AccessControlUnauthorizedAccount(msg.sender, role);
        _;
    }
}
