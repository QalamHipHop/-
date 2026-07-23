#!/usr/bin/env bash
# Run a single service in dev mode (hot-reload). Usage: ./scripts/dev.sh backend
set -euo pipefail
SVC="${1:-backend}"
case "$SVC" in
  backend)       cd backend       && pnpm install && pnpm dev ;;
  frontend)      cd frontend      && pnpm install && pnpm dev ;;
  payment)       cd payment-service && pnpm install && pnpm dev ;;
  notification)  cd notification-service && pnpm install && pnpm dev ;;
  analytics)     cd analytics     && pnpm install && pnpm dev ;;
  matching)      cd matching-engine && cargo run ;;
  trading)       cd trading-engine && cargo run ;;
  wallet)        cd wallet-service && go run ./... ;;
  launchpad)     cd launchpad-service && go run ./... ;;
  ai)            cd ai-engine     && python -m uvicorn app.main:app --reload ;;
  *) echo "unknown service: $SVC"; exit 1 ;;
esac
