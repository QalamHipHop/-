#!/usr/bin/env bash
# Reject development defaults before a public deployment. Does not print secret values.
set -euo pipefail

ENV_FILE=${1:-.env.production}
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: production environment file not found: $ENV_FILE" >&2
  exit 2
fi

get_value() {
  local key=$1
  local line
  line=$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)
  printf '%s' "${line#*=}"
}

required=(
  NODE_ENV POSTGRES_PASSWORD REDIS_PASSWORD CLICKHOUSE_PASSWORD
  MINIO_ROOT_PASSWORD MEILI_MASTER_KEY JWT_SECRET CSRF_SECRET WALLET_INTERNAL_TOKEN LAUNCHPAD_INTERNAL_TOKEN
  GF_ADMIN_PASSWORD API_BASE_URL SOLANA_MAINNET_RPC_URL
)

failed=0
for key in "${required[@]}"; do
  value=$(get_value "$key")
  if [[ -z "$value" || "$value" == REPLACE_* || "$value" == change-me || "$value" == admin ]]; then
    echo "ERROR: $key is missing or still a template/default value" >&2
    failed=1
  elif [[ "$key" == *PASSWORD || "$key" == *SECRET || "$key" == *KEY || "$key" == *TOKEN ]] && (( ${#value} < 32 )); then
    echo "ERROR: $key must be at least 32 characters" >&2
    failed=1
  fi
done

if [[ "$(get_value NODE_ENV)" != production ]]; then
  echo "ERROR: NODE_ENV must equal production" >&2
  failed=1
fi
if [[ "$(get_value API_BASE_URL)" != https://* ]]; then
  echo "ERROR: API_BASE_URL must use https" >&2
  failed=1
fi
if [[ "$(get_value SOLANA_MAINNET_RPC_URL)" != https://* ]]; then
  echo "ERROR: SOLANA_MAINNET_RPC_URL must use https" >&2
  failed=1
fi

if (( failed )); then
  echo "Production environment validation failed; no deployment should be started." >&2
  exit 1
fi

echo "Production environment validation passed."
