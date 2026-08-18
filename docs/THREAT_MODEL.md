# Threat Model

## Protected assets

- Merchant hierarchy and invoice financial data.
- Customer contact information inside notification events.
- Actor-signing, platform API, database, cache, and provider credentials.
- Image provenance, GitOps desired state, migration history, and audit logs.

## Principal threats and controls

| Threat | Control | Verification |
| --- | --- | --- |
| Caller impersonates another merchant with `storeId` | OIDC issuer/audience/JWKS verification plus persisted hierarchy authorization | Cross-tenant domain test and API integration test |
| Duplicate client retry creates multiple invoices | Actor-scoped idempotency key, request hash, unique DB constraint | Smoke test submits identical request twice |
| Tampered invoice totals | Server calculates integer minor-unit totals | Domain tests; DTO does not accept totals |
| Forged or replayed payment callback changes financial state | HMAC over timestamp plus exact raw body, five-minute replay window, provider-event payload hash, unique constraints | Signature domain tests and signed lifecycle smoke test |
| Cross-tenant operations endpoint leaks fleet totals | Every invoice, payment, refund, outbox, delivery, and audit query is filtered through the persisted merchant hierarchy | Unrelated-merchant summary assertions in smoke test |
| Invoice commits but notification disappears | Transactional MySQL outbox and Redis-loss reconciliation | Outbox test/runbook and backlog metric |
| Credential leaks into browser or Git | Portal server proxy, External Secrets, secret scan, no committed production values | Trivy secret scan and rendered-manifest review |
| Compromised container escalates | Non-root UID, read-only root, dropped capabilities, RuntimeDefault seccomp, no service-account token | CI image and Kustomize validation |
| Malicious image reaches production | CI vulnerability gate, SBOM/provenance, keyless signature, digest-only GitOps PR | Workflow run and signature verification |
| Notification retry sends duplicates | Stable event ID, BullMQ job ID, provider idempotency header, durable success check | Delivery-attempt records and provider contract test |
| Unreviewed schema change damages production | Checksummed migration ledger, DB lock, pre-rollout Sync hook, restricted app user, backup/rollback gate | Migration logs and runbook |
| Application code alters historical audit records | Audit rows commit in the business transaction; database triggers reject UPDATE and DELETE | Migration inspection and integration smoke evidence |

## Residual risks

The production identity proxy and notification provider are external trust dependencies. Card payment data is deliberately out of scope. NetworkPolicy restricts workload traffic, while AWS security groups remain the authoritative RDS/ElastiCache boundary because standard NetworkPolicy cannot express managed-service DNS identities.
