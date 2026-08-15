#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API="http://localhost:50054"
WALLET="http://localhost:50053"
WALLET_INTERNAL_TOKEN="$(sed -n 's/^WALLET_INTERNAL_TOKEN=//p' "$ROOT_DIR/.env" | tail -n1)"
if [[ -z "$WALLET_INTERNAL_TOKEN" ]]; then
  echo "WALLET_INTERNAL_TOKEN is required in .env for E2E verification" >&2
  exit 1
fi
wallet_curl() { curl -fsS -H "X-Rial-Internal-Token: $WALLET_INTERNAL_TOKEN" "$@"; }
LAUNCHPAD_INTERNAL_TOKEN="$(sed -n 's/^LAUNCHPAD_INTERNAL_TOKEN=//p' "$ROOT_DIR/.env" | tail -n1)"
if [[ -z "$LAUNCHPAD_INTERNAL_TOKEN" ]]; then
  echo "LAUNCHPAD_INTERNAL_TOKEN is required in .env for E2E verification" >&2
  exit 1
fi
launchpad_curl() { curl -fsS -H "X-Rial-Internal-Token: $LAUNCHPAD_INTERNAL_TOKEN" -H "X-Rial-User-ID: $TEST_USER_ID" "$@"; }
launchpad_admin_curl() { curl -fsS -H "X-Rial-Internal-Token: $LAUNCHPAD_INTERNAL_TOKEN" -H "X-Rial-User-ID: $ADMIN_ID" -H 'X-Rial-Actor-Roles: admin' "$@"; }
ADMIN_ID="$(sudo docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1"' | tr -d '\r' | tail -n1)"
if [[ ! "$ADMIN_ID" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "No seeded auth user is available for integration verification" >&2
  exit 1
fi

RUN_ID="$(date -u +%Y%m%d%H%M%S)"
# A fresh UUID keeps repeated integration runs independent of the per-creator
# launchpad policy; approval still uses the seeded admin actor above.
TEST_USER_ID="${E2E_USER_ID:-$(cat /proc/sys/kernel/random/uuid)}"
SYMBOL="Q$(date -u +%s | tail -c 7)"
ARTIFACT_DIR="/tmp/qalam-e2e-${RUN_ID}"
mkdir -p "$ARTIFACT_DIR"

curl -fsS "$API/healthz" >"$ARTIFACT_DIR/launchpad-health.json"
curl -fsS "$WALLET/readyz" >"$ARTIFACT_DIR/wallet-ready.json"

# This is a development-ledger credit, performed through the real wallet API.
# It is deliberately recorded as a testnet integration reference and not treated as fiat settlement.
wallet_curl -X POST "$WALLET/v1/credit" \
  -H 'Content-Type: application/json' \
  -d "{\"user_id\":\"$TEST_USER_ID\",\"amount\":500000000,\"type\":\"deposit\",\"reference\":\"devnet-integration-$RUN_ID\",\"idempotency_key\":\"credit-$RUN_ID\",\"metadata\":{\"environment\":\"development\",\"purpose\":\"launchpad-ledger-verification\"}}" \
  >"$ARTIFACT_DIR/wallet-credit.json"

launchpad_curl -X POST "$API/api/v1/tokens" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Qalam Ledger Verification $RUN_ID\",\"symbol\":\"$SYMBOL\",\"decimals\":8,\"total_supply\":\"100000000000000000\",\"chain\":\"solana-devnet\",\"contract_address\":\"pending-testnet-mint-$RUN_ID\",\"description\":\"Development integration verification for Qalamhiphop wallet-settled launch flow.\",\"curve_model\":\"sigmoid\",\"graduation_rial_minor\":69000000000}" \
  >"$ARTIFACT_DIR/token-created.json"

TOKEN_ID="$(grep -oE '"id":"[0-9a-fA-F-]{36}"' "$ARTIFACT_DIR/token-created.json" | head -n1 | cut -d'"' -f4)"
if [[ ! "$TOKEN_ID" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  cat "$ARTIFACT_DIR/token-created.json" >&2
  echo "Token creation did not return a token id" >&2
  exit 1
fi

launchpad_admin_curl -X POST "$API/api/v1/tokens/$TOKEN_ID/approve" \
  -H 'Content-Type: application/json' \
  -d '{}' \
  >"$ARTIFACT_DIR/token-approved.json"

launchpad_curl -X POST "$API/api/v1/tokens/$TOKEN_ID/quote-buy" \
  -H 'Content-Type: application/json' \
  -d '{"amount_in_minor":100000000}' \
  >"$ARTIFACT_DIR/buy-quote.json"

launchpad_curl -X POST "$API/api/v1/tokens/$TOKEN_ID/buy" \
  -H 'Content-Type: application/json' \
  -d "{\"amount_in_minor\":100000000,\"client_id\":\"buy-$RUN_ID\"}" \
  >"$ARTIFACT_DIR/buy-result.json"

wallet_curl "$WALLET/v1/accounts/$TEST_USER_ID/transactions?limit=10" >"$ARTIFACT_DIR/wallet-transactions.json"
curl -fsS "$API/api/v1/tokens/$TOKEN_ID" >"$ARTIFACT_DIR/token-final.json"

printf 'ADMIN_ID=%s\nTEST_USER_ID=%s\nTOKEN_ID=%s\nSYMBOL=%s\nARTIFACT_DIR=%s\n' "$ADMIN_ID" "$TEST_USER_ID" "$TOKEN_ID" "$SYMBOL" "$ARTIFACT_DIR"
