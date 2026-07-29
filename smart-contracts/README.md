# ﷼ Smart Contracts

Production-grade EVM smart contracts for the Rial token launch & trading platform.

## Layout

```
contracts/
├── core/
│   ├── RialToken.sol          # ERC-20 settlement token
│   ├── LaunchpadFactory.sol   # Bonding-curve launchpad with graduation
│   ├── BondingCurve.sol       # Linear/exp/log/sigmoid curve math
│   ├── RialAMM.sol            # AMM DEX (constant-product)
│   ├── RialRouter.sol         # Swap router with price-oracle integration
│   └── RialTreasury.sol       # Fee collection & distribution
├── vesting/
│   └── VestingWallet.sol      # Linear vesting with cliff
├── governance/
│   ├── Timelock.sol           # 24h timelock for admin actions
│   └── RialGovernor.sol       # On-chain governance
├── security/
│   ├── ReentrancyGuard.sol
│   ├── Pausable.sol
│   └── AccessControl.sol
└── interfaces/
    ├── ILaunchpad.sol
    ├── IAMM.sol
    └── IRouter.sol
```

## Quick deploy (local)

```bash
npm install
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy-all.ts --network localhost
```

## Audit notes

- All state-changing functions are `nonReentrant`.
- Owner-only paths behind a 24h `Timelock`.
- `Pausable` emergency stop on every entry point.
- No external calls before state updates (checks-effects-interactions).
- All fee math uses `mulDiv` with overflow protection.
- Integer math in 18-decimal fixed-point (WAD).
