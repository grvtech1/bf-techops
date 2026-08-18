#!/usr/bin/env bash
set -Eeuo pipefail

missing=()
for tool in docker kind kubectl curl node npm; do
  command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done
if ((${#missing[@]})); then
  printf 'Missing required tools: %s\n' "${missing[*]}" >&2
  exit 1
fi
docker info >/dev/null 2>&1 || { echo 'Docker daemon is not reachable.' >&2; exit 1; }
docker compose version
kind version
kubectl version --client
node --version
npm --version
echo 'Preflight passed.'

