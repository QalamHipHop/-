#!/usr/bin/env bash
# Pull latest, rebuild, rolling-restart the stack.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> git pull"
git pull --rebase --autostash

echo "==> rebuild images"
docker compose -f docker-compose.yml build

echo "==> rolling restart"
docker compose -f docker-compose.yml up -d --remove-orphans

echo "==> health check"
sleep 10
docker compose -f docker-compose.yml ps

echo "Update complete."
