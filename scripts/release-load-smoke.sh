#!/usr/bin/env bash
# Read-only release load smoke. It never creates orders, payments, withdrawals or tokens.
set -Eeuo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
REQUESTS="${REQUESTS:-200}"
CONCURRENCY="${CONCURRENCY:-20}"
MAX_ERROR_RATE="${MAX_ERROR_RATE:-0.01}"
ENDPOINT="${ENDPOINT:-/v1/readyz}"

for command in curl awk sed xargs; do command -v "$command" >/dev/null 2>&1 || { echo "missing command: $command" >&2; exit 1; }; done
[[ "$REQUESTS" =~ ^[0-9]+$ && "$REQUESTS" -gt 0 ]] || { echo 'REQUESTS must be a positive integer' >&2; exit 1; }
[[ "$CONCURRENCY" =~ ^[0-9]+$ && "$CONCURRENCY" -gt 0 ]] || { echo 'CONCURRENCY must be a positive integer' >&2; exit 1; }

TMP="${TMPDIR:-/tmp}/rial-load-$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

seq "$REQUESTS" | xargs -P "$CONCURRENCY" -I{} env \
  BASE_URL="$BASE_URL" ENDPOINT="$ENDPOINT" CURL_TIMEOUT="${CURL_TIMEOUT:-5}" \
  sh -c 'result="$(curl --silent --show-error --max-time "$CURL_TIMEOUT" --output /dev/null --write-out "%{http_code} %{time_total}" "${BASE_URL}${ENDPOINT}" 2>/dev/null || true)"; printf "%s\\n" "${result:-000 999}"' \
  > "$TMP/results"

total="$(wc -l < "$TMP/results")"
errors="$(awk '$1 !~ /^2/ {n++} END {print n+0}' "$TMP/results")"
avg_ms="$(awk '{sum += $2} END {if (NR) printf "%.2f", sum/NR*1000; else print "0"}' "$TMP/results")"
p95_ms="$(awk '{print $2}' "$TMP/results" | sort -n | awk -v n="$total" 'NR == int(n*0.95)+1 {printf "%.2f", $1*1000}')"
error_rate="$(awk -v e="$errors" -v t="$total" 'BEGIN {if (t) printf "%.6f", e/t; else print "1"}')"

printf 'endpoint=%s total=%s errors=%s error_rate=%s avg_ms=%s p95_ms=%s\n' "$ENDPOINT" "$total" "$errors" "$error_rate" "$avg_ms" "${p95_ms:-0}"
awk -v rate="$error_rate" -v max="$MAX_ERROR_RATE" 'BEGIN { exit !(rate <= max) }' || {
  echo "Load smoke failed: error rate exceeds MAX_ERROR_RATE=${MAX_ERROR_RATE}" >&2
  exit 1
}
echo 'Read-only load smoke passed.'
