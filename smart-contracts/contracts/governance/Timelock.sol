// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "../security/AccessControl.sol";

/**
 * @title Timelock
 * @notice 24h delay between queuing and executing admin operations. Used as
 *         the owner of all platform contracts to give users time to react.
 */
contract Timelock is AccessControl {
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant CANCELLER_ROLE = keccak256("CANCELLER_ROLE");

    uint256 public constant MIN_DELAY = 24 hours;
    uint256 public constant MAX_DELAY = 30 days;

    struct Operation {
        address target;
        uint256 value;
        bytes   data;
        bool    executed;
    }

    mapping(bytes32 id => Operation) public operations;
    mapping(bytes32 id => uint256)    public timestamps;

    event OperationQueued(bytes32 indexed id, address indexed target, uint256 value, bytes data, uint256 eta);
    event OperationExecuted(bytes32 indexed id, address indexed target, uint256 value, bytes data);
    event OperationCancelled(bytes32 indexed id);

    error InsufficientDelay();
    error NotReady();
    error AlreadyExecuted();
    error CallFailed();
    error UnauthorizedProposer();
    error UnauthorizedExecutor();

    constructor(address admin, uint256 delay) {
        if (delay < MIN_DELAY || delay > MAX_DELAY) revert InsufficientDelay();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PROPOSER_ROLE, admin);
        _grantRole(EXECUTOR_ROLE, address(0)); // anyone can execute once ready
        _grantRole(CANCELLER_ROLE, admin);
    }

    function queue(address target, uint256 value, bytes calldata data, uint256 eta) external onlyRole(PROPOSER_ROLE) returns (bytes32 id) {
        if (eta < block.timestamp + MIN_DELAY) revert InsufficientDelay();
        id = keccak256(abi.encode(target, value, data, eta));
        operations[id] = Operation({ target: target, value: value, data: data, executed: false });
        timestamps[id] = eta;
        emit OperationQueued(id, target, value, data, eta);
    }

    function execute(address target, uint256 value, bytes calldata data, uint256 eta) external payable onlyRole(EXECUTOR_ROLE) returns (bytes32 id) {
        id = keccak256(abi.encode(target, value, data, eta));
        Operation storage op = operations[id];
        if (op.executed) revert AlreadyExecuted();
        if (block.timestamp < eta) revert NotReady();
        op.executed = true;
        (bool ok, ) = target.call{value: value}(data);
        if (!ok) revert CallFailed();
        emit OperationExecuted(id, target, value, data);
    }

    function cancel(bytes32 id) external onlyRole(CANCELLER_ROLE) {
        delete operations[id];
        delete timestamps[id];
        emit OperationCancelled(id);
    }
}
