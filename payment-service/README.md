# @rial/payment-service

Pluggable payment service for the **RIAL** token-launch platform. Exposes
both **REST** and **gRPC** interfaces. Bundled adapters:

| Adapter       | Kind         | Currency examples        | Webhook sig       |
|---------------|--------------|--------------------------|-------------------|
| `manual`      | operator     | any                      | n/a (internal)    |
| `stripe`      | redirect     | USD, EUR, GBP, …         | HMAC-SHA256       |
| `zarinpal`    | redirect     | IRR, IRT                 | callback URL      |
| `nowpayments` | crypto       | BTC, ETH, USDT, …        | HMAC-SHA512 (IPN) |

## Endpoints

### HTTP (default `:50055`)

- `GET  /healthz`             — liveness
- `GET  /v1/adapters`         — list enabled adapters
- `POST /v1/deposits`         — create deposit intent
- `POST /v1/withdrawals`      — create withdrawal
- `GET  /v1/intents/:id`      — fetch intent
- `GET  /v1/intents`          — list (filter by `userId`, `kind`, `status`)
- `POST /v1/intents/:id/cancel` — cancel
- `POST /webhooks/:adapter`   — provider callback
- `GET  /docs`                — Swagger UI

### gRPC (default `:50056`)

`rial.payment.v1.PaymentService` — see [`proto/payment.proto`](proto/payment.proto).

## Run

```bash
cp .env.example .env
pnpm install
pnpm build
pnpm start            # HTTP :50055 + gRPC :50056

# dev
pnpm start:dev

# tests
pnpm test
pnpm test:cov
```

## Docker

```bash
docker build -t rial/payment-service .
docker run --rm -p 50055:50055 -p 50056:50056 --env-file .env rial/payment-service
```

## Author

`QalamCode`
