# Merchant Platform

An original, production-oriented merchant billing system built as an application and a platform-engineering case study. It is deliberately more than a deployment demo: a merchant can create an invoice, accept replay-safe signed payment/refund callbacks, preserve an append-only audit trail, and atomically publish durable events to a retrying notification worker.

This repository uses no proprietary BillFree source code, credentials, customer data, or internal configuration. The domain is independently implemented from common retail-platform requirements.

## What is here

- `apps/api`: NestJS HTTP API for actors, stores, invoices, payments/refunds, audit, operations, health, and metrics.
- `apps/worker`: BullMQ worker for invoice-notification delivery, retry, and DLQ processing.
- `apps/portal`: Next.js operations portal for invoice, queue, and release visibility.
- `packages/domain`: dependency-free financial and authorization rules with executable tests.
- `database`: versioned MySQL migrations and local seed data.
- `deploy`: Docker, Kubernetes, Kustomize, Argo CD, Prometheus, Grafana, and Alertmanager assets.
- `infra`: Terraform for the AWS production path and narrowly scoped Ansible automation.
- `docs`: architecture decisions, SLOs, runbooks, threat model, and evidence requirements.

## Business path

```text
operator -> OIDC/portal -> API -> MySQL invoice + audit + outbox (one transaction)
payment provider -> signed webhook -> payment/refund + audit + receipt + outbox
                                               |
                                               v
                                  outbox relay -> Redis/BullMQ -> worker
                                               |
                                               v
                  notification provider + Prometheus/Grafana + CloudWatch logs
```

The API key identifies the calling application. A signed actor token identifies the merchant operator. A caller-supplied store ID is always authorized against that actor; it never establishes identity.

## Local quick start

Prerequisites: Docker with Compose v2, Node.js 24, `kubectl`, and `kind` for the Kubernetes path.

```bash
make bootstrap
```

The first run creates `.env`, verifies the lockfile, tests and builds every workspace, starts dependencies and workloads, then proves tenant denial, idempotent replay/conflict, signed capture/refund handling, immutable audit behavior, asynchronous delivery, portal rendering, and metrics.

Open the portal at `http://localhost:3000`. The API is available at `http://localhost:8080`; Prometheus-format metrics are at `http://localhost:8080/metrics`.

## Kubernetes and GitOps

```bash
./scripts/bootstrap-kind.sh
./scripts/install-observability.sh
./scripts/install-argocd.sh
./scripts/deploy-local.sh
./scripts/smoke-test.sh
```

Local Kubernetes runs MySQL and Redis inside the cluster. The production overlay expects managed AWS RDS and ElastiCache endpoints supplied through External Secrets; it does not deploy stateful databases into EKS.

## Production gate

`make release-gate` validates a local release candidate, including a dependency audit, non-root containers, an isolated database restore, Kubernetes rendering, and Terraform validation. `bash scripts/release-gate.sh production` additionally requires a clean reviewed Git revision, real AWS/IdP/DNS inputs, signed ECR digests, healthy AWS add-ons, ready External Secrets, persistent monitoring, Argo CD revision equality, successful rollouts, and HTTPS smoke tests.

See `docs/PRODUCTION_GO_LIVE.md` for the exact apply sequence and `docs/SCOPE_MATRIX.md` for the boundary between implemented behavior and integrations that need an authorized production environment. No AWS production deployment is claimed by this repository alone.

## Evidence standard

The repository proves capabilities, not employment history. A claim is accepted only when it has a reproducible command, timestamped output, and a corresponding design or incident decision. See `docs/ACCEPTANCE.md` and `docs/runbooks/`.
