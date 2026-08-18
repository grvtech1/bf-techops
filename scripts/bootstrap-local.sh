#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo 'Created .env from local-only example values.'
fi

ensure_local_setting() {
  local key="$1"
  local value="$2"
  if ! grep -q "^${key}=" .env; then
    printf '\n%s=%s\n' "$key" "$value" >> .env
    echo "Added ${key} to the local environment."
  fi
}

ensure_local_setting PAYMENT_PROVIDER sandboxpay
ensure_local_setting PAYMENT_WEBHOOK_SECRET local-payment-webhook-secret-change-me-32-chars
ensure_local_setting PAYMENT_WEBHOOK_TOLERANCE_SECONDS 300
ensure_local_setting ALERT_WEBHOOK_TOKEN local-alert-webhook-token-change-me

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

npm run check
npm run build
docker compose up --build --detach

for _ in {1..120}; do
  if curl -fsS http://127.0.0.1:8080/health/ready >/dev/null 2>&1 && \
     curl -fsS http://127.0.0.1:9091/health/ready >/dev/null 2>&1 && \
     curl -fsS http://127.0.0.1:3000 >/dev/null 2>&1; then
    bash scripts/smoke-test.sh
    echo 'Merchant Platform local bootstrap passed.'
    exit 0
  fi
  sleep 5
done

docker compose ps >&2
docker compose logs --tail=200 api worker portal migrate seed >&2
echo 'Services did not become ready within 10 minutes.' >&2
exit 1
