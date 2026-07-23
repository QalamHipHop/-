#!/usr/bin/env bash
# =========================================================================
#  ﷼ Platform — Configuration wizard
#  Generates a `.env` file from `.env.example` and a small set of prompts.
#  Idempotent: re-running updates only the values you change.
# =========================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

ask(){
  local var="$1" label="$2" default="$3" secret="${4:-}"
  local cur
  cur=$(grep -E "^${var}=" .env | head -1 | cut -d= -f2- || true)
  [[ -n "$cur" ]] && default="$cur"
  local prompt
  if [[ "$secret" == "secret" ]]; then
    prompt="${label} [****hidden****]: "
  else
    prompt="${label} [${default}]: "
  fi
  read -r -p "$prompt" val
  val="${val:-$default}"
  # escape / for sed
  esc=$(printf '%s\n' "$val" | sed -e 's/[\/&]/\\&/g')
  if grep -qE "^${var}=" .env; then
    sed -i.bak "s|^${var}=.*|${var}=${esc}|" .env
  else
    printf '\n%s=%s\n' "$var" "$val" >> .env
  fi
}

echo "==================  ﷼ Configuration Wizard  ==================="
echo "Press Enter to accept the default shown in brackets."
echo

ask APP_NAME              "Platform name"                          "RIAL"
ask APP_DOMAIN            "Public domain (no protocol)"            "localhost"
ask SETTLEMENT_TOKEN_NAME "Settlement token display name"          "﷼"
ask SETTLEMENT_TOKEN_SYMBOL "Settlement token ticker"              "RIAL"
ask EXCHANGE_RATE_STRATEGY "FX strategy (fixed|floating|external)"  "external"
ask EXCHANGE_RATE_FIXED    "Fixed FX (USD per 1 ﷼, blank if n/a)"   ""
ask POSTGRES_PASSWORD      "PostgreSQL password"                   "change-me" secret
ask REDIS_PASSWORD         "Redis password"                        "change-me" secret
ask JWT_SECRET             "JWT secret (>=32 random bytes)"        "$(head -c 32 /dev/urandom | base64 | tr -d '\n')" secret
ask ENCRYPTION_AT_REST     "Enable encryption at rest (true|false)" "true"

# ---- payment adapters --------------------------------------------------
echo
echo "Payment adapters (comma-separated). At least one is recommended."
echo "  Available: stripe, parsiq, crypto-onramp, manual-bank"
ask PAYMENT_ADAPTERS       "Enabled payment adapters"             "stripe,crypto-onramp"
ask PAYMENT_DEFAULT_ADAPTER "Default payment adapter"             "stripe"

# ---- chains -----------------------------------------------------------
echo
echo "Blockchain adapters (EVM and/or Solana). At least one is recommended."
ask EVM_RPC_URL            "EVM RPC URL"                          "https://eth.llamarpc.com"
ask EVM_CHAIN_ID           "EVM chain id"                         "1"
ask SOLANA_RPC_URL         "Solana RPC URL"                       "https://api.mainnet-beta.solana.com"

# ---- confirm -----------------------------------------------------------
echo
echo "Configuration written to .env"
echo "Review before bringing the stack up."
