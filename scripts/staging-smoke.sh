#!/usr/bin/env bash
# RIAL staging smoke gate. This script only observes endpoints; it does not mutate funds.
set -Eeuo pipefail

CURL_TIMEOUT="${CURL_TIMEOUT:-5}"
RETRIES="${RETRIES:-12}"
SLEEP_SECONDS="${SLEEP_SECONDS:-5}"

check_url() {
  local name="$1" url="$2" expected="${3:-}"
  local attempt body status
  for attempt in $(seq 1 "$RETRIES"); do
    body="$(curl --silent --show-error --max-time "$CURL_TIMEOUT" --write-out $'\n%{http_code}' "$url" 2>/dev/null || true)"
    status="${body##*$'\n'}"
    body="${body%$'\n'*}"
    if [[ "$status" =~ ^2[0-9][0-9]$ ]] && { [[ -z "$expected" ]] || grep -Fq "$expected" <<<"$body"; }; then
      printf 'PASS %-22s %s (%s)\n' "$name" "$url" "$status"
      return 0
    fi
    (( attempt == RETRIES )) || sleep "$SLEEP_SECONDS"
  done
  printf 'FAIL %-22s %s (last status=%s)\n' "$name" "$url" "${status:-unreachable}" >&2
  return 1
}

failures=0
check_url backend-ready "${BACKEND_URL:-http://127.0.0.1:8080}/v1/readyz" 'ready' || failures=$((failures + 1))
check_url backend-metrics "${BACKEND_URL:-http://127.0.0.1:8080}/metrics" 'rial_' || failures=$((failures + 1))
check_url wallet-ready "${WALLET_URL:-http://127.0.0.1:50053}/readyz" 'ready' || failures=$((failures + 1))
check_url launchpad-health "${LAUNCHPAD_URL:-http://127.0.0.1:50054}/healthz" 'ok' || failures=$((failures + 1))
check_url payment-health "${PAYMENT_URL:-http://127.0.0.1:50055}/healthz" 'ok' || failures=$((failures + 1))
check_url notification-health "${NOTIFICATION_URL:-http://127.0.0.1:50056}/healthz" 'OK' || failures=$((failures + 1))
check_url analytics-ready "${ANALYTICS_URL:-http://127.0.0.1:50057}/readyz" 'ready' || failures=$((failures + 1))
check_url ai-health "${AI_URL:-http://127.0.0.1:50058}/healthz" 'ok' || failures=$((failures + 1))

if (( failures > 0 )); then
  echo "Staging smoke gate failed: ${failures} endpoint(s) unavailable or unhealthy." >&2
  exit 1
fi
echo 'Staging smoke gate passed.'
