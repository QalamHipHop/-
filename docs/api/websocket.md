# WebSocket Protocol

Endpoint: `wss://<host>/ws`

## Authentication

Connect with `Authorization: Bearer <jwt>` in the subprotocol header, or first message:
```json
{ "type": "auth", "token": "..." }
```

## Subscribe

```json
{ "type": "subscribe", "topic": "market:<uuid>", "id": "sub-1" }
```

## Unsubscribe

```json
{ "type": "unsubscribe", "id": "sub-1" }
```

## Server → client messages

```json
{ "type": "book", "topic": "market:<uuid>", "seq": 12345, "bids": [[price,size], ...], "asks": [...] }
{ "type": "trade", "topic": "market:<uuid>", "id": "...", "price": ..., "size": ..., "ts": ... }
{ "type": "token_event", "topic": "token:<uuid>", "kind": "buy|sell|graduate|whale", "data": {...} }
{ "type": "user_update", "topic": "user:<uuid>", "kind": "order|match|deposit|withdrawal|reward", "data": {...} }
{ "type": "system", "kind": "maintenance|incident", "message": "..." }
{ "type": "ack", "id": "sub-1", "ok": true }
{ "type": "error", "id": "sub-1", "code": "INVALID_TOPIC", "message": "..." }
```

## Heartbeat

Server sends `ping` every 30s; client must `pong` within 10s or be dropped.

## Limits

- 100 subscriptions / connection.
- 50 messages / second / subscription.
- Reconnect with exponential backoff; pass `Last-Event-ID` to resume.
