# notification-service

Multi-channel notification service for the **Rial** platform.

## Channels

- `email` — SMTP (dry-run if not configured)
- `sms` — pluggable provider (`kavenegar`, `twilio`, `noop`)
- `push` — Web Push (VAPID keys from env)
- `telegram` — Bot API
- `discord` — webhook
- `inbox` — in-app delivery (handed off to user service)

## API

- `GET  /healthz` — liveness
- `GET  /v1/notifications/channels` — list enabled channels
- `POST /v1/notifications/send` — send one
- `POST /v1/notifications/fanout` — same payload to many channels

### Send

```json
POST /v1/notifications/send
{
  "id": "trade-123-fill",
  "channel": "email",
  "recipient": "user@example.com",
  "subject": "Order filled",
  "body": "Hi {{name}}, your {{symbol}} order filled at {{price}}.",
  "data": { "name": "Qalam", "symbol": "RIAL", "price": "1.23" },
  "correlationId": "trade-123"
}
```

### Fanout

```json
POST /v1/notifications/fanout
{
  "recipient": "u1",
  "subject": "Big move",
  "body": "{{symbol}} just moved {{pct}}%",
  "data": { "symbol": "RIAL", "pct": 12 },
  "channels": ["email", "telegram", "inbox"]
}
```

## Idempotency

Each `(channel, id)` pair is deduplicated in-process for 10 minutes.
Use a stable `id` (e.g. `${eventId}:${channel}`) to ensure retries
are safe.

## Run

```bash
npm install
npm run build
npm start
```

## Test

```bash
npm test
```
