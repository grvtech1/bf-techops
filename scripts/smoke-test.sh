#!/usr/bin/env bash
set -Eeuo pipefail

API_URL="${API_URL:-http://127.0.0.1:8080}"
PORTAL_URL="${PORTAL_URL:-http://127.0.0.1:3000}"
PLATFORM_API_KEY="${PLATFORM_API_KEY:-local-platform-api-key-change-me}"
PAYMENT_PROVIDER="${PAYMENT_PROVIDER:-sandboxpay}"
PAYMENT_WEBHOOK_SECRET="${PAYMENT_WEBHOOK_SECRET:-local-payment-webhook-secret-change-me-32-chars}"

curl --fail --silent --show-error "${API_URL}/health/ready" | grep -q '"status":"ready"'

TOKEN=$(curl --fail --silent --show-error \
  -X POST \
  -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
  "${API_URL}/v1/auth/dev-token" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
test -n "${TOKEN}"

STORES=$(curl --fail --silent --show-error \
  -H "authorization: Bearer ${TOKEN}" \
  -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
  "${API_URL}/v1/stores")
printf '%s' "${STORES}" | grep -q '10000000-0000-4000-8000-000000000002'
if printf '%s' "${STORES}" | grep -q '10000000-0000-4000-8000-000000000099'; then
  echo 'Cross-tenant store leaked through the authorized store directory.' >&2
  exit 1
fi

KEY="smoke:$(date -u +%Y%m%dT%H%M%SZ):0001"
BODY='{"storeId":"10000000-0000-4000-8000-000000000002","customerName":"Smoke Test","customerContact":"smoke@example.test","currency":"INR","discountMinor":500,"taxRateBasisPoints":1800,"items":[{"description":"Smoke order","quantity":2,"unitPriceMinor":5000}]}'

FIRST=$(curl --fail --silent --show-error \
  -X POST \
  -H "authorization: Bearer ${TOKEN}" \
  -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
  -H "idempotency-key: ${KEY}" \
  -H "content-type: application/json" \
  --data "${BODY}" \
  "${API_URL}/v1/invoices")
SECOND=$(curl --fail --silent --show-error \
  -X POST \
  -H "authorization: Bearer ${TOKEN}" \
  -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
  -H "idempotency-key: ${KEY}" \
  -H "content-type: application/json" \
  --data "${BODY}" \
  "${API_URL}/v1/invoices")

FIRST_ID=$(printf '%s' "${FIRST}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
SECOND_ID=$(printf '%s' "${SECOND}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
test -n "${FIRST_ID}"
test "${FIRST_ID}" = "${SECOND_ID}"

CONFLICT_CODE=$(curl --silent --output /tmp/merchant-idempotency-conflict.json --write-out '%{http_code}' \
  -X POST \
  -H "authorization: Bearer ${TOKEN}" \
  -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
  -H "idempotency-key: ${KEY}" \
  -H "content-type: application/json" \
  --data "${BODY/Smoke Test/Changed Payload}" \
  "${API_URL}/v1/invoices")
test "${CONFLICT_CODE}" = "409"

DENIED_BODY='{"storeId":"10000000-0000-4000-8000-000000000099","customerName":"Denied Tenant","customerContact":"denied@example.test","currency":"INR","discountMinor":0,"taxRateBasisPoints":0,"items":[{"description":"Unauthorized order","quantity":1,"unitPriceMinor":100}]}'
DENIED_CODE=$(curl --silent --output /tmp/merchant-cross-tenant.json --write-out '%{http_code}' \
  -X POST \
  -H "authorization: Bearer ${TOKEN}" \
  -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
  -H "idempotency-key: tenant-denial-test-0001" \
  -H "content-type: application/json" \
  --data "${DENIED_BODY}" \
  "${API_URL}/v1/invoices")
test "${DENIED_CODE}" = "403"

curl --fail --silent --show-error \
  -H "authorization: Bearer ${TOKEN}" \
  -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
  "${API_URL}/v1/invoices/${FIRST_ID}" | grep -q "${FIRST_ID}"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
PAYMENT_ID="pay-${RUN_ID}-0001"
TIMESTAMP="$(date -u +%s)"
OCCURRED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

sign_payload() {
  PAYMENT_BODY="$1" PAYMENT_TIMESTAMP="$2" PAYMENT_SECRET="${PAYMENT_WEBHOOK_SECRET}" node -e '
    const { createHmac } = require("node:crypto");
    process.stdout.write(createHmac("sha256", process.env.PAYMENT_SECRET)
      .update(`${process.env.PAYMENT_TIMESTAMP}.${process.env.PAYMENT_BODY}`)
      .digest("hex"));
  '
}

CAPTURE_BODY=$(printf '{"providerEventId":"evt-%s-capture","eventType":"payment.captured","providerPaymentId":"%s","invoiceId":"%s","amountMinor":11210,"currency":"INR","occurredAt":"%s"}' \
  "${RUN_ID}" "${PAYMENT_ID}" "${FIRST_ID}" "${OCCURRED_AT}")
CAPTURE_SIGNATURE="$(sign_payload "${CAPTURE_BODY}" "${TIMESTAMP}")"
CAPTURED=$(curl --fail --silent --show-error \
  -X POST \
  -H "content-type: application/json" \
  -H "x-payment-timestamp: ${TIMESTAMP}" \
  -H "x-payment-signature: ${CAPTURE_SIGNATURE}" \
  --data "${CAPTURE_BODY}" \
  "${API_URL}/v1/payments/webhooks/${PAYMENT_PROVIDER}")
printf '%s' "${CAPTURED}" | grep -q '"duplicate":false'
printf '%s' "${CAPTURED}" | grep -q '"invoiceStatus":"PAID"'

DUPLICATE=$(curl --fail --silent --show-error \
  -X POST \
  -H "content-type: application/json" \
  -H "x-payment-timestamp: ${TIMESTAMP}" \
  -H "x-payment-signature: ${CAPTURE_SIGNATURE}" \
  --data "${CAPTURE_BODY}" \
  "${API_URL}/v1/payments/webhooks/${PAYMENT_PROVIDER}")
printf '%s' "${DUPLICATE}" | grep -q '"duplicate":true'

BAD_SIGNATURE_CODE=$(curl --silent --output /tmp/merchant-bad-payment-signature.json --write-out '%{http_code}' \
  -X POST \
  -H "content-type: application/json" \
  -H "x-payment-timestamp: ${TIMESTAMP}" \
  -H 'x-payment-signature: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  --data "${CAPTURE_BODY}" \
  "${API_URL}/v1/payments/webhooks/${PAYMENT_PROVIDER}")
test "${BAD_SIGNATURE_CODE}" = "401"

REFUND_ONE_BODY=$(printf '{"providerEventId":"evt-%s-refund-1","eventType":"payment.refunded","providerPaymentId":"%s","providerRefundId":"refund-%s-0001","invoiceId":"%s","amountMinor":1210,"currency":"INR","occurredAt":"%s"}' \
  "${RUN_ID}" "${PAYMENT_ID}" "${RUN_ID}" "${FIRST_ID}" "${OCCURRED_AT}")
REFUND_ONE_SIGNATURE="$(sign_payload "${REFUND_ONE_BODY}" "${TIMESTAMP}")"
REFUND_ONE=$(curl --fail --silent --show-error \
  -X POST \
  -H "content-type: application/json" \
  -H "x-payment-timestamp: ${TIMESTAMP}" \
  -H "x-payment-signature: ${REFUND_ONE_SIGNATURE}" \
  --data "${REFUND_ONE_BODY}" \
  "${API_URL}/v1/payments/webhooks/${PAYMENT_PROVIDER}")
printf '%s' "${REFUND_ONE}" | grep -q '"invoiceStatus":"PARTIALLY_REFUNDED"'

REFUND_ID_REUSE_BODY=$(printf '{"providerEventId":"evt-%s-refund-id-reuse","eventType":"payment.refunded","providerPaymentId":"%s","providerRefundId":"refund-%s-0001","invoiceId":"%s","amountMinor":1,"currency":"INR","occurredAt":"%s"}' \
  "${RUN_ID}" "${PAYMENT_ID}" "${RUN_ID}" "${FIRST_ID}" "${OCCURRED_AT}")
REFUND_ID_REUSE_SIGNATURE="$(sign_payload "${REFUND_ID_REUSE_BODY}" "${TIMESTAMP}")"
REFUND_ID_REUSE_CODE=$(curl --silent --output /tmp/merchant-refund-id-reuse.json --write-out '%{http_code}' \
  -X POST \
  -H "content-type: application/json" \
  -H "x-payment-timestamp: ${TIMESTAMP}" \
  -H "x-payment-signature: ${REFUND_ID_REUSE_SIGNATURE}" \
  --data "${REFUND_ID_REUSE_BODY}" \
  "${API_URL}/v1/payments/webhooks/${PAYMENT_PROVIDER}")
test "${REFUND_ID_REUSE_CODE}" = "409"

REFUND_TWO_BODY=$(printf '{"providerEventId":"evt-%s-refund-2","eventType":"payment.refunded","providerPaymentId":"%s","providerRefundId":"refund-%s-0002","invoiceId":"%s","amountMinor":10000,"currency":"INR","occurredAt":"%s"}' \
  "${RUN_ID}" "${PAYMENT_ID}" "${RUN_ID}" "${FIRST_ID}" "${OCCURRED_AT}")
REFUND_TWO_SIGNATURE="$(sign_payload "${REFUND_TWO_BODY}" "${TIMESTAMP}")"
REFUND_TWO=$(curl --fail --silent --show-error \
  -X POST \
  -H "content-type: application/json" \
  -H "x-payment-timestamp: ${TIMESTAMP}" \
  -H "x-payment-signature: ${REFUND_TWO_SIGNATURE}" \
  --data "${REFUND_TWO_BODY}" \
  "${API_URL}/v1/payments/webhooks/${PAYMENT_PROVIDER}")
printf '%s' "${REFUND_TWO}" | grep -q '"invoiceStatus":"REFUNDED"'

FINAL_INVOICE=$(curl --fail --silent --show-error \
  -H "authorization: Bearer ${TOKEN}" \
  -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
  "${API_URL}/v1/invoices/${FIRST_ID}")
printf '%s' "${FINAL_INVOICE}" | grep -q '"status":"REFUNDED"'
printf '%s' "${FINAL_INVOICE}" | grep -q '"version":4'

# Two callbacks race for an invoice that can afford only one capture. Row locking
# must serialize them so one succeeds and the other returns a business conflict.
RACE_KEY="smoke:${RUN_ID}:race:0001"
RACE_BODY='{"storeId":"10000000-0000-4000-8000-000000000002","customerName":"Concurrent Capture","customerContact":"race@example.test","currency":"INR","discountMinor":0,"taxRateBasisPoints":0,"items":[{"description":"Race order","quantity":1,"unitPriceMinor":10000}]}'
RACE_INVOICE=$(curl --fail --silent --show-error \
  -X POST \
  -H "authorization: Bearer ${TOKEN}" \
  -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
  -H "idempotency-key: ${RACE_KEY}" \
  -H "content-type: application/json" \
  --data "${RACE_BODY}" \
  "${API_URL}/v1/invoices")
RACE_INVOICE_ID=$(printf '%s' "${RACE_INVOICE}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
test -n "${RACE_INVOICE_ID}"

for suffix in a b; do
  body=$(printf '{"providerEventId":"evt-%s-race-%s","eventType":"payment.captured","providerPaymentId":"pay-%s-race-%s","invoiceId":"%s","amountMinor":7000,"currency":"INR","occurredAt":"%s"}' \
    "${RUN_ID}" "${suffix}" "${RUN_ID}" "${suffix}" "${RACE_INVOICE_ID}" "${OCCURRED_AT}")
  signature="$(sign_payload "${body}" "${TIMESTAMP}")"
  curl --silent --output "/tmp/merchant-race-${suffix}.json" --write-out '%{http_code}' \
    -X POST \
    -H "content-type: application/json" \
    -H "x-payment-timestamp: ${TIMESTAMP}" \
    -H "x-payment-signature: ${signature}" \
    --data "${body}" \
    "${API_URL}/v1/payments/webhooks/${PAYMENT_PROVIDER}" > "/tmp/merchant-race-${suffix}.code" &
done
wait
RACE_CODES=$(sort /tmp/merchant-race-{a,b}.code | tr '\n' ' ')
test "${RACE_CODES}" = "200 409 "
RACE_FINAL=$(curl --fail --silent --show-error \
  -H "authorization: Bearer ${TOKEN}" \
  -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
  "${API_URL}/v1/invoices/${RACE_INVOICE_ID}")
printf '%s' "${RACE_FINAL}" | grep -q '"status":"PARTIALLY_PAID"'

PAYMENTS=$(curl --fail --silent --show-error \
  -H "authorization: Bearer ${TOKEN}" \
  -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
  "${API_URL}/v1/payments?limit=20")
printf '%s' "${PAYMENTS}" | grep -q "${PAYMENT_ID}"
printf '%s' "${PAYMENTS}" | grep -q '"refundedMinor":11210'

AUDIT=$(curl --fail --silent --show-error \
  -H "authorization: Bearer ${TOKEN}" \
  -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
  "${API_URL}/v1/audit-events?limit=20")
printf '%s' "${AUDIT}" | grep -q '"action":"invoice.created"'
printf '%s' "${AUDIT}" | grep -q '"action":"payment.captured"'
printf '%s' "${AUDIT}" | grep -q '"action":"payment.refunded"'

OTHER_TOKEN=$(ACTOR_SECRET="${ACTOR_TOKEN_SECRET:-local-actor-token-secret-change-me-32-chars}" node -e '
  const { createHmac } = require("node:crypto");
  const payload = {
    actorMerchantId: "00000000-0000-4000-8000-000000000099",
    subject: "tenant-isolation-check",
    roles: ["invoice:read", "payment:read", "audit:read", "ops:read"],
    exp: Math.floor(Date.now() / 1000) + 300
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", process.env.ACTOR_SECRET).update(body).digest("base64url");
  process.stdout.write(`${body}.${signature}`);
')
OTHER_SUMMARY=$(curl --fail --silent --show-error \
  -H "authorization: Bearer ${OTHER_TOKEN}" \
  -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
  "${API_URL}/v1/ops/summary")
printf '%s' "${OTHER_SUMMARY}" | grep -q '"invoices":0'
printf '%s' "${OTHER_SUMMARY}" | grep -q '"payments":0'
printf '%s' "${OTHER_SUMMARY}" | grep -q '"refunds":0'

for _ in {1..30}; do
  SUMMARY=$(curl --fail --silent --show-error \
    -H "authorization: Bearer ${TOKEN}" \
    -H "x-platform-api-key: ${PLATFORM_API_KEY}" \
    "${API_URL}/v1/ops/summary")
  DELIVERED=$(printf '%s' "${SUMMARY}" | sed -n 's/.*"successfulDeliveries":\([0-9][0-9]*\).*/\1/p')
  [[ "${DELIVERED:-0}" -ge 4 ]] && break
  sleep 1
done
[[ "${DELIVERED:-0}" -ge 4 ]]
printf '%s' "${SUMMARY}" | grep -Eq '"payments":[1-9][0-9]*'
REFUNDS=$(printf '%s' "${SUMMARY}" | sed -n 's/.*"refunds":\([0-9][0-9]*\).*/\1/p')
[[ "${REFUNDS:-0}" -ge 2 ]]

curl --fail --silent --show-error "${PORTAL_URL}" | grep -q "Merchant billing"
curl --fail --silent --show-error "${API_URL}/metrics" | grep -q "merchant_platform_invoices_total"

printf 'Smoke passed: invoice=%s replay=true conflict=409 tenant_denial=403 payment=verified refund=full concurrent_overcapture=blocked audit=present deliveries=%s portal=ready metrics=ready\n' "${FIRST_ID}" "${DELIVERED}"
