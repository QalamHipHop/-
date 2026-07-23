# Launchpad Engine

The launchpad is responsible for the entire lifecycle of a token on the platform: creation, bonding-curve trading, graduation to a real AMM, and optional vesting.

## Flow

```
            ┌────────────────┐
   Wizard → │  draft token   │
            └───────┬────────┘
                    │ submit
            ┌───────▼────────┐
            │  pending review│  (admin / AI moderation)
            └───────┬────────┘
                    │ approve
            ┌───────▼────────┐
            │     live       │  ← on-chain deploy via chain-adapter
            │  (bonding)     │  ← price from bonding curve
            └───────┬────────┘
                    │ reserve hits graduation
            ┌───────▼────────┐
            │  graduated     │  ← liquidity migrates to AMM
            └────────────────┘
```

## Bonding curve models

Implemented in `launchpad-service/curves/`:

| Model         | Formula                                          | Use case                       |
|---------------|--------------------------------------------------|--------------------------------|
| `linear`      | `p = m·S + b`                                    | simple, predictable            |
| `exponential` | `p = a·e^(k·S)`                                  | aggressive early demand        |
| `logarithmic` | `p = a·ln(1 + k·S)`                              | smooth late-stage growth       |
| `sigmoid`     | `p = L / (1 + e^(-k·(S - S0)))`                  | capped upside, default         |
| `custom`      | pluggable formula evaluator (sandboxed)          | experimental                   |

Each model exposes:
```ts
quoteBuy(supply, reserve, amountIn) -> { tokensOut, newSupply, newReserve, priceImpact }
quoteSell(supply, reserve, amountOut) -> { rialIn, newSupply, newReserve, priceImpact }
```

## Graduation

When `reserve_rial_minor >= graduation_threshold` (default 69 000 USD-equivalent in `﷼`), the token **graduates**:

1. The bonding-curve is frozen.
2. Liquidity is seeded on the AMM (Uniswap V2/V3 style or Raydium CLMM depending on chain).
3. LP tokens are burned to a dead address — liquidity is permanent.
4. The token is listed in the `quote` markets.

## Token creation — modular chain adapters

`launchpad-service/chains/<chain>.ts` implements `ChainAdapter`:

```ts
interface ChainAdapter {
  name: 'evm' | 'solana' | string;
  deployToken(spec: TokenSpec): Promise<{ address, txHash }>;
  configureAuthorities(addr, opts: { mint?, freeze? }): Promise<void>;
  seedLiquidity(token, base, rialAmount, tokenAmount): Promise<{ lpAddress, txHash }>;
  burnLP(lpAddress): Promise<{ txHash }>;
}
```

Adding a chain (e.g. TON, Aptos) means dropping a new adapter — no changes elsewhere.

## Vesting

`launchpad.vesting_schedules` describes a linear (or custom) release:

```
released(t) = total * clamp((t - start) - cliff, 0, duration) / duration
```

`launchpad-service` exposes a contract call (or its on-chain equivalent) to release vested tokens. The schedule is also kept off-chain for fast queries.

## AI moderation

Every draft is scored by `ai-engine`:
- `risk_score ∈ [0,1]` — automatic reject if > 0.95.
- `spam_score`, `scam_score`, `rugpull_score` — surfaced in admin UI.
- `logo_safety`, `text_safety` — image & text moderation.

## Anti-bot

- Cooldowns on first buy (per wallet, per IP).
- Anti-sybil: per-wallet cap during the first 60s of trading.
- Wash-trade detection by `ai-engine` (graph analysis on holder set).
