# Acceptance Criteria

The platform is considered demonstrable only when every critical path below has command-generated evidence.

## Business correctness

- Invoice totals use integer minor units and server-side tax/discount calculation.
- A valid merchant actor can issue an invoice for an owned store.
- A merchant actor cannot read or issue an invoice for another merchant's store.
- Reusing an idempotency key with the same request returns the original invoice.
- Reusing an idempotency key with a different request returns `409 Conflict`.
- Invoice and outbox event commit in one MySQL transaction.
- A notification job can retry, succeed, and enter a DLQ after bounded failures.
- Payment callbacks are authenticated over the exact raw body, time bounded, and replay safe.
- Partial/full payment and refund totals cannot exceed their invoice/payment boundaries.
- Invoice, payment/refund, audit, and outbox changes commit atomically.
- Operations and audit responses contain only the actor merchant hierarchy.
- Database triggers reject audit-event mutation and deletion.

## Platform behavior

- API, worker, and portal run as non-root containers with read-only root filesystems in Kubernetes.
- Liveness checks process survival. API readiness checks configuration and MySQL; worker readiness checks MySQL and Redis so a cache outage cannot falsely claim the API itself has lost committed invoice durability.
- Two API replicas survive a single worker-node outage without breaking the smoke path.
- Argo CD reports `Synced/Healthy` at the Git revision under test.
- Production image references are digest pinned.
- A rollback restores the previous digest without rebuilding an image.

## Delivery and security

- Pull requests execute unit tests, builds, manifest validation, Terraform validation, secret scanning, vulnerability scanning, and SBOM generation.
- The publish workflow signs or attests the immutable image and proposes a GitOps digest update through a pull request.
- Database migrations run as a separately observable, checksummed job before application promotion.
- Kubernetes RBAC, NetworkPolicy, PodDisruptionBudget, topology spreading, requests/limits, and autoscaling are present and validated.

## Observability and operations

- Logs are structured JSON and include request, actor, invoice, event, and release correlation fields when applicable.
- Prometheus scrapes API and worker metrics.
- Dashboards show request rate/errors/latency, invoice outcomes, outbox age, queue depth, notification failure, pod health, and release identity.
- Alerts exist for sustained 5xx rate, latency, dependency failure, outbox age, DLQ growth, and unavailable replicas.
- Each alert links to a tested runbook.
- Evidence collection records Git revision, image digest, Kubernetes state, smoke output, metrics, and alert state.
- CloudWatch Observability reports the EKS add-on `ACTIVE` and the bounded-retention application log group exists.
- Production Prometheus, Alertmanager, and Grafana claims are `Bound` on encrypted retained EBS volumes.
- The release restore drill reproduces financial/audit row counts and both append-only audit triggers in an isolated database.
