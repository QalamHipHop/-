#!/usr/bin/env bash
set -euo pipefail

EVM_RPC_URL="${EVM_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}"
SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"

printf 'Checking EVM RPC: %s\n' "$EVM_RPC_URL"
curl --fail --silent --show-error --max-time 15 "$EVM_RPC_URL" \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' >/tmp/rial-evm-rpc.json
cat /tmp/rial-evm-rpc.json
printf '\nChecking Solana RPC: %s\n' "$SOLANA_RPC_URL"
curl --fail --silent --show-error --max-time 15 "$SOLANA_RPC_URL" \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' >/tmp/rial-solana-rpc.json
cat /tmp/rial-solana-rpc.json

if [[ -n "${PAYMENT_STRIPE_SECRET:-}" ]]; then
  case "$PAYMENT_STRIPE_SECRET" in
    sk_live_*) echo 'Refusing to probe a live Stripe key from this development check.'; exit 1 ;;
    sk_test_*)
      printf '\nChecking Stripe test mode\n'
      curl --fail --silent --show-error --max-time 15 https://api.stripe.com/v1/balance \
        -u "$PAYMENT_STRIPE_SECRET:" >/tmp/rial-stripe-test.json
      cat /tmp/rial-stripe-test.json
      ;;
    *) echo 'PAYMENT_STRIPE_SECRET is set but does not look like a Stripe test key.'; exit 1 ;;
  esac
else
  echo 'Stripe check skipped: PAYMENT_STRIPE_SECRET is not configured.'
fi

echo 'External service checks passed.'
