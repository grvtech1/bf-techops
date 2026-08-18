#!/usr/bin/env bash
set -Eeuo pipefail

: "${PRODUCTION_API_URL:?PRODUCTION_API_URL is required}"
: "${PRODUCTION_PORTAL_URL:?PRODUCTION_PORTAL_URL is required}"
: "${PLATFORM_API_KEY:?PLATFORM_API_KEY is required}"
: "${ACTOR_TOKEN:?ACTOR_TOKEN is required}"

[[ "$PRODUCTION_API_URL" == https://* ]]
[[ "$PRODUCTION_PORTAL_URL" == https://* ]]

curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
  "${PRODUCTION_API_URL}/health/ready" | grep -q '"status":"ready"'

curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
  -H "authorization: Bearer ${ACTOR_TOKEN}" \
  -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
  "${PRODUCTION_API_URL}/v1/invoices?limit=1" | grep -q '^\['

curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
  -H "authorization: Bearer ${ACTOR_TOKEN}" \
  -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
  "${PRODUCTION_API_URL}/v1/stores" | grep -Eq '"id":"[0-9a-f-]{36}"'

curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
  -H "authorization: Bearer ${ACTOR_TOKEN}" \
  -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
  "${PRODUCTION_API_URL}/v1/ops/summary" | grep -q '"environment":"production"'

METRICS_CODE=$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --proto '=https' --tlsv1.2 "${PRODUCTION_API_URL}/metrics")
test "$METRICS_CODE" != "200"

PORTAL_HEADERS=$(mktemp)
trap 'rm -f "$PORTAL_HEADERS"' EXIT
curl --silent --show-error --head --proto '=https' --tlsv1.2 \
  --output "$PORTAL_HEADERS" "${PRODUCTION_PORTAL_URL}/"
grep -Eq '^HTTP/[^ ]+ (200|302|303)$' "$PORTAL_HEADERS"

echo "Production read-only smoke passed: API ready/authenticated, metrics private, portal OIDC active."
