#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT_DIR/infra/terraform/aws"
EXTERNAL_SECRETS_VERSION="${EXTERNAL_SECRETS_VERSION:-2.5.0}"
AWS_LBC_VERSION="${AWS_LBC_VERSION:-3.3.0}"
KEDA_VERSION="${KEDA_VERSION:-2.20.1}"
EXTERNAL_DNS_VERSION="${EXTERNAL_DNS_VERSION:-1.21.1}"
CLUSTER_AUTOSCALER_CHART_VERSION="${CLUSTER_AUTOSCALER_CHART_VERSION:-9.59.0}"
AWS_REGION="${AWS_REGION:-$(terraform -chdir="$TF_DIR" output -raw aws_region 2>/dev/null || true)}"
CLUSTER_NAME="${CLUSTER_NAME:-$(terraform -chdir="$TF_DIR" output -raw cluster_name)}"
KUBERNETES_VERSION="$(terraform -chdir="$TF_DIR" output -raw kubernetes_version)"
CLUSTER_AUTOSCALER_IMAGE_TAG="${CLUSTER_AUTOSCALER_IMAGE_TAG:-v${KUBERNETES_VERSION}.0}"
EXTERNAL_SECRETS_ROLE_ARN="$(terraform -chdir="$TF_DIR" output -raw external_secrets_role_arn)"
AWS_LBC_ROLE_ARN="$(terraform -chdir="$TF_DIR" output -raw load_balancer_controller_role_arn)"
EXTERNAL_DNS_ROLE_ARN="$(terraform -chdir="$TF_DIR" output -raw external_dns_role_arn)"
CLUSTER_AUTOSCALER_ROLE_ARN="$(terraform -chdir="$TF_DIR" output -raw cluster_autoscaler_role_arn)"
ROUTE53_ZONE_NAME="$(terraform -chdir="$TF_DIR" output -raw route53_zone_name)"

if [[ -z "$AWS_REGION" ]]; then
  AWS_REGION="$(aws configure get region)"
fi
: "${AWS_REGION:?Set AWS_REGION or configure an AWS CLI default region.}"

helm repo add external-secrets https://charts.external-secrets.io
helm repo add eks https://aws.github.io/eks-charts
helm repo add kedacore https://kedacore.github.io/charts
helm repo add external-dns https://kubernetes-sigs.github.io/external-dns/
helm repo add cluster-autoscaler https://kubernetes.github.io/autoscaler
helm repo update

helm upgrade --install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace \
  --version "$EXTERNAL_SECRETS_VERSION" \
  --set installCRDs=true \
  --set serviceAccount.name=external-secrets \
  --set-string serviceAccount.annotations."eks\.amazonaws\.com/role-arn"="$EXTERNAL_SECRETS_ROLE_ARN" \
  --wait --timeout 10m

helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
  --namespace kube-system \
  --version "$AWS_LBC_VERSION" \
  --set clusterName="$CLUSTER_NAME" \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set-string serviceAccount.annotations."eks\.amazonaws\.com/role-arn"="$AWS_LBC_ROLE_ARN" \
  --wait --timeout 10m

helm upgrade --install keda kedacore/keda \
  --namespace keda --create-namespace \
  --version "$KEDA_VERSION" \
  --wait --timeout 10m

helm upgrade --install external-dns external-dns/external-dns \
  --namespace external-dns --create-namespace \
  --version "$EXTERNAL_DNS_VERSION" \
  --set provider.name=aws \
  --set policy=sync \
  --set registry=txt \
  --set txtOwnerId="$CLUSTER_NAME" \
  --set domainFilters[0]="$ROUTE53_ZONE_NAME" \
  --set serviceAccount.create=true \
  --set serviceAccount.name=external-dns \
  --set-string serviceAccount.annotations."eks\.amazonaws\.com/role-arn"="$EXTERNAL_DNS_ROLE_ARN" \
  --wait --timeout 10m

helm upgrade --install cluster-autoscaler cluster-autoscaler/cluster-autoscaler \
  --namespace kube-system \
  --version "$CLUSTER_AUTOSCALER_CHART_VERSION" \
  --set cloudProvider=aws \
  --set awsRegion="$AWS_REGION" \
  --set autoDiscovery.clusterName="$CLUSTER_NAME" \
  --set image.tag="$CLUSTER_AUTOSCALER_IMAGE_TAG" \
  --set rbac.serviceAccount.create=true \
  --set rbac.serviceAccount.name=cluster-autoscaler \
  --set-string rbac.serviceAccount.annotations."eks\.amazonaws\.com/role-arn"="$CLUSTER_AUTOSCALER_ROLE_ARN" \
  --set extraArgs.balance-similar-node-groups=true \
  --set resources.requests.cpu=100m \
  --set resources.requests.memory=300Mi \
  --set resources.limits.cpu=500m \
  --set resources.limits.memory=600Mi \
  --wait --timeout 10m

sed "s|REPLACE_AWS_REGION|$AWS_REGION|g" "$ROOT_DIR/deploy/addons/aws-secrets-store.yaml" | kubectl apply -f -
kubectl wait --for=condition=Ready clustersecretstore/aws-secrets-manager --timeout=2m
kubectl apply -f "$ROOT_DIR/deploy/addons/gp3-storage-class.yaml"
kubectl -n external-secrets get pods
kubectl -n kube-system get pods -l app.kubernetes.io/name=aws-load-balancer-controller
kubectl -n keda get pods
kubectl -n external-dns get pods
kubectl -n kube-system rollout status deployment/cluster-autoscaler --timeout=5m
kubectl top nodes
kubectl get storageclass gp3-retain
echo 'AWS platform add-ons are ready for the production Argo CD application.'
