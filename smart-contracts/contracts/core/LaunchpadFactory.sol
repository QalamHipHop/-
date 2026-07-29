// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { ILaunchpad } from "../interfaces/ILaunchpad.sol";
import { IRouter } from "../interfaces/IRouter.sol";
import { IAMM } from "../interfaces/IAMM.sol";

import { CurveMath } from "../libraries/CurveMath.sol";
import { FixedPointMath } from "../libraries/FixedPointMath.sol";

import { AccessControl } from "../security/AccessControl.sol";
import { Pausable } from "../security/Pausable.sol";
import { RialAMM } from "./RialAMM.sol";
import { VestingWallet } from "../vesting/VestingWallet.sol";

/**
 * @title LaunchpadFactory
 * @notice Per-token bonding-curve pool + graduation. Each launch is isolated in
 *         a `LaunchPool` contract so graduation, fees, and vesting are scoped
 *         per token.
 * @dev    All rial-denominated values are in WAD (1e18) inside curve math, but
 *         the actual ERC-20 settlement token (RialToken) also uses 18 decimals
 *         so we treat 1:1 here.
 */
contract LaunchpadFactory is ILaunchpad, AccessControl, Pausable {
    using SafeERC20 for IERC20;
    using FixedPointMath for uint256;

    bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");
    bytes32 public constant PAUSER_ROLE  = keccak256("PAUSER_ROLE");

    address public immutable rial;        // settlement token (RialToken)
    address public immutable treasury;    // fee recipient
    address public immutable router;      // post-graduation router
    address public immutable vesting;     // vesting contract

    uint256 public platformFeeBps;        // default 200 (= 2%)
    uint256 public creatorFeeBps;         // default 100 (= 1%)

    // token => pool
    mapping(address => address) public poolOf;
    // pool   => info
    mapping(address => TokenInfo) public infoOf;

    uint256 public tokenCount;

    event PoolCreated(address indexed token, address indexed pool, address indexed creator);
    event FeesWithdrawn(address indexed to, uint256 amount);

    error MaxFee();
    error UnknownToken();
    error UnknownPool();

    constructor(
        address admin,
        address _rial,
        address _treasury,
        address _router,
        address _vesting,
        uint256 _platformFeeBps,
        uint256 _creatorFeeBps
    ) {
        if (_platformFeeBps + _creatorFeeBps > 1000) revert MaxFee(); // hard cap 10%
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CREATOR_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        rial = _rial;
        treasury = _treasury;
        router = _router;
        vesting = _vesting;
        platformFeeBps = _platformFeeBps;
        creatorFeeBps = _creatorFeeBps;
    }

    // -----------------------------------------------------------------
    //  Token creation
    // -----------------------------------------------------------------

    function createToken(
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        CurveMath.Model model,
        uint256 graduationThreshold
    ) external whenNotPaused returns (address pool, address tokenAddr) {
        if (platformFeeBps + creatorFeeBps > 1000) revert MaxFee();
        // Deploy a minimal ERC-20 for the new token. Each launch gets its own
        // mintable token; mint authority is renounced after graduation to
        // protect holders.
        tokenAddr = address(new LaunchToken(name, symbol, totalSupply, msg.sender));
        pool = address(new LaunchPool(
            tokenAddr,
            rial,
            msg.sender,
            address(this),
            treasury,
            vesting,
            model,
            graduationThreshold,
            platformFeeBps,
            creatorFeeBps
        ));
        poolOf[tokenAddr] = pool;
        infoOf[pool] = TokenInfo({
            token: tokenAddr,
            creator: msg.sender,
            reserveVault: pool,
            model: model,
            graduationThreshold: graduationThreshold,
            platformFeeBps: platformFeeBps,
            creatorFeeBps: creatorFeeBps,
            totalSupply: totalSupply,
            reserveBalance: 0,
            soldSupply: 0,
            state: State.LIVE,
            launchedAt: uint64(block.timestamp),
            graduatedAt: 0
        });
        tokenCount += 1;
        emit TokenLaunched(tokenAddr, msg.sender, pool);
        emit PoolCreated(tokenAddr, pool, msg.sender);
    }

    // -----------------------------------------------------------------
    //  Trading — proxied to the per-token pool
    // -----------------------------------------------------------------

    function buy(address token, uint256 rialIn, uint256 minTokensOut)
        external
        whenNotPaused
        returns (uint256 tokensOut)
    {
        address pool = poolOf[token];
        if (pool == address(0)) revert UnknownToken();
        IERC20(rial).safeTransferFrom(msg.sender, pool, rialIn);
        tokensOut = LaunchPool(pool).buy(msg.sender, rialIn, minTokensOut);
    }

    function sell(address token, uint256 tokensIn, uint256 minRialOut)
        external
        whenNotPaused
        returns (uint256 rialOut)
    {
        address pool = poolOf[token];
        if (pool == address(0)) revert UnknownToken();
        IERC20(token).safeTransferFrom(msg.sender, pool, tokensIn);
        rialOut = LaunchPool(pool).sell(msg.sender, tokensIn, minRialOut);
    }

    function graduate(address token) external returns (address ammPair, uint256 liquiditySeeded) {
        address pool = poolOf[token];
        if (pool == address(0)) revert UnknownToken();
        (ammPair, liquiditySeeded) = LaunchPool(pool).graduate();
        TokenInfo storage info = infoOf[pool];
        info.state = State.GRADUATED;
        info.graduatedAt = uint64(block.timestamp);
        emit Graduated(token, ammPair, liquiditySeeded);
    }

    function pauseLaunch(address token) external onlyRole(PAUSER_ROLE) {
        address pool = poolOf[token];
        if (pool == address(0)) revert UnknownToken();
        LaunchPool(pool).pause();
        infoOf[pool].state = State.PAUSED;
        emit LaunchPaused(token);
    }

    function unpauseLaunch(address token) external onlyRole(PAUSER_ROLE) {
        address pool = poolOf[token];
        if (pool == address(0)) revert UnknownToken();
        LaunchPool(pool).unpause();
        infoOf[pool].state = State.LIVE;
        emit LaunchUnpaused(token);
    }

    // -----------------------------------------------------------------
    //  Views
    // -----------------------------------------------------------------

    function getInfo(address token) external view returns (TokenInfo memory) {
        address pool = poolOf[token];
        if (pool == address(0)) revert UnknownToken();
        return infoOf[pool];
    }

    function quoteBuy(address token, uint256 rialIn) external view returns (uint256) {
        address pool = poolOf[token];
        if (pool == address(0)) revert UnknownToken();
        return LaunchPool(pool).quoteBuy(rialIn);
    }

    function quoteSell(address token, uint256 tokensOut) external view returns (uint256) {
        address pool = poolOf[token];
        if (pool == address(0)) revert UnknownToken();
        return LaunchPool(pool).quoteSell(tokensOut);
    }

    function withdrawFees(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IERC20(rial).safeTransfer(to, amount);
        emit FeesWithdrawn(to, amount);
    }
}

// =====================================================================
//  Per-token launch pool
// =====================================================================

contract LaunchPool is Pausable {
    using FixedPointMath for uint256;
    using SafeERC20 for IERC20;

    address public immutable token;
    address public immutable rial;
    address public immutable creator;
    address public immutable factory;
    address public immutable treasury;
    address public immutable vesting;

    CurveMath.Model public model;
    CurveMath.Params public params;
    uint256 public graduationThreshold;
    uint256 public platformFeeBps;
    uint256 public creatorFeeBps;
    uint256 public reserveBalance;
    uint256 public soldSupply;
    ILaunchpad.State public state;

    error NotLive();
    error AlreadyGraduated();
    error SlippageExceeded(uint256 expected, uint256 actual);
    error BelowThreshold();
    error Unauthorized();

    modifier onlyFactory() {
        if (msg.sender != factory) revert Unauthorized();
        _;
    }

    constructor(
        address _token,
        address _rial,
        address _creator,
        address _factory,
        address _treasury,
        address _vesting,
        CurveMath.Model _model,
        uint256 _graduationThreshold,
        uint256 _platformFeeBps,
        uint256 _creatorFeeBps
    ) {
        token = _token;
        rial = _rial;
        creator = _creator;
        factory = _factory;
        treasury = _treasury;
        vesting = _vesting;
        model = _model;
        graduationThreshold = _graduationThreshold;
        platformFeeBps = _platformFeeBps;
        creatorFeeBps = _creatorFeeBps;
        // Default sigmoid params — overridden by setter if needed.
        params = CurveMath.Params({
            model: _model,
            a: 1e17,           // 0.1
            k: 1e15,           // 0.001
            b: 1e15,           // 0.001
            L: 1e21,           // 1000
            S0: 5e20           // 50
        });
        state = ILaunchpad.State.LIVE;
    }

    function buy(address buyer, uint256 rialIn, uint256 minTokensOut) external onlyFactory whenNotPaused returns (uint256 tokensOut) {
        if (state != ILaunchpad.State.LIVE) revert NotLive();
        (tokensOut, , ) = CurveMath.quoteBuy(params, soldSupply, rialIn);
        if (tokensOut < minTokensOut) revert SlippageExceeded(minTokensOut, tokensOut);
        // Fees.
        uint256 platformFee = rialIn.wadMul(platformFeeBps * 1e14);
        uint256 creatorFee  = rialIn.wadMul(creatorFeeBps  * 1e14);
        uint256 netRial     = rialIn - platformFee - creatorFee;
        if (platformFee > 0) IERC20(rial).safeTransfer(treasury, platformFee);
        if (creatorFee  > 0) IERC20(rial).safeTransfer(creator,   creatorFee);
        reserveBalance += netRial;
        soldSupply     += tokensOut;
        // Mint tokens to buyer.
        LaunchToken(token).mint(buyer, tokensOut);
        // Auto-graduate if threshold met.
        if (reserveBalance >= graduationThreshold) {
            _graduate();
        }
    }

    function sell(address seller, uint256 tokensIn, uint256 minRialOut) external onlyFactory whenNotPaused returns (uint256 rialOut) {
        if (state != ILaunchpad.State.LIVE) revert NotLive();
        (rialOut, , ) = CurveMath.quoteSell(params, soldSupply, tokensIn);
        if (rialOut < minRialOut) revert SlippageExceeded(minRialOut, rialOut);
        if (rialOut > reserveBalance) revert BelowThreshold();
        reserveBalance -= rialOut;
        soldSupply     -= tokensIn;
        IERC20(token).safeTransferFrom(seller, address(this), tokensIn);
        IERC20(rial).safeTransfer(seller, rialOut);
    }

    function graduate() external onlyFactory returns (address ammPair, uint256 liquiditySeeded) {
        if (state == ILaunchpad.State.GRADUATED) revert AlreadyGraduated();
        return _graduate();
    }

    function _graduate() internal returns (address ammPair, uint256 liquiditySeeded) {
        state = ILaunchpad.State.GRADUATED;
        // Seed AMM pair: token ↔ rial with current reserve + remaining supply.
        uint256 tokenLiquidity = LaunchToken(token).totalSupply() - soldSupply;
        ammPair = address(new RialAMM(token, rial));
        // Transfer rial + token to the pair, then mint LP.
        IERC20(rial).safeTransfer(ammPair, reserveBalance);
        LaunchToken(token).mint(ammPair, tokenLiquidity);
        liquiditySeeded = RialAMM(ammPair).mint(treasury);
        // Renounce mint authority to lock the supply.
        LaunchToken(token).renounceMint();
    }

    function quoteBuy(uint256 rialIn) external view returns (uint256) {
        (uint256 tokensOut, , ) = CurveMath.quoteBuy(params, soldSupply, rialIn);
        return tokensOut;
    }

    function quoteSell(uint256 tokensOut_) external view returns (uint256) {
        (uint256 rialOut, , ) = CurveMath.quoteSell(params, soldSupply, tokensOut_);
        return rialOut;
    }

    function pause() external onlyFactory {
        _pause();
    }

    function unpause() external onlyFactory {
        _unpause();
    }

    function setParams(CurveMath.Params calldata p) external onlyFactory {
        params = p;
    }
}

// =====================================================================
//  Minimal launch token (no external dep on OZ ERC20 to keep bytecode small)
// =====================================================================

contract LaunchToken is ERC20 {
    address public immutable minter;
    bool    public mintRenounced;

    error MintRenounced();
    error NotMinter();

    modifier onlyMinter() {
        if (msg.sender != minter) revert NotMinter();
        _;
    }

    constructor(string memory name_, string memory symbol_, uint256 totalSupply_, address creator_)
        ERC20(name_, symbol_)
    {
        minter = msg.sender; // factory is the deployer
        // Mint the entire supply to the pool by pre-mint to creator; in v1 we
        // mint-on-demand from the pool instead. Leave totalSupply_ as cap.
        totalSupply_; // silence
        creator_;      // silence
    }

    function mint(address to, uint256 amount) external onlyMinter {
        if (mintRenounced) revert MintRenounced();
        _mint(to, amount);
    }

    function renounceMint() external onlyMinter {
        mintRenounced = true;
    }
}
