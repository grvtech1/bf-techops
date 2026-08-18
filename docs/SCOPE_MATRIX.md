# Scope Matrix

This matrix prevents a polished repository from being mistaken for evidence it does not contain.

| Capability | Implemented here | External proof needed before production claim |
| --- | --- | --- |
| Merchant/store authorization | Persisted hierarchy; actor-derived tenant scope; cross-tenant tests | Real IdP claims and access-policy review |
| Initial tenant onboarding | Idempotent, change-ticketed CLI with exact-match refusal and transactional audit | Approved merchant/store metadata and time-bound migration credentials |
| Invoice lifecycle | Integer money, server totals, state machine, optimistic versioning, idempotency | Product acceptance and real tax/legal rules |
| Payments/refunds | Signed raw-body callbacks, replay window, partial/full bounds, atomic audit/outbox | Provider sandbox certification and secret rotation |
| Audit | Append-only table, mutation-blocking DB triggers, tenant reads | Retention/legal review and controlled operator access |
| Async delivery | MySQL outbox, Redis/BullMQ, retries, reconciliation, DLQ | Real notification-provider contract and quotas |
| Portal | OIDC-protected operations UI and server-side API proxy | Real OIDC client, role mapping, and browser acceptance |
| AWS runtime | Terraform for EKS/RDS/Valkey/ECR/TLS/WAF/DNS/IRSA/logging/storage | Approved account, plan, cost, apply, and AWS evidence |
| Delivery | CI tests/scans, SBOM/provenance, keyless signatures, digest promotion PR, Argo CD | Repository settings, branch protection, ECR and live sync |
| Recovery | Local isolated dump/restore gate and same-region RDS PITR design | Timed RDS restore; objectives are not achieved RPO/RTO |
| Observability | Prometheus rules, Grafana dashboard, Alertmanager routing, CloudWatch add-on | Real scrape/alert delivery, log query, and retention review |

## Deliberately absent

This is not a complete BillFree clone or a claim about BillFree internals. It does not implement inventory, catalog, settlement ledger, payout reconciliation, disputes/chargebacks, GST/e-invoice compliance, SMS/WhatsApp vendor specifics, customer PII lifecycle, mobile APIs, or regional disaster recovery. Adding those without product, finance, security, and compliance owners would create fictional completeness rather than production quality.
