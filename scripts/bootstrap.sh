#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

fail() { echo "ERROR: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "Docker is required. Install Docker Engine/Desktop, then run this script again."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required."

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Review secrets before production use."
fi

# Never allow development defaults to be mistaken for production.
if grep -Eq '^(NODE_ENV|APP_DOMAIN|PUBLIC_BASE_URL)=' .env; then
  sed -i \
    -e 's/^NODE_ENV=.*/NODE_ENV=development/' \
    -e 's/^APP_DOMAIN=.*/APP_DOMAIN=localhost/' \
    -e 's#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=http://localhost:3000#' \
    .env
fi

compose=(docker compose --env-file .env -f docker-compose.yml)

"${compose[@]}" config >/dev/null || fail "docker-compose.yml could not be resolved."
"${compose[@]}" up -d postgres redis clickhouse nats kafka minio meilisearch

until "${compose[@]}" exec -T postgres pg_isready -U "${POSTGRES_USER:-rial}" >/dev/null 2>&1; do
  echo "Waiting for PostgreSQL..."
  sleep 2
done

until "${compose[@]}" exec -T redis redis-cli -a "${REDIS_PASSWORD:-change-me}" ping 2>/dev/null | grep -q PONG; do
  echo "Waiting for Redis..."
  sleep 2
done

"${compose[@]}" --profile tools run --rm migrate
"${compose[@]}" --profile tools run --rm seed || echo "Seed skipped or already applied."
"${compose[@]}" up -d --build backend frontend matching-engine trading-engine wallet-service launchpad-service payment-service notification-service analytics ai-engine

cat <<'EOF'
RIAL is starting.
Frontend: http://localhost:3000
Backend:  http://localhost:8080
Run `make ps` for service status and `make logs` for logs.
This bootstrap uses testnet/sandbox defaults from .env.example. Do not use it for mainnet until secrets, custody, monitoring, backups, and security review are complete.
EOF
