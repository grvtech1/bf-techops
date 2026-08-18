output "cluster_name" {
  value = module.eks.cluster_name
}

output "aws_region" {
  value = var.aws_region
}

output "kubernetes_version" {
  value = var.kubernetes_version
}

output "cluster_endpoint" {
  value     = module.eks.cluster_endpoint
  sensitive = true
}

output "vpc_id" {
  value = module.vpc.vpc_id
}

output "vpc_cidr" {
  value = var.vpc_cidr
}

output "rds_endpoint" {
  value = module.rds.db_instance_address
}

output "cache_primary_endpoint" {
  value = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "ecr_repository_urls" {
  value = { for name, repository in aws_ecr_repository.services : name => repository.repository_url }
}

output "github_ecr_publish_role_arn" {
  value = aws_iam_role.github_ecr_publish.arn
}

output "external_secrets_role_arn" {
  value = aws_iam_role.external_secrets.arn
}

output "load_balancer_controller_role_arn" {
  value = module.load_balancer_controller_irsa.arn
}

output "external_dns_role_arn" {
  value = aws_iam_role.external_dns.arn
}

output "cloudwatch_observability_role_arn" {
  value = aws_iam_role.cloudwatch_observability.arn
}

output "cloudwatch_observability_addon_version" {
  value = aws_eks_addon.cloudwatch_observability.addon_version
}

output "ebs_csi_role_arn" {
  value = aws_iam_role.ebs_csi.arn
}

output "ebs_csi_addon_version" {
  value = aws_eks_addon.ebs_csi.addon_version
}

output "metrics_server_addon_version" {
  value = aws_eks_addon.metrics_server.addon_version
}

output "cluster_autoscaler_role_arn" {
  value = aws_iam_role.cluster_autoscaler.arn
}

output "route53_zone_name" {
  value = trimsuffix(data.aws_route53_zone.public.name, ".")
}

output "portal_hostname" {
  value = var.portal_hostname
}

output "api_hostname" {
  value = var.api_hostname
}

output "acm_certificate_arn" {
  value = aws_acm_certificate_validation.edge.certificate_arn
}

output "portal_oidc_issuer" {
  value = var.actor_issuer
}

output "portal_oidc_authorization_endpoint" {
  value = var.portal_oidc_authorization_endpoint
}

output "portal_oidc_token_endpoint" {
  value = var.portal_oidc_token_endpoint
}

output "portal_oidc_userinfo_endpoint" {
  value = var.portal_oidc_userinfo_endpoint
}

output "service_secret_arns" {
  value = { for name, secret in aws_secretsmanager_secret.service : name => secret.arn }
}

output "waf_web_acl_arn" {
  value = aws_wafv2_web_acl.edge.arn
}

output "alb_access_log_bucket" {
  value = aws_s3_bucket.alb_access_logs.id
}

output "waf_log_group_name" {
  value = aws_cloudwatch_log_group.waf.name
}

output "platform_alert_topic_arn" {
  value = aws_sns_topic.platform_alerts.arn
}
