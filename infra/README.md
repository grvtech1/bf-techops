# Infrastructure

The AWS stack is intentionally production-only and incurs cost. It provisions a three-AZ VPC, EKS with Bottlerocket ARM64 managed nodes, RDS MySQL Multi-AZ, encrypted Valkey replication, ECR repositories, Secrets Manager records, ACM/WAF/Route53 integration, EBS CSI, CloudWatch Observability, and narrowly scoped controller/workload IAM roles.

## Apply order

1. Copy `backend.tf.example` to `backend.tf` and use an existing versioned, encrypted state bucket.
2. Set variables through an approved CI environment; never commit `terraform.tfvars` with provider credentials.
3. Run `terraform init`, `terraform fmt -check`, `terraform validate`, and `terraform plan -out=tfplan`.
4. Obtain a reviewed plan approval before `terraform apply tfplan`.
5. Run `make addons` to install pinned External Secrets, AWS Load Balancer Controller, KEDA, ExternalDNS, the Secrets Manager store, and the encrypted retained `gp3` storage class. Terraform owns EBS CSI and CloudWatch Observability add-ons.
6. Run `make configure-production`; it writes non-secret DNS, ACM, WAF, and OIDC endpoint outputs into the production Ingress. Review that diff through a pull request.
7. Run `OBSERVABILITY_PROFILE=production GRAFANA_ADMIN_PASSWORD='<secure-channel-value>' make monitoring` to provision retained metrics/alert/dashboard volumes.
8. Configure GitHub OIDC repository variables, merge a green release promotion, install Argo CD, and run the production release gate from `docs/PRODUCTION_GO_LIVE.md`.

The database migration Job connects with the migration credential. Application workloads use `merchant_app`; the migration runner creates and grants that account before application rollout. Secrets Manager values are sensitive Terraform state, so the remote state bucket and access policy are security boundaries.
