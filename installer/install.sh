#!/usr/bin/env bash
# Author: QalamHipHop
# RIAL Platform — reproducible one-command installer.
# Usage: sudo bash installer/install.sh [--production] [--low-cost] [--skip-build]
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
COMPOSE_EXTRA=()
SKIP_BUILD=0
PRODUCTION=0
LOW_COST=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --production) PRODUCTION=1 ;;
    --low-cost) LOW_COST=1 ;;
    *) printf 'unknown option: %s (supported: --production, --low-cost, --skip-build)\n' "${arg}" >&2; exit 2 ;;
  esac
done
if [[ "${PRODUCTION}" -eq 1 ]]; then COMPOSE_EXTRA+=( -f "${ROOT_DIR}/docker-compose.production.yml" ); fi
if [[ "${LOW_COST}" -eq 1 ]]; then COMPOSE_EXTRA+=( -f "${ROOT_DIR}/docker-compose.lowcost.yml" ); fi

bold(){ printf '\033[1m%s\033[0m\n' "$*"; }
ok(){ printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$*"; }
err(){ printf '  \033[31m✖\033[0m %s\n' "$*" >&2; }
fail(){ err "$*"; exit 1; }
trap 'err "Installation failed at line ${LINENO}. See: compose logs --tail=100"' ERR

need_cmd(){ command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }
compose(){ docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "${COMPOSE_EXTRA[@]}" "$@"; }

bold "Preflight checks"
[[ "${EUID}" -eq 0 ]] || fail "run as root: sudo bash installer/install.sh"
need_cmd bash
need_cmd curl
need_cmd git
need_cmd docker
[[ -f "${COMPOSE_FILE}" ]] || fail "docker-compose.yml not found at ${COMPOSE_FILE}"
docker info >/dev/null 2>&1 || fail "Docker daemon is unavailable"
docker compose version >/dev/null 2>&1 || fail "docker compose plugin is missing"
ok "Docker and Compose are ready"

bold "Configuration wizard"
cd "${ROOT_DIR}"
if [[ ! -f "${ENV_FILE}" ]]; then
  bash "${SCRIPT_DIR}/wizard.sh"
else
  warn "${ENV_FILE} already exists; preserving it and skipping wizard"
fi
[[ -s "${ENV_FILE}" ]] || fail "environment file is empty: ${ENV_FILE}"

bold "Validating configuration"
required_vars=(POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET WALLET_INTERNAL_TOKEN PAYMENT_INTERNAL_TOKEN LAUNCHPAD_INTERNAL_TOKEN LAUNCHPAD_WALLET_INTERNAL_TOKEN)
for key in "${required_vars[@]}"; do
  value="$(grep -E "^${key}=" "${ENV_FILE}" | tail -1 | cut -d= -f2- || true)"
  [[ -n "${value}" && "${value}" != "change-me" && "${value}" != "change-me-in-prod" ]] || fail "required secret is missing or unsafe: ${key}"
done
ok "Required secrets are present"

if [[ "${SKIP_BUILD}" -eq 0 ]]; then
  bold "Building images"
  compose build
else
  warn "Skipping image build by request"
fi

bold "Starting the stack"
compose up -d

bold "Waiting for service health"
if [[ "${PRODUCTION}" -eq 1 ]]; then
  services=(postgres redis clickhouse elasticsearch minio nats kafka meilisearch otel-collector prometheus grafana loki backend frontend matching-engine trading-engine wallet-service launchpad-service payment-service notification-service analytics ai-engine nginx)
else
  services=(postgres redis nats backend frontend payment-service wallet-service launchpad-service)
fi
for attempt in $(seq 1 90); do
  unhealthy=0
  for service in "${services[@]}"; do
    container="$(compose ps -q "${service}" 2>/dev/null || true)"
    [[ -n "${container}" ]] || { unhealthy=1; continue; }
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container}" 2>/dev/null || true)"
    [[ "${status}" == "healthy" || ( "${status}" == "running" && "${service}" == "frontend" ) ]] || unhealthy=1
done
  [[ "${unhealthy}" -eq 0 ]] && break
  [[ "${attempt}" -eq 90 ]] && warn "health checks still pending after 180 seconds"
  sleep 2
done
[[ "${unhealthy}" -eq 0 ]] || { compose ps; fail "one or more services did not become healthy"; }
ok "Core services are healthy"

bold "Database migration"
if compose config --services | grep -qx 'migrate'; then
  compose run --rm migrate
else
  warn "No dedicated migrate service is defined; preserving existing migration workflow"
fi

bold "Done"
cat <<EOF

Profile:  $([[ "${PRODUCTION}" -eq 1 ]] && echo production || echo development)$([[ "${LOW_COST}" -eq 1 ]] && echo ' + low-cost resources' || true)
Frontend: http://localhost:3000
API:      http://localhost:8080

Useful commands:
  make logs
  make ps
  make backup
  make wizard
EOF
