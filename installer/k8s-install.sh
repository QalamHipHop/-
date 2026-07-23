#!/usr/bin/env bash
# =========================================================================
#  ﷼ Platform — Kubernetes bootstrap (Helm)
# =========================================================================
set -euo pipefail
bold(){ printf "\033[1m%s\033[0m\n" "$*"; }
ok(){   printf "  \033[32m✔\033[0m %s\n" "$*"; }
err(){  printf "  \033[31m✖\033[0m %s\n" "$*"; }

command -v helm >/dev/null 2>&1 || { err "helm not installed"; exit 1; }
command -v kubectl >/dev/null 2>&1 || { err "kubectl not installed"; exit 1; }

bold "Creating namespace"
kubectl create namespace rial --dry-run=client -o yaml | kubectl apply -f -

bold "Creating/updating secrets from .env"
kubectl -n rial create secret generic rial-env \
  --from-env-file=.env \
  --dry-run=client -o yaml | kubectl apply -f -

bold "Installing Helm chart"
helm upgrade --install rial infrastructure/kubernetes/helm \
  --namespace rial \
  --set image.tag="${IMAGE_TAG:-latest}" \
  --wait

ok "Deployed. Check status with:  kubectl -n rial get pods"
