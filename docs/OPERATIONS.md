# Operating Model

## Ownership

| Surface | Primary owner | Change path |
| --- | --- | --- |
| Invoice/domain code | Application team | Pull request, CI, signed image, promotion PR |
| Kubernetes desired state | Platform team | Pull request and Argo CD |
| Database schema | Application plus DBA reviewer | Checksummed pre-rollout Sync hook |
| AWS infrastructure | Platform team | Reviewed Terraform plan/apply |
| Alerts and SLOs | Service owner | Pull request with runbook and routing test |

## Release gate

A promotion requires green application/integration tests, four image scans, rendered production manifests, Terraform/Ansible validation, immutable digests, provenance/SBOM, migration compatibility, and an identified rollback digest. Argo CD reconciles only after the digest PR is approved and merged.

## Production access

Routine changes use Git and automation. Direct cluster/database access is time-bounded, named, audited, and incident/change-ticket linked. The optional Ansible-managed host is break-glass infrastructure; it is not a permanent deployment runner.

## On-call handoff

The outgoing engineer records active incidents, muted alerts with expiry, current error-budget state, pending migrations/promotions, provider degradation, and manual mitigations. Temporary actions without owner and expiry are treated as defects.

## Data lifecycle

| Data | Online retention | Reason |
| --- | ---: | --- |
| Invoices, payments, refunds | Business/legal policy; no automated deletion | Financial source of truth |
| Audit events | Append-only; no automated deletion | Investigation and accountability |
| Idempotency responses | 7 days | Covers normal client retry windows without unbounded JSON growth |
| Published outbox plus delivery attempts | 30 days after terminal delivery | Operational replay and incident analysis |
| Payment webhook receipts | 400 days | Replay evidence across annual provider reconciliation cycles |

The worker deletes only bounded batches every six hours. It never deletes a published outbox event without a terminal delivery record, and it never deletes financial or audit rows. Retention failures are structured error logs and must be investigated before table growth threatens SLOs.
