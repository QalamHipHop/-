// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControl } from "../security/AccessControl.sol";

/**
 * @title VestingWallet
 * @notice Linear vesting with optional cliff. Per-beneficiary schedules are
 *         configured by the launchpad factory at graduation.
 * @dev    Re-entrancy safe. Only ADMIN_ROLE can configure schedules. Recipients
 *         call `release()` once funds are unlocked.
 */
contract VestingWallet is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    struct Schedule {
        uint256 total;
        uint256 released;
        uint64  start;
        uint64  cliff;
        uint64  duration; // total vesting window
        bool    revoked;
    }

    mapping(address beneficiary => mapping(address token => Schedule)) public schedules;

    event ScheduleCreated(address indexed beneficiary, address indexed token, uint256 total, uint64 start, uint64 cliff, uint64 duration);
    event Released(address indexed beneficiary, address indexed token, uint256 amount);
    event Revoked(address indexed beneficiary, address indexed token, uint256 unreleased);

    error NothingToRelease();
    error AlreadyRevoked();
    error NotBeneficiary();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    function createSchedule(
        address beneficiary,
        address token,
        uint256 total,
        uint64  start,
        uint64  cliff,
        uint64  duration
    ) external onlyRole(ADMIN_ROLE) {
        if (duration == 0) revert("VestingWallet: zero duration");
        if (total == 0) revert("VestingWallet: zero total");
        schedules[beneficiary][token] = Schedule({
            total: total,
            released: 0,
            start: start,
            cliff: cliff,
            duration: duration,
            revoked: false
        });
        emit ScheduleCreated(beneficiary, token, total, start, cliff, duration);
    }

    function releasable(address beneficiary, address token) public view returns (uint256) {
        Schedule memory s = schedules[beneficiary][token];
        return _vestedAmount(s, block.timestamp) - s.released;
    }

    function release(address token) external {
        uint256 amount = releasable(msg.sender, token);
        if (amount == 0) revert NothingToRelease();
        schedules[msg.sender][token].released += amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Released(msg.sender, token, amount);
    }

    function revoke(address beneficiary, address token) external onlyRole(ADMIN_ROLE) {
        Schedule storage s = schedules[beneficiary][token];
        if (s.revoked) revert AlreadyRevoked();
        uint256 unreleased = s.total - s.released;
        s.revoked = true;
        if (unreleased > 0) {
            IERC20(token).safeTransfer(msg.sender, unreleased);
            emit Revoked(beneficiary, token, unreleased);
        }
    }

    function _vestedAmount(Schedule memory s, uint256 timestamp) internal pure returns (uint256) {
        if (s.revoked) return s.released;
        if (timestamp < s.start + s.cliff) return 0;
        if (timestamp >= s.start + s.duration) return s.total;
        return (s.total * (timestamp - s.start)) / s.duration;
    }
}
