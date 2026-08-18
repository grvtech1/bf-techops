# Project Narrative

## Accurate short description

Designed and implemented an original merchant billing platform with tenant-authorized invoicing, signed payment/refund callbacks, append-only audit, a MySQL transactional outbox, BullMQ/Redis delivery worker, Next.js operations portal, Kubernetes GitOps delivery, AWS Terraform, observability, supply-chain controls, and executable recovery gates.

## Demonstrable engineering decisions

- Chose a modular API plus independent worker because financial consistency and async delivery have different failure/scaling models; avoided artificial service sprawl.
- Separated platform authentication from merchant identity and authorized every caller-supplied store against persisted hierarchy.
- Used server-calculated integer money, actor-scoped idempotency, and a unique request fingerprint to make retries safe.
- Made MySQL the durable event source and added reconciliation so complete Redis loss delays notifications without deleting committed work.
- Scaled API on utilization and worker on queue backlog, with bounded retries, DLQ, SLOs, alert routing, and executable runbooks.
- Published signed multi-architecture images by digest through a reviewed GitOps promotion rather than deploying mutable tags from CI.
- Separated local evidence from production claims: live status requires real DNS/TLS/IdP/provider inputs, a reviewed Terraform apply, exact Argo revision equality, and timestamped release-gate output.

This narrative describes repository work only. Do not present it as employment history or claim production traffic, team size, uptime, cost savings, or incident impact until independently evidenced.
