#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-candidate}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$ROOT_DIR/evidence/runs/${STAMP}-release-${MODE}"
mkdir -p "$OUT"
exec > >(tee "$OUT/release-gate.log") 2>&1
cd "$ROOT_DIR"

if [[ "$MODE" != "candidate" && "$MODE" != "production" ]]; then
  echo "Usage: $0 [candidate|production]" >&2
  exit 2
fi

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1" >&2; exit 1; }
}

for tool in node npm docker curl git kubectl terraform; do require "$tool"; done
test -f package-lock.json

echo "[1/8] Reproducible application and container gate"
bash scripts/bootstrap-local.sh

echo "[2/8] Runtime dependency audit"
npm audit --omit=dev --audit-level=high | tee "$OUT/npm-audit.txt"

echo "[3/8] Container identity and Compose model"
docker compose config > "$OUT/compose-rendered.yaml"
for service in api worker portal; do
  uid=$(docker compose exec -T "$service" id -u | tr -d '\r')
  test "$uid" != "0"
  printf '%s uid=%s\n' "$service" "$uid"
done
docker compose ps > "$OUT/compose-services.txt"

echo "[4/8] Backup and isolated restore"
bash scripts/verify-backup-restore.sh

echo "[5/8] Kubernetes render validation"
kubectl kustomize deploy/k8s/overlays/local > "$OUT/kubernetes-local.yaml"
kubectl kustomize deploy/k8s/overlays/production > "$OUT/kubernetes-production.yaml"
grep -q 'kind: Deployment' "$OUT/kubernetes-local.yaml"
grep -q 'kind: NetworkPolicy' "$OUT/kubernetes-production.yaml"
if grep -Eq 'image: .*:latest([[:space:]]|$)' "$OUT/kubernetes-production.yaml"; then
  echo "Mutable latest tag found in production manifests" >&2
  exit 1
fi

echo "[6/8] Terraform static validation"
terraform -chdir=infra/terraform/aws fmt -check -recursive
terraform -chdir=infra/terraform/aws init -backend=false -input=false
terraform -chdir=infra/terraform/aws validate

echo "[7/8] Repository evidence"
git status --short > "$OUT/git-status.txt"
git rev-parse HEAD > "$OUT/git-revision.txt" 2>/dev/null || true
npm ls --all > "$OUT/npm-tree.txt"

if [[ "$MODE" == "production" ]]; then
  echo "[8/8] Live production reconciliation"
  require cosign
  require aws
  test -z "$(git status --porcelain)"
  test "$(git branch --show-current)" = "main"
  if grep -R -nE 'REPLACE_[A-Z0-9_]+' deploy/k8s/overlays/production; then
    echo "Production placeholders remain" >&2
    exit 1
  fi
  mapfile -t images < <(grep -oE 'image: [^[:space:]]+@sha256:[a-f0-9]{64}' "$OUT/kubernetes-production.yaml" | awk '{print $2}' | sort -u)
  test "${#images[@]}" -eq 4
  for image in "${images[@]}"; do
    cosign verify \
      --certificate-identity "https://github.com/grvtech1/merchant-platform/.github/workflows/publish.yaml@refs/heads/main" \
      --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
      "$image" > "$OUT/cosign-$(echo "$image" | sha256sum | cut -c1-12).txt"
  done
  CLUSTER_NAME="$(terraform -chdir=infra/terraform/aws output -raw cluster_name)"
  AWS_REGION="$(terraform -chdir=infra/terraform/aws output -raw aws_region)"
  export AWS_REGION
  for addon in amazon-cloudwatch-observability aws-ebs-csi-driver metrics-server; do
    test "$(aws eks describe-addon --cluster-name "$CLUSTER_NAME" --addon-name "$addon" --query addon.status --output text)" = "ACTIVE"
  done
  kubectl -n kube-system rollout status deployment/cluster-autoscaler --timeout=5m
  kubectl top nodes > "$OUT/node-utilization.txt"
  APPLICATION_LOG_GROUP="/aws/containerinsights/${CLUSTER_NAME}/application"
  test "$(aws logs describe-log-groups --log-group-name-prefix "$APPLICATION_LOG_GROUP" --query 'logGroups[?logGroupName==`'"$APPLICATION_LOG_GROUP"'`].logGroupName | [0]' --output text)" = "$APPLICATION_LOG_GROUP"
  ALB_LOG_BUCKET="$(terraform -chdir=infra/terraform/aws output -raw alb_access_log_bucket)"
  test "$(aws s3api get-bucket-policy-status --bucket "$ALB_LOG_BUCKET" --query PolicyStatus.IsPublic --output text)" = "False"
  test "$(aws s3api get-bucket-encryption --bucket "$ALB_LOG_BUCKET" --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text)" = "AES256"
  test "$(aws wafv2 get-logging-configuration --resource-arn "$(terraform -chdir=infra/terraform/aws output -raw waf_web_acl_arn)" --query 'LoggingConfiguration.LogDestinationConfigs[0]' --output text)" != "None"
  ALERT_TOPIC_ARN="$(terraform -chdir=infra/terraform/aws output -raw platform_alert_topic_arn)"
  CONFIRMED_EMAIL_SUBSCRIPTIONS="$(aws sns list-subscriptions-by-topic --topic-arn "$ALERT_TOPIC_ARN" --query "length(Subscriptions[?Protocol=='email' && SubscriptionArn!='PendingConfirmation'])" --output text)"
  test "$CONFIRMED_EMAIL_SUBSCRIPTIONS" -ge 1
  kubectl -n merchant-platform wait --for=condition=Ready externalsecret --all --timeout=2m
  test "$(kubectl -n merchant-platform get ingress merchant-portal -o jsonpath='{.spec.rules[0].host}')" = "$(terraform -chdir=infra/terraform/aws output -raw portal_hostname)"
  test "$(kubectl -n merchant-platform get ingress merchant-api -o jsonpath='{.spec.rules[0].host}')" = "$(terraform -chdir=infra/terraform/aws output -raw api_hostname)"
  kubectl -n monitoring wait --for=condition=Ready pod --all --timeout=10m
  test -z "$(kubectl -n monitoring get pvc --no-headers | awk '$2 != "Bound" { print }')"
  bash scripts/verify-alert-delivery.sh
  test "$(kubectl -n argocd get application merchant-platform -o jsonpath='{.status.sync.status}/{.status.health.status}')" = "Synced/Healthy"
  test "$(kubectl -n argocd get application merchant-platform -o jsonpath='{.status.sync.revision}')" = "$(git rev-parse HEAD)"
  kubectl -n merchant-platform rollout status deployment/merchant-api --timeout=5m
  kubectl -n merchant-platform rollout status deployment/merchant-worker --timeout=5m
  kubectl -n merchant-platform rollout status deployment/merchant-portal --timeout=5m
  bash scripts/production-smoke.sh
  bash scripts/collect-evidence.sh production-release
else
  echo "[8/8] Candidate gate complete; cloud credentials and approved production inputs are intentionally not assumed."
fi

echo "Release gate passed. Evidence: $OUT"
