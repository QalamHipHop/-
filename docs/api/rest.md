# REST API Reference (excerpt)

> Full OpenAPI spec is generated at build time under `/openapi.json`.
> All endpoints under `/api` require a JWT (`Authorization: Bearer <token>`) unless noted.
> All `POST`/`PUT`/`PATCH` require an `Idempotency-Key` header.

## Auth

- `POST   /api/auth/register`               — email/phone + password
- `POST   /api/auth/login`                  — password
- `POST   /api/auth/oauth/:provider`        — OAuth start
- `GET    /api/auth/oauth/:provider/cb`     — OAuth callback
- `POST   /api/auth/wallet/challenge`       — SIWE/SIWS challenge
- `POST   /api/auth/wallet/verify`          — verify signed challenge
- `POST   /api/auth/passkey/register/options`— WebAuthn registration
- `POST   /api/auth/passkey/register/verify`
- `POST   /api/auth/passkey/login/options`
- `POST   /api/auth/passkey/login/verify`
- `POST   /api/auth/2fa/enable`             — start TOTP enrollment
- `POST   /api/auth/2fa/verify`
- `POST   /api/auth/refresh`
- `POST   /api/auth/logout`

## Wallets

- `GET    /api/wallets`                          — list my accounts
- `GET    /api/wallets/:id/balance`
- `GET    /api/wallets/:id/transactions?cursor=`
- `POST   /api/wallets/withdrawals`              — body: `{account, amount, destination}`
- `GET    /api/wallets/withdrawals/:id`
- `POST   /api/wallets/transfers`                — internal transfer

## Launchpad

- `GET    /api/launchpad/tokens?status=&q=&cursor=`
- `POST   /api/launchpad/tokens`                 — create draft
- `GET    /api/launchpad/tokens/:id`
- `PATCH  /api/launchpad/tokens/:id`             — edit draft
- `POST   /api/launchpad/tokens/:id/submit`      — submit for review
- `POST   /api/launchpad/tokens/:id/buy`         — buy on curve
- `POST   /api/launchpad/tokens/:id/sell`
- `GET    /api/launchpad/tokens/:id/curve?ts=`   — historical price

## Trading

- `GET    /api/markets`
- `GET    /api/markets/:id/orderbook?depth=20`
- `GET    /api/markets/:id/trades?cursor=`
- `GET    /api/markets/:id/candles?interval=1m&from=&to=`
- `POST   /api/orders`                          — `{market, side, type, ...}`
- `GET    /api/orders?status=open&cursor=`
- `DELETE /api/orders/:id`                      — cancel
- `PATCH  /api/orders/:id`                      — modify (limit only)

## Payments

- `GET    /api/payments/adapters`
- `POST   /api/payments/deposits`                — create deposit intent
- `POST   /api/payments/withdrawals`
- `GET    /api/payments/deposits/:id`
- `POST   /api/payments/webhooks/:adapter`       — PSP → us (no auth; signed)

## Admin

- `GET    /api/admin/users?cursor=`
- `PATCH  /api/admin/users/:id`
- `GET    /api/admin/audit?actor=&action=&cursor=`
- `POST   /api/admin/feature-flags/:name`        — toggle
- `POST   /api/admin/emergency-pause`            — `{scope, scope_id, reason}`

## WebSocket topics

- `user:{user_id}`           — personal events
- `market:{market_id}`       — order book / trades
- `token:{token_id}`         — launch events
- `system`                   — platform-wide announcements
