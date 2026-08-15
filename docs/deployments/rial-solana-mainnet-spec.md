# ﷼ Rial — Solana Mainnet Deployment Specification

**Status:** Draft for explicit deployment confirmation; no transaction has been created, signed, or broadcast.

**Author:** Qalamhiphop  
**Prepared at:** 2026-08-15  
**Repository baseline:** `a2603a1` (`main`)  
**Intended chain:** Solana Mainnet Beta  
**Intended owner and initial authority wallet:** `23QPN8TtY3p79gVRjqWghuFRb5XGpvMS3Dp8nVHuZAGG`

> This specification distinguishes the existing off-chain settlement unit from the proposed on-chain SPL representation. An on-chain mint does **not** itself create a fiat peg, redemption promise, exchange rate, liquidity pool, or regulatory authorization.

## 1. Canonical-source reconciliation

| Deployment field | Proposed value | Canonical basis | Confidence |
|---|---|---|---|
| Product / token display name | `﷼ Rial` | The product metadata presents `﷼ Rial`; the README defines the internal settlement token as `﷼` (`Rial`). | High |
| Ticker | `RIAL` | `RialToken.sol` constructs the ERC-20 as `Rial`, `RIAL`; the wallet configuration sets its settlement symbol to `RIAL`. | High |
| On-chain decimals | `8` | The wallet’s money representation is fixed to eight decimal places; all minor units use `int64` at 8 dp. | High |
| Purpose | Settlement representation for the Rial launch-and-trading platform | The README and ADR-0003 define Rial as the platform’s unit of account for deposits, fees, prices, and rewards. | High |
| Description | `The on-chain representation of ﷼ Rial, the configurable settlement unit for the Qalamhiphop token launch and trading platform. It is designed for transparent settlement integration and does not imply a fixed fiat or crypto peg.` | Derived only from the canonical README, frontend metadata, and ADR. It deliberately avoids unsupported price, yield, redemption, or regulatory claims. | High |
| Website | `https://github.com/QalamHipHop/-` | Canonical source repository. | High |
| Creator attribution | `Qalamhiphop` | Root README. | High |
| Mint authority at creation | The owner wallet above | The user explicitly designated this Phantom wallet as the developer wallet. The existing EVM design uses an admin-controlled minter role. | High |
| Freeze authority at creation | The owner wallet above, pending transfer to a documented multi-signature operating authority | The EVM design includes an emergency pauser role. Retaining the Solana freeze authority permits a later multi-signature operational control migration; removing it cannot be reversed. | Medium |
| Initial minted supply | `0` base units | No versioned source defines a maximum or initial supply. Minting a non-zero amount would invent a token-economic value not present in canonical data. | High |
| Future issuance | No issuance in this deployment. Mint authority remains available only for a separately approved, auditable backing-and-issuance policy. | The platform uses a configurable rate provider and does not assume a permanent peg. The EVM reference implements role-gated minting rather than a fixed supply. | High |
| Initial liquidity / market making | None | No canonical source specifies a pool, market, reserve allocation, token price, or liquidity funding amount. | High |
| Logo and metadata image | Not yet determined | No versioned logo, image, or metadata asset exists in the repository. A new asset must be created, hosted, and explicitly approved before production metadata is published. | High |

## 2. Non-negotiable consistency constraints

The existing architecture makes three points explicit. First, `﷼` is currently an **internal unit of account**, not an on-chain token by default. Second, all internal balances are represented with eight decimal places and are not assumed to be permanently pegged. Third, the EVM reference has privileged mint, burn, and pause roles. A professional Solana deployment must preserve these distinctions rather than market the mint as a backed stablecoin or as an automatically redeemable asset.

The proposed mint therefore starts with **zero supply and no liquidity**. Its purpose is to establish the verifiable Mainnet identifier and metadata foundation. Any future issuance must be separately backed by a rate, reserve, settlement, and compliance policy. Any future trading market or AMM liquidity requires a separately approved market-design and funding transaction.

## 3. Scope of the proposed Mainnet transaction

The signing session will create a standard SPL Token mint on Solana Mainnet with 8 decimals, assign the developer wallet as mint and freeze authority, create the owner’s associated token account, and write canonical Metaplex-compatible metadata after a public metadata URI is available. No user funds other than SOL rent and transaction fees will move. No token amount will be minted. No SOL will be sent to a third-party wallet.

| Item | Deployment action | Irreversibility / control |
|---|---|---|
| Mint account | Create a new SPL mint | The mint address is permanent. |
| Decimals | Set to `8` | Cannot be changed after initialization. |
| Mint authority | Set to the provided Phantom wallet | Can later be transferred or revoked through a new signed transaction. |
| Freeze authority | Set to the provided Phantom wallet | Can later be transferred or revoked; revocation is irreversible. |
| Owner token account | Create the associated token account | Rent remains recoverable only by closing an empty account where protocol permits. |
| Supply | Mint no tokens | A later issuance requires a fresh signed transaction by the mint authority. |
| Metadata | Publish name, ticker, description, links, and image URI | Mutable only while update authority is retained; public metadata URI must be stable. |

## 4. Current Mainnet readiness and cost basis

The provided public address was successfully queried on Solana Mainnet at finalized commitment. It has a system-owned account with **106,535,840 lamports** (`0.106535840 SOL`). The following rent-exemption values were retrieved from Solana Mainnet RPC on 2026-08-15.

| Cost component | Lamports | SOL |
|---|---:|---:|
| Mint account — 82 bytes | 1,461,600 | 0.001461600 |
| Associated token account — 165 bytes | 2,039,280 | 0.002039280 |
| Metadata account — 679 bytes | 5,616,720 | 0.005616720 |
| Rent total | 9,117,600 | 0.009117600 |
| Two base transaction signatures | 10,000 | 0.000010000 |
| Minimum expected debit before priority fees | 9,127,600 | 0.009127600 |
| Balance remaining at this cost basis | 97,408,240 | 0.097408240 |

This is a **cost basis**, not the final fee quote. The final serialized transaction will fetch a recent blockhash, simulate all instructions, obtain an exact current fee quote, and use no priority fee unless the signer explicitly approves one.

## 5. Required implementation work before signing

The repository is production-runnable as an internal platform, but it does **not** currently contain a tracked Solana/Anchor/SPL implementation or a `launchpad-service/chains/solana` adapter. Its launchpad record validates a `chain`, `contract_address`, name, ticker, decimals, supply, metadata links, authority fields, curve details, and status; however, the on-chain deployment adapter described in the documentation has not been implemented. It would be inaccurate to claim automatic on-chain synchronization without adding this adapter.

Before constructing the unsigned transaction, the implementation will add the following versioned components.

| Deliverable | Purpose |
|---|---|
| Solana Mainnet configuration guard | Makes a Mainnet endpoint explicit and prevents a Devnet transaction from being presented as production. |
| SPL mint transaction builder | Constructs the mint, token account, authority, and metadata instructions without accessing the user’s private key. |
| Phantom signing page or interoperable serialized transaction handoff | Allows the developer wallet to review and sign locally; the seed phrase and private key never leave the wallet. |
| Metadata asset package | Provides a reviewed image and immutable/public JSON metadata URI before metadata is finalized. |
| Launchpad on-chain adapter | Persists the verified mint address, transaction signature, authority configuration, and Mainnet cluster in the real launchpad record. |
| Verification and audit record | Re-queries the mint and metadata on chain after finalization and records the result in versioned documentation. |

## 6. Decisions intentionally not invented from repository data

The repository does not define a token allocation, maximum supply, vesting allocation, genesis price, liquidity amount, market pair, fiat redemption process, logo asset, public website, social channels, or a live authority multisig. These must not be fabricated or silently inferred from demo UI values or an E2E test fixture.

The deployed zero-supply mint is therefore the only configuration fully consistent with canonical sources and the requested professional standard. Any non-zero issuance, market creation, or claim of backing must be a new, recorded governance decision with its own explicit signed confirmation.

## 7. Source references

1. [`README.md`](../../README.md): authorship; product purpose; internal settlement role; supported Solana architecture claim.
2. [`frontend/src/app/layout.tsx`](../../frontend/src/app/layout.tsx): public product title, wording, discovery metadata, and author label.
3. [`smart-contracts/contracts/core/RialToken.sol`](../../smart-contracts/contracts/core/RialToken.sol): canonical `Rial` / `RIAL` identifier and role-gated mint, burn, and pause pattern.
4. [`wallet-service/.env.example`](../../wallet-service/.env.example): canonical settlement symbol and 8-decimal configuration.
5. [`wallet-service/README.md`](../../wallet-service/README.md): 8-decimal integer money representation.
6. [`docs/adr/0003-settlement-token.md`](../adr/0003-settlement-token.md): default off-chain settlement status, configurable exchange-rate strategy, and no permanent-peg assumption.
7. [`docs/launchpad.md`](../launchpad.md) and [`launchpad-service/internal/launch/service.go`](../../launchpad-service/internal/launch/service.go): expected chain-adapter responsibilities and the real launchpad token-record contract.

## 8. Confirmation gate

No irreversible action has occurred. To proceed, the owner must explicitly approve the exact scope below in this conversation:

> Create the Mainnet SPL mint `﷼ Rial` (`RIAL`) with 8 decimals and **zero initial supply**, using `23QPN8TtY3p79gVRjqWghuFRb5XGpvMS3Dp8nVHuZAGG` as temporary mint and freeze authority; create its associated token account; publish approved metadata; spend no more than the exact simulated rent plus transaction fee; and make no liquidity, transfer, or token issuance.

The final Phantom signature remains under the user’s control.
