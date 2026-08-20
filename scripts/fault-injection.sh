#!/usr/bin/env bash
# Controlled staging fault injection. Never run against production.
# Usage: CONFIRM_FAULT=YES FAULT_TARGET=nats|wallet|backend bash scripts/fault-injection.sh
set -Eeuo pipefail

: "${CONFIRM_FAULT:?Set CONFIRM_FAULT=YES only after selecting an isolated staging project}"
[[ "$CONFIRM_FAULT" == "YES" ]] || { echo 'Fault injection blocked.' >&2; exit 1; }
[[ "${RIAL_ENV:-staging}" == "staging" ]] || { echo 'RIAL_ENV must equal staging.' >&2; exit 1; }
TARGET="${FAULT_TARGET:?Set FAULT_TARGET to nats, wallet, or backend}"
case "$TARGET" in nats|wallet|backend) ;; *) echo 'Unsupported FAULT_TARGET' >&2; exit 1 ;; esac

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE_PRODUCTION="${COMPOSE_PRODUCTION:-0}"
COMPOSE_ARGS=(-f "$COMPOSE_FILE")
if [[ "$COMPOSE_PRODUCTION" == "1" ]]; then COMPOSE_ARGS+=(-f docker-compose.production.yml); fi
compose() { docker compose "${COMPOSE_ARGS[@]}" "$@"; }

command -v docker >/dev/null 2>&1 || { echo 'docker is required' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Docker daemon unavailable' >&2; exit 1; }

case "$TARGET" in
  nats) SERVICE=nats; RECOVERY_SERVICE=backend ;;
  wallet) SERVICE=wallet-service; RECOVERY_SERVICE=backend ;;
  backend) SERVICE=backend; RECOVERY_SERVICE=frontend ;;
esac

cleanup() {
  echo "==> Restoring ${SERVICE}"
  compose start "$SERVICE" >/dev/null
  compose up -d "$RECOVERY_SERVICE" >/dev/null
}
trap cleanup EXIT

echo "==> Stopping ${SERVICE} in isolated staging"
compose stop "$SERVICE"
echo "==> Waiting for dependent health failure to become observable"
sleep "${FAULT_WAIT_SECONDS:-10}"

if [[ "${SKIP_SMOKE_DURING_FAULT:-0}" != "1" ]]; then
  echo '==> Running smoke gate while fault is active (failure is expected for affected paths)'
  set +e
  bash scripts/staging-smoke.sh
  set -e
fi

echo "==> Fault window complete; recovery is handled by trap"
