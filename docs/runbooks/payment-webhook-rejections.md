# Payment Webhook Rejections

## Trigger

`MerchantPlatformPaymentWebhookRejected` fires when more than five callbacks are rejected in ten minutes for signature, event-time, replay-conflict, or financial-state reasons.

## First checks

```bash
kubectl -n merchant-platform logs -l app.kubernetes.io/name=merchant-api --since=15m --prefix |
  grep 'v1/payments/webhooks'

kubectl -n merchant-platform get secret merchant-api-runtime \
  -o jsonpath='{.metadata.resourceVersion}'; echo

curl -sG http://127.0.0.1:9090/api/v1/query \
  --data-urlencode 'query=sum by (outcome,event_type) (increase(merchant_platform_payment_webhooks_total[15m]))'
```

Never print the webhook secret, signature, raw callback, customer contact, or provider credential while investigating.

## Decision path

1. `signature_rejected`: compare provider signing-version documentation, secret version metadata, sender clock, and the exact proxy/body-transformation path. Do not weaken signature verification.
2. `invalid_event_time`: compare provider and node UTC clocks. A delayed provider queue needs a reviewed replay-window change, not a one-off manual payment update.
3. `duplicate`: expected during provider retries; confirm the payload hash is unchanged and no duplicate payment/refund exists.
4. `rejected`: inspect invoice/payment state, currency, captured total, and refunded total using identifiers from structured logs. Never patch totals directly in MySQL.

## Mitigation and recovery

- Keep callbacks retrying at the provider while correcting secret/clock/proxy configuration.
- Rotate the webhook secret through Secrets Manager and a reviewed rollout if compromise is suspected.
- Replay authentic provider events through the original signed endpoint after the fault is corrected.
- Confirm invoice state, payment/refund rows, immutable audit events, outbox publication, and notification delivery.

## Closure evidence

Capture alert timestamps, secret version metadata, clock comparison, representative request IDs, corrected configuration revision, replay outcomes, invoice/payment/refund state, and the point when rejected-callback rate returned to zero.
