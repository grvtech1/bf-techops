#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="${1:-manual}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$ROOT_DIR/evidence/runs/${STAMP}-${LABEL}"
mkdir -p "$OUT"

git -C "$ROOT_DIR" rev-parse HEAD > "$OUT/git-revision.txt" 2>&1 || true
git -C "$ROOT_DIR" status --short > "$OUT/git-status.txt" 2>&1 || true
kubectl version > "$OUT/kubectl-version.txt" 2>&1 || true
kubectl get nodes -o wide > "$OUT/nodes.txt" 2>&1 || true
kubectl -n merchant-platform get all -o wide > "$OUT/workloads.txt" 2>&1 || true
kubectl -n merchant-platform get events --sort-by=.lastTimestamp > "$OUT/events.txt" 2>&1 || true
kubectl -n merchant-platform get deploy -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.template.spec.containers[0].image}{"\n"}{end}' > "$OUT/images.txt" 2>&1 || true
kubectl -n argocd get application merchant-platform -o yaml > "$OUT/argocd-application.yaml" 2>&1 || true
kubectl -n merchant-platform logs -l app.kubernetes.io/name=merchant-api --all-containers --since=15m --prefix > "$OUT/api-logs.txt" 2>&1 || true
kubectl -n merchant-platform logs -l app.kubernetes.io/name=merchant-worker --all-containers --since=15m --prefix > "$OUT/worker-logs.txt" 2>&1 || true

echo "Evidence captured in $OUT"

