# Production Deployment Controls

The checked-in `docker-compose.yml` remains a **local development runtime**. It deliberately exposes service ports for diagnostics and uses defaults suitable only for an isolated environment. A public deployment must use the production overlay and a separately provisioned, untracked environment file.

## Required invocation

```bash
cp infrastructure/production/.env.production.example .env.production
# Replace every template value with a unique secret in a secure secret manager or local protected file.
./scripts/validate-production-env.sh .env.production
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml config
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml up -d
```

The overlay requires Docker Compose v2.24 or later because it uses `!reset []` to remove host port publication from internal services. The rendered configuration was validated to leave only Nginx with host ports, while backend, frontend, databases, queues, and observability components remain accessible only on the Compose network.

> Do not copy a template environment file directly into production. The validator intentionally rejects all `REPLACE_*`, `change-me`, empty, and short secret values.

## Remaining operator-owned prerequisites

A real production deployment still needs a verified domain, valid TLS certificates mounted at `infrastructure/nginx/certs`, DNS configuration, a managed backup target, an alert receiver, a vulnerability scan gate, and a completed restore exercise. Those dependencies cannot be truthfully configured from an isolated local sandbox because they require operator-owned infrastructure and credentials.

| Control | Enforced by repository | Operator action required |
|---|---|---|
| Internal host-port removal | `docker-compose.production.yml` | Use the production overlay, never base Compose alone. |
| Secret quality | `scripts/validate-production-env.sh` | Generate, store, rotate, and supply unique secrets. |
| Production environment | Production overlay forces `NODE_ENV=production` | Ensure runtime uses the validated environment file. |
| Public ingress | Nginx remains the sole published service | Supply domain, certificate, renewal automation, and WAF policy. |
| Solana Mainnet RPC | Validator requires an HTTPS RPC endpoint | Provide a trusted, rate-limited provider endpoint. |
| Recovery | No destructive volume operation is embedded | Configure encrypted backups and prove a restore before launch. |
