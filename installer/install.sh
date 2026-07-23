#!/usr/bin/env bash
# =========================================================================
#  ﷼ Platform — One-command installer
#  Usage:   sudo bash installer/install.sh
#  Effects: detects environment, runs the wizard, brings the stack up.
# =========================================================================
set -euo pipefail

bold(){ printf "\033[1m%s\033[0m\n" "$*"; }
ok(){   printf "  \033[32m✔\033[0m %s\n" "$*"; }
warn(){ printf "  \033[33m!\033[0m %s\n" "$*"; }
err(){  printf "  \033[31m✖\033[0m %s\n" "$*"; }

# ---- 1. preflight ------------------------------------------------------
bold "Preflight checks"

need_cmd(){ command -v "$1" >/dev/null 2>&1 || { err "missing: $1"; exit 1; }; }
need_cmd curl
need_cmd git

if command -v docker >/dev/null 2>&1; then
  ok "docker $(docker --version | awk '{print $3}' | tr -d ',')"
else
  err "Docker is not installed. Install Docker Engine >= 24 first."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  ok "docker compose $(docker compose version | awk '{print $4}')"
else
  err "docker compose plugin is missing."
  exit 1
fi

# ---- 2. wizard ---------------------------------------------------------
bold "Configuration wizard"
bash "$(dirname "$0")/wizard.sh"

# ---- 3. build + bring up ----------------------------------------------
bold "Building images (first run may take a few minutes)"
docker compose --env-file .env -f docker-compose.yml build

bold "Starting the stack"
docker compose --env-file .env -f docker-compose.yml up -d

# ---- 4. wait for healthy ---------------------------------------------
bold "Waiting for services to become healthy..."
for i in $(seq 1 60); do
  HEALTHY=$(docker compose -f docker-compose.yml ps --format json 2>/dev/null | grep -c '"Health":"healthy"' || true)
  TOTAL=$(docker compose -f docker-compose.yml ps --format json 2>/dev/null | grep -c '"Service"' || true)
  if [[ "$HEALTHY" -ge 8 ]]; then break; fi
  sleep 2
done

# ---- 5. summary -------------------------------------------------------
bold "Done."
cat <<EOF

  Open in your browser:

    Frontend        http://localhost:3000
    Admin           http://localhost:3001
    API             http://localhost:8080
    Grafana         http://localhost:3002   (admin / admin)
    Prometheus      http://localhost:9090
    Kibana          http://localhost:5601

  Useful commands:
    make logs            # tail all logs
    make logs-backend    # tail one service
    make ps              # list running services
    make backup          # run a manual backup
    make wizard          # re-run the configuration wizard
    make kube-install    # install the Helm chart on a cluster

EOF
