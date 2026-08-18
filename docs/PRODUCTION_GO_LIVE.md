# Production Go-Live

## Evidence states

| State | Meaning |
| --- | --- |
| Built | Source compiles and static validators pass |
| Locally verified | Docker/kind business path and restore drill pass with timestamped evidence |
| Release candidate | `make release-gate` passes, including online runtime dependency audit and Terraform validation |
| Production verified | Authorized AWS apply, third-party integrations, GitOps reconciliation, HTTPS smoke, logs, metrics, alerts, backup restore, and evidence all pass |

Never collapse these states into one resume or interview claim.

## Required external inputs

- Approved AWS account/region, owner, monthly budget, cost tags, and Terraform remote-state bucket with versioning, encryption, public-access block, least-privilege policy, and state locking.
- Existing public Route53 zone and approved portal/API hostnames.
- OIDC issuer/JWKS/audience, portal client, callback URLs, and access tokens containing bounded `merchant_id` and `roles` claims.
- Payment-provider signing contract and notification-provider endpoint, credentials, timeout, retry, and rate-limit agreement.
- On-call email/routing owner, escalation policy, change ticket, maintenance window, and rollback owner.
- GitHub repository with protected `main`, required CI reviews, Actions OIDC, and repository variables `AWS_PUBLISH_ROLE_ARN` and `AWS_REGION`.

## Apply sequence

1. Review `docs/THREAT_MODEL.md`, `docs/SCOPE_MATRIX.md`, RPO/RTO objectives, expected AWS cost, and data classification. Record approvals.
2. Configure `backend.tf` from the example and provide Terraform variables through an approved secret channel. Never commit provider credentials or secret tfvars.
3. Run `terraform init`, `terraform fmt -check -recursive`, `terraform validate`, and `terraform plan -out=tfplan`. Save the plan and obtain a second-person approval before `terraform apply tfplan`.
4. Configure `kubectl` for the new cluster. Run `make addons`; verify External Secrets, ALB controller, KEDA, ExternalDNS, EBS CSI, CloudWatch Observability, and `gp3-retain`.
5. Run `make configure-production`. Review and commit only the non-secret Ingress coordinates produced from Terraform outputs.
6. Run `OBSERVABILITY_PROFILE=production GRAFANA_ADMIN_PASSWORD='<secret>' make monitoring`. Confirm all monitoring PVCs are `Bound`, Prometheus targets are up, and a synthetic alert reaches the receiver.
7. Install Argo CD with the approved repository/path. Push application source, wait for CI, then review and merge the digest promotion PR only after migration compatibility and rollback digest are recorded.
8. Run the migration image with command `node scripts/provision-tenant.mjs` and time-bound migration credentials. Supply the approved change ID plus root merchant/store UUIDs and metadata; retain its structured output. A rerun must report `tenant_provisioning_noop`, while any mismatch must stop.
9. Confirm External Secrets are `Ready`, the migration hook succeeded, workloads are spread across workers, all images use four signed digests, and Argo reports the exact Git revision as `Synced/Healthy`.
10. Run a provider-sandbox capture/refund test in staging. Verify webhook receipt, financial state, audit event, outbox publication, provider delivery, Prometheus metric, and CloudWatch request correlation.
11. Export production smoke credentials through the approved shell session and run `bash scripts/release-gate.sh production`. Attach the evidence directory to the change record.

## Go/no-go blockers

- Any `REPLACE_*`, mutable/unsigned image, failed scan, unresolved high runtime vulnerability, dirty Git state, or Argo revision mismatch.
- Missing/expired TLS, internet-visible `/metrics`, OIDC token without tenant/role claims, unready External Secret, or log/metric/alert gap.
- Migration checksum drift, failed isolated restore, unconfirmed SNS/email subscription, no rollback digest, or no named incident owner.
- Payment callback without raw-body signature verification, excessive timestamp, altered replay rejection, or amount/refund boundary enforcement.

## Rollback and first-hour watch

Rollback means reverting the production digest commit, not rebuilding an old tag. Do not reverse a committed database migration unless a reviewed down-migration exists; prefer forward-compatible application rollback. During the first hour, watch 5xx/latency, webhook rejection rate, outbox age, queue/DLQ, RDS connections/CPU/storage, Valkey evictions, pod restarts, ALB target health, and CloudWatch log ingestion. Record the decision to continue or roll back.

## Current boundary

The repository contains the implementation and verification machinery. It is not a verified production deployment until the external inputs above exist and the final production evidence is captured. Formal company adoption can turn this into real assigned work; a personal deployment remains portfolio work and must be described that way.
