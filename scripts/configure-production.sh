#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT_DIR/infra/terraform/aws"
INGRESS="$ROOT_DIR/deploy/k8s/overlays/production/ingress.yaml"
NETWORK_POLICIES="$ROOT_DIR/deploy/k8s/overlays/production/network-policies.yaml"

for tool in terraform yq jq kubectl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing required tool: $tool" >&2; exit 1; }
done
if ! yq --version | grep -Eq 'version v?4\.'; then
  echo 'Mike Farah yq v4 is required.' >&2
  exit 1
fi

export PORTAL_HOSTNAME="$(terraform -chdir="$TF_DIR" output -raw portal_hostname)"
export API_HOSTNAME="$(terraform -chdir="$TF_DIR" output -raw api_hostname)"
export VPC_CIDR="$(terraform -chdir="$TF_DIR" output -raw vpc_cidr)"
export ACM_CERTIFICATE_ARN="$(terraform -chdir="$TF_DIR" output -raw acm_certificate_arn)"
export WAF_WEB_ACL_ARN="$(terraform -chdir="$TF_DIR" output -raw waf_web_acl_arn)"
ALB_LOG_BUCKET="$(terraform -chdir="$TF_DIR" output -raw alb_access_log_bucket)"
export ALB_ATTRIBUTES="routing.http.drop_invalid_header_fields.enabled=true,deletion_protection.enabled=true,access_logs.s3.enabled=true,access_logs.s3.bucket=${ALB_LOG_BUCKET}"
OIDC_ISSUER="$(terraform -chdir="$TF_DIR" output -raw portal_oidc_issuer)"
OIDC_AUTHORIZATION="$(terraform -chdir="$TF_DIR" output -raw portal_oidc_authorization_endpoint)"
OIDC_TOKEN="$(terraform -chdir="$TF_DIR" output -raw portal_oidc_token_endpoint)"
OIDC_USERINFO="$(terraform -chdir="$TF_DIR" output -raw portal_oidc_userinfo_endpoint)"
export OIDC_CONFIG
OIDC_CONFIG="$(jq -cn \
  --arg issuer "$OIDC_ISSUER" \
  --arg authorizationEndpoint "$OIDC_AUTHORIZATION" \
  --arg tokenEndpoint "$OIDC_TOKEN" \
  --arg userInfoEndpoint "$OIDC_USERINFO" \
  '{issuer:$issuer,authorizationEndpoint:$authorizationEndpoint,tokenEndpoint:$tokenEndpoint,userInfoEndpoint:$userInfoEndpoint,secretName:"merchant-portal-oidc"}')"

yq eval --inplace '
  (select(.kind == "Ingress" and .metadata.name == "merchant-portal") | .spec.rules[0].host) = strenv(PORTAL_HOSTNAME) |
  (select(.kind == "Ingress" and .metadata.name == "merchant-api") | .spec.rules[0].host) = strenv(API_HOSTNAME) |
  (select(.kind == "Ingress") | .metadata.annotations."alb.ingress.kubernetes.io/certificate-arn") = strenv(ACM_CERTIFICATE_ARN) |
  (select(.kind == "Ingress") | .metadata.annotations."alb.ingress.kubernetes.io/wafv2-acl-arn") = strenv(WAF_WEB_ACL_ARN) |
  (select(.kind == "Ingress") | .metadata.annotations."alb.ingress.kubernetes.io/load-balancer-attributes") = strenv(ALB_ATTRIBUTES) |
  (select(.kind == "Ingress" and .metadata.name == "merchant-portal") | .metadata.annotations."alb.ingress.kubernetes.io/auth-idp-oidc") = strenv(OIDC_CONFIG)
' "$INGRESS"

yq eval --inplace '
  (.. | select(tag == "!!str" and . == "REPLACE_VPC_CIDR")) = strenv(VPC_CIDR)
' "$NETWORK_POLICIES"

if grep -nE 'REPLACE_[A-Z0-9_]+' "$INGRESS" "$NETWORK_POLICIES"; then
  echo 'Production networking configuration still contains placeholders.' >&2
  exit 1
fi
kubectl kustomize "$ROOT_DIR/deploy/k8s/overlays/production" >/dev/null
echo 'Production ingress values rendered from reviewed Terraform outputs.'
echo 'Review and commit deploy/k8s/overlays/production/ingress.yaml before promotion.'
