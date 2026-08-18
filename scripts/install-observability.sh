#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART_VERSION="${KUBE_PROMETHEUS_STACK_VERSION:-87.21.0}"
GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:?Set GRAFANA_ADMIN_PASSWORD without committing it.}"
OBSERVABILITY_PROFILE="${OBSERVABILITY_PROFILE:-local}"

if [[ "$OBSERVABILITY_PROFILE" != "local" && "$OBSERVABILITY_PROFILE" != "production" ]]; then
  echo 'OBSERVABILITY_PROFILE must be local or production.' >&2
  exit 2
fi

values=(--values "$ROOT_DIR/deploy/monitoring/kube-prometheus-values.yaml")
if [[ "$OBSERVABILITY_PROFILE" == "production" ]]; then
  kubectl get storageclass gp3-retain >/dev/null
  values+=(--values "$ROOT_DIR/deploy/monitoring/kube-prometheus-values-production.yaml")
fi

command -v helm >/dev/null 2>&1 || { echo 'helm is required.' >&2; exit 1; }
helm upgrade --install monitoring \
  oci://ghcr.io/prometheus-community/charts/kube-prometheus-stack \
  --version "$CHART_VERSION" \
  --namespace monitoring \
  --create-namespace \
  "${values[@]}" \
  --set-string grafana.adminPassword="$GRAFANA_ADMIN_PASSWORD" \
  --wait --timeout 20m

kubectl label namespace monitoring kubernetes.io/metadata.name=monitoring --overwrite
kubectl apply -f "$ROOT_DIR/deploy/monitoring/service-monitors.yaml"
kubectl apply -f "$ROOT_DIR/deploy/monitoring/prometheus-rules.yaml"
kubectl apply -f "$ROOT_DIR/deploy/monitoring/grafana-dashboard.yaml"
kubectl apply -f "$ROOT_DIR/deploy/monitoring/alertmanager-config.yaml"
if [[ "$OBSERVABILITY_PROFILE" == "production" ]]; then
  kubectl -n monitoring wait --for=jsonpath='{.status.phase}'=Bound pvc --all --timeout=10m
fi
echo 'Observability resources are ready.'
