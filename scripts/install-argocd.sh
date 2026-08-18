#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARGOCD_VERSION="${ARGOCD_VERSION:-v3.4.2}"
REPO_URL="${REPO_URL:?Set REPO_URL to the Git clone URL.}"
GITOPS_PATH="${GITOPS_PATH:-deploy/k8s/overlays/local}"

kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl apply --server-side --force-conflicts -n argocd \
  -f "https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD_VERSION}/manifests/install.yaml"
kubectl wait -n argocd --for=condition=Available deployment --all --timeout=15m

sed "s|REPLACE_REPO_URL|$REPO_URL|g" "$ROOT_DIR/deploy/argocd/project.yaml" | kubectl apply -f -
sed -e "s|REPLACE_REPO_URL|$REPO_URL|g" \
    -e "s|REPLACE_GITOPS_PATH|$GITOPS_PATH|g" \
    "$ROOT_DIR/deploy/argocd/application.yaml" | kubectl apply -f -

for _ in {1..120}; do
  state="$(kubectl -n argocd get application merchant-platform -o jsonpath='{.status.sync.status}/{.status.health.status}' 2>/dev/null || true)"
  echo "Argo CD: ${state:-Pending}"
  [[ "$state" == "Synced/Healthy" ]] && exit 0
  sleep 5
done
kubectl -n argocd describe application merchant-platform >&2
exit 1

