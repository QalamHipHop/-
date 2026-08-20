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
  MINIO_ROOT_PASSWORD MEILI_MASTER_KEY JWT_SECRET CSRF_SECRET WALLET_INTERNAL_TOKEN WALLET_BACKEND_TOKEN WALLET_PAYMENT_TOKEN WALLET_LAUNCHPAD_TOKEN LAUNCHPAD_INTERNAL_TOKEN PAYMENT_INTERNAL_TOKEN
  GF_ADMIN_PASSWORD API_BASE_URL EVM_RPC_URL EVM_CHAIN_ID
  WALLET_CUSTODY_MODE VAULT_ADDR VAULT_TOKEN WITHDRAWAL_ALLOWED_SIGNER_IDS
  ZARINPAL_ENABLED ZARINPAL_SANDBOX ZARINPAL_MERCHANT_ID ZARINPAL_CALLBACK_URL MANUAL_PAYMENT_ENABLED
  LAUNCHPAD_AMM_ENDPOINT RIAL_LEDGER_AUTHORITY PAYMENT_WALLET_BASE_URL MATCHING_ENABLED
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

declare -A seen_service_tokens=()
for key in WALLET_INTERNAL_TOKEN WALLET_BACKEND_TOKEN WALLET_PAYMENT_TOKEN WALLET_LAUNCHPAD_TOKEN LAUNCHPAD_INTERNAL_TOKEN PAYMENT_INTERNAL_TOKEN; do
  value=$(get_value "$key")
  [[ -z "$value" ]] && continue
  if [[ -n "${seen_service_tokens[$value]+x}" ]]; then
    echo "ERROR: service-scoped tokens must be distinct (duplicate detected for $key)" >&2
    failed=1
  else
    seen_service_tokens["$value"]="$key"
  fi
done
if [[ "$(get_value MANUAL_PAYMENT_ENABLED)" != false ]]; then
  echo "ERROR: MANUAL_PAYMENT_ENABLED must equal false in production" >&2
  failed=1
fi
if [[ "$(get_value ZARINPAL_ENABLED)" != true ]]; then
  echo "ERROR: ZARINPAL_ENABLED must equal true for Iranian-rial deposits" >&2
  failed=1
fi
if [[ "$(get_value ZARINPAL_SANDBOX)" != false ]]; then
  echo "ERROR: ZARINPAL_SANDBOX must equal false in production" >&2
  failed=1
fi
if [[ "$(get_value ZARINPAL_CALLBACK_URL)" != https://* ]]; then
  echo "ERROR: ZARINPAL_CALLBACK_URL must use https" >&2
  failed=1
fi
if [[ "$(get_value LAUNCHPAD_AMM_ENDPOINT)" != https://* ]]; then
  echo "ERROR: LAUNCHPAD_AMM_ENDPOINT must use https" >&2
  failed=1
fi
if [[ "$(get_value RIAL_LEDGER_AUTHORITY)" != wallet-service ]]; then
  echo "ERROR: RIAL_LEDGER_AUTHORITY must equal wallet-service" >&2
  failed=1
fi
if [[ "$(get_value MATCHING_ENABLED)" != true ]]; then
  echo "ERROR: MATCHING_ENABLED must equal true in production" >&2
  failed=1
fi

if [[ "$(get_value NODE_ENV)" != production ]]; then
  echo "ERROR: NODE_ENV must equal production" >&2
  failed=1
fi
if [[ "$(get_value WALLET_CUSTODY_MODE)" != vault ]]; then
  echo "ERROR: WALLET_CUSTODY_MODE must equal vault in production" >&2
  failed=1
fi
if [[ "$(get_value VAULT_ADDR)" != https://* ]]; then
  echo "ERROR: VAULT_ADDR must use https" >&2
  failed=1
fi

if [[ "$(get_value PAYMENT_WALLET_BASE_URL)" != http://* && "$(get_value PAYMENT_WALLET_BASE_URL)" != https://* ]]; then
  echo "ERROR: PAYMENT_WALLET_BASE_URL must be an explicit internal HTTP(S) URL" >&2
  failed=1
fi
if [[ "$(get_value API_BASE_URL)" != https://* ]]; then
  echo "ERROR: API_BASE_URL must use https" >&2
  failed=1
fi
if [[ "$(get_value EVM_RPC_URL)" != https://* ]]; then
  echo "ERROR: EVM_RPC_URL must use https" >&2
  failed=1
fi
if ! [[ "$(get_value EVM_CHAIN_ID)" =~ ^[0-9]+$ ]]; then
  echo "ERROR: EVM_CHAIN_ID must be numeric" >&2
  failed=1
fi

if (( failed )); then
  echo "Production environment validation failed; no deployment should be started." >&2
  exit 1
fi

echo "Production environment validation passed."
