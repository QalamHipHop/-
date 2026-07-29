// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { CurveMath } from "../libraries/CurveMath.sol";

/**
 * @title ILaunchpad
 * @notice External interface for the bonding-curve launchpad factory.
 * @dev    The factory creates a per-token contract implementing this interface
 *         so each launch is isolated and can be graduated independently.
 */
interface ILaunchpad {
    enum State { DRAFT, LIVE, GRADUATED, PAUSED }

    struct TokenInfo {
        address token;
        address creator;
        address reserveVault;
        CurveMath.Model model;
        uint256 graduationThreshold; // in rial-WAD
        uint256 platformFeeBps;
        uint256 creatorFeeBps;
        uint256 totalSupply;
        uint256 reserveBalance;
        uint256 soldSupply;
        State state;
        uint64 launchedAt;
        uint64 graduatedAt;
    }

    event TokenLaunched(address indexed token, address indexed creator, address indexed pool);
    event TokensPurchased(address indexed token, address indexed buyer, uint256 rialIn, uint256 tokensOut);
    event TokensSold(address indexed token, address indexed seller, uint256 tokensIn, uint256 rialOut);
    event Graduated(address indexed token, address indexed ammPair, uint256 liquiditySeeded);
    event LaunchPaused(address indexed token);
    event LaunchUnpaused(address indexed token);

    error NotLive();
    error AlreadyGraduated();
    error BelowThreshold();
    error ZeroAddress();
    error FeeTooHigh();
    error SlippageExceeded(uint256 expected, uint256 actual);

    function createToken(
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        CurveMath.Model model,
        uint256 graduationThreshold
    ) external returns (address pool, address token);

    function buy(address token, uint256 rialIn, uint256 minTokensOut) external returns (uint256 tokensOut);

    function sell(address token, uint256 tokensIn, uint256 minRialOut) external returns (uint256 rialOut);

    function graduate(address token) external returns (address ammPair, uint256 liquiditySeeded);

    function pauseLaunch(address token) external;
    function unpauseLaunch(address token) external;

    function getInfo(address token) external view returns (TokenInfo memory);
    function quoteBuy(address token, uint256 rialIn) external view returns (uint256 tokensOut);
    function quoteSell(address token, uint256 tokensOut) external view returns (uint256 rialOut);
}
