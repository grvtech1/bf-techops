#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kubectl apply --kustomize "$ROOT_DIR/deploy/k8s/overlays/local"
kubectl -n merchant-platform rollout status statefulset/mysql --timeout=10m
kubectl -n merchant-platform wait --for=condition=complete job/merchant-platform-migrate --timeout=10m
kubectl -n merchant-platform wait --for=condition=complete job/merchant-platform-seed --timeout=5m
kubectl -n merchant-platform rollout status deployment/redis --timeout=5m
kubectl -n merchant-platform rollout status deployment/merchant-api --timeout=10m
kubectl -n merchant-platform rollout status deployment/merchant-worker --timeout=10m
kubectl -n merchant-platform rollout status deployment/merchant-portal --timeout=10m
kubectl -n merchant-platform get pods -o wide
echo 'Local platform deployment is ready.'

