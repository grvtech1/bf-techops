# Architecture

## Problem and scope

Merchant Platform supports a root merchant with one or more stores. Authorized operators issue invoices and the platform asynchronously sends customer notifications. The first release optimizes for correctness, recoverability, and operational visibility rather than a large service count.

## Deployable units

### API

The NestJS API owns synchronous merchant/invoice operations, signed provider payment callbacks, refunds, audit reads, and tenant-scoped operations. A database transaction persists each financial change with its append-only audit record, webhook receipt when applicable, and outbox event. This prevents dual-write failures where money state commits but its operational evidence or downstream notification disappears.

### Worker

The worker is independently scalable and has no public HTTP surface. An outbox relay publishes committed events to BullMQ. Jobs use a stable event ID for deduplication, exponential backoff for transient failures, a bounded attempt count, and a dead-letter queue for terminal failures.

### Operations portal

The Next.js portal is an operational interface, not a marketing site. It exposes authorized stores, invoice/payment state, append-only audit events, notification backlog, dependency readiness, and the deployed release. The ALB performs OIDC login and forwards the access token to a server-side proxy, so the platform API key does not enter the browser bundle.

## Trust boundaries

1. `X-Platform-Api-Key` authenticates the trusted client application, not a merchant.
2. Production verifies an OIDC JWT against a remote JWKS, issuer, audience, expiry, `merchant_id`, and roles. The local HMAC token exists only in non-production.
3. Every target `storeId` is authorized using the persisted merchant hierarchy.
4. Money is submitted as integer minor units and totals are calculated server-side.
5. Idempotency keys are unique per actor and operation; a repeated payload returns the original result while a conflicting payload returns `409`.
6. Secrets come from environment variables locally and AWS Secrets Manager through External Secrets in production.

## Data ownership

MySQL is the source of truth for merchants, stores, invoices, line items, payments, refunds, provider webhook receipts, audit events, idempotency records, outbox events, and delivery attempts. Redis is disposable transport state. Rebuilding Redis must not lose committed financial events because unpublished outbox rows remain in MySQL.

## Deployment paths

### Local

Docker Compose and the kind overlay run MySQL and Redis beside the workloads. Seed identities are deterministic and contain no real customer data.

### Production

The AWS path uses EKS on private Bottlerocket workers, Metrics Server plus Cluster Autoscaler, RDS MySQL Multi-AZ, encrypted Valkey, ECR, TLS ALBs with WAF, Secrets Manager, ExternalDNS, persistent Prometheus/Grafana volumes, and the CloudWatch Observability add-on for container logs and infrastructure telemetry. Terraform provisions managed infrastructure; Argo CD reconciles application manifests by immutable signed image digest.

## Failure model

| Failure | Expected behavior | Detection |
| --- | --- | --- |
| Duplicate invoice request | Original invoice returned; no duplicate event | Idempotency conflict metric |
| Duplicate or altered provider callback | Original event outcome returned, or altered replay rejected | Webhook rejection metric and alert |
| Redis unavailable | Invoice still commits; outbox backlog grows | Dependency readiness and oldest-outbox alert |
| Notification provider 5xx | Retry with backoff, then DLQ | Failure-rate and DLQ alerts |
| MySQL unavailable | Readiness fails; writes rejected | DB probe and API error-rate alert |
| Bad release | Progressive rollout stops; previous digest remains available | Argo health, rollout alert, smoke test |
| Worker/node loss | Jobs are reclaimed; duplicate delivery blocked by event ID | Queue stalled/age metrics |

## Deliberate non-goals

- No fake microservice split: module boundaries can be extracted only after independent scaling or ownership becomes real.
- No cardholder-data acquisition: capture/refund callbacks contain provider IDs and integer amounts, never PAN, CVV, magnetic-stripe, or PIN data.
- No accounting ledger, settlement reconciliation, chargeback workflow, inventory, or jurisdiction-specific tax engine; those require product and compliance ownership.
- No in-cluster production database: stateful dependencies are managed AWS services.
- No Ansible inside Kubernetes: Ansible is limited to host configuration where it has a clear ownership boundary.
