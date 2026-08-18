#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-merchant-platform}"

if ! kind get clusters | grep -Fxq "$CLUSTER_NAME"; then
  kind create cluster --config "$ROOT_DIR/cluster/kind-config.yaml"
fi

for target in api worker portal migration local-seed; do
  image="merchant-platform-${target/local-seed/seed}:local"
  docker build --file "$ROOT_DIR/deploy/docker/Dockerfile" --target "$target" --tag "$image" "$ROOT_DIR"
  kind load docker-image --name "$CLUSTER_NAME" "$image"
done

kubectl config use-context "kind-${CLUSTER_NAME}"
kubectl get nodes -o wide
echo 'Cluster and local images are ready.'

