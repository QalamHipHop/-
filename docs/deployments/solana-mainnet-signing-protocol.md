# Solana Mainnet Signing Protocol — ﷼ Rial

**Owner:** Qalamhiphop  
**Network:** Solana Mainnet Beta  
**Owner public address:** `23QPN8TtY3p79gVRjqWghuFRb5XGpvMS3Dp8nVHuZAGG`  
**Status:** Transaction-builder verified; **no Mainnet transaction has been signed or broadcast**.

> The platform never receives, stores, requests, logs, or derives a seed phrase, private key, or Phantom export. The only owner identifier in this protocol is the public address above.

## Scope of the transaction-builder

`POST /api/solana/mint-plan` constructs a **zero-supply**, legacy SPL Token transaction for a specified public owner. The endpoint validates that its RPC has the Solana Mainnet genesis hash before proceeding. It creates a new random mint account in process, uses that account only to apply the required partial signature, and returns the serialized transaction with `requireAllSignatures: false`. The mint secret is never returned.

| Included instruction | Funding/signing authority | Effect |
|---|---|---|
| Create mint account | Owner pays rent; new mint account partially signs | Creates a rent-exempt account owned by the SPL Token Program |
| Initialize mint | No extra wallet signature | Sets the owner public address as mint authority, disables freeze authority, sets 8 decimals, and leaves supply at zero |
| Create associated token account | Owner pays rent and signs | Creates the owner’s token account for the new mint |

The builder does **not** create Metaplex or Token-2022 metadata, mint any supply, add liquidity, transfer SOL to a platform address, trade, submit the transaction, or call `sendRawTransaction`. Metadata and issuance must remain separate, explicitly approved steps.

## Verified dry-run facts

A live call to the builder using the owner public address successfully constructed an unsigned Mainnet plan. It returned a fresh mint address, a 664-byte partial-signed transaction, `initialSupplyMinor = 0`, `freezeAuthority = null`, mint rent of `1,461,600` lamports, and estimated base network fee of `10,000` lamports. A subsequent `GET /api/solana/mint-plan?mint=<dry-run-address>` returned `404` with `exists = false`, proving that the builder did not broadcast the plan.

## Controlled signing procedure

The owner should open the verified platform origin in Phantom’s injected-wallet context. The client must deserialize the returned base64 transaction, inspect the displayed payer, new mint address, authority settings, zero supply, instruction list, estimated cost, and blockhash expiry. Phantom adds the owner’s fee-payer signature and broadcasts only after the owner independently approves it.

Immediately after a confirmation signature is returned, the client or operator must call `GET /api/solana/mint-plan?mint=<mint-address>`. The verifier reads Mainnet state only and reports whether the account exists, whether it is a valid SPL mint, decimals, supply, mint authority, and freeze authority. It cannot submit or alter any chain state.

| Stop condition | Required action |
|---|---|
| RPC genesis hash is not Mainnet | Stop; correct the Mainnet endpoint before building any transaction. |
| Payer differs from owner public address | Stop; discard the plan. |
| Initial supply is not zero | Stop; discard the plan. |
| Mint authority or freeze authority differs from the displayed policy | Stop; discard the plan. |
| The recent blockhash expires before approval | Build a new plan; never reuse stale transaction bytes. |
| On-chain verifier result differs from signed scope | Stop all follow-on issuance and investigate before updating launchpad records. |

## References

1. [Solana: Create a Token Mint](https://solana.com/docs/tokens/basics/create-mint)
2. [Solana Cookbook: Offline and Partial-Signed Transactions](https://solana.com/developers/cookbook/transactions/offline-transactions)
3. [Phantom: Sign and Send Transactions](https://docs.phantom.com/sdks/browser-sdk/sign-and-send-transaction)
