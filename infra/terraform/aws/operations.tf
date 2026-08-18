resource "aws_sns_topic" "platform_alerts" {
  name              = "${local.name}-alerts"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_s3_bucket" "alb_access_logs" {
  bucket = "${local.name}-alb-logs-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "alb_access_logs" {
  bucket                  = aws_s3_bucket.alb_access_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "alb_access_logs" {
  bucket = aws_s3_bucket.alb_access_logs.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "alb_access_logs" {
  bucket = aws_s3_bucket.alb_access_logs.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_versioning" "alb_access_logs" {
  bucket = aws_s3_bucket.alb_access_logs.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "alb_access_logs" {
  bucket = aws_s3_bucket.alb_access_logs.id
  rule {
    id     = "expire-access-logs"
    status = "Enabled"
    filter {}
    expiration { days = 180 }
    noncurrent_version_expiration { noncurrent_days = 30 }
  }
}

data "aws_iam_policy_document" "alb_access_logs" {
  statement {
    sid       = "LoadBalancerLogDelivery"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.alb_access_logs.arn}/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]
    principals {
      type        = "Service"
      identifiers = ["logdelivery.elasticloadbalancing.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values = [
        "arn:${data.aws_partition.current.partition}:elasticloadbalancing:${var.aws_region}:${data.aws_caller_identity.current.account_id}:loadbalancer/*"
      ]
    }
  }
}

resource "aws_s3_bucket_policy" "alb_access_logs" {
  bucket = aws_s3_bucket.alb_access_logs.id
  policy = data.aws_iam_policy_document.alb_access_logs.json
}

data "aws_eks_addon_version" "cloudwatch_observability" {
  addon_name         = "amazon-cloudwatch-observability"
  kubernetes_version = var.kubernetes_version
  most_recent        = true
}

data "aws_eks_addon_version" "ebs_csi" {
  addon_name         = "aws-ebs-csi-driver"
  kubernetes_version = var.kubernetes_version
  most_recent        = true
}

data "aws_eks_addon_version" "metrics_server" {
  addon_name         = "metrics-server"
  kubernetes_version = var.kubernetes_version
  most_recent        = true
}

data "aws_iam_policy_document" "cloudwatch_observability_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"
    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:sub"
      values   = ["system:serviceaccount:amazon-cloudwatch:cloudwatch-agent"]
    }
    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cloudwatch_observability" {
  name               = "${local.name}-cloudwatch-observability"
  assume_role_policy = data.aws_iam_policy_document.cloudwatch_observability_assume.json
}

resource "aws_iam_role_policy_attachment" "cloudwatch_observability" {
  role       = aws_iam_role.cloudwatch_observability.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_cloudwatch_log_group" "application" {
  name              = "/aws/containerinsights/${local.name}/application"
  retention_in_days = 30
}

resource "aws_eks_addon" "cloudwatch_observability" {
  cluster_name                = module.eks.cluster_name
  addon_name                  = "amazon-cloudwatch-observability"
  addon_version               = data.aws_eks_addon_version.cloudwatch_observability.version
  service_account_role_arn    = aws_iam_role.cloudwatch_observability.arn
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  configuration_values = jsonencode({
    otelContainerInsights = { enabled = true }
  })

  depends_on = [
    aws_iam_role_policy_attachment.cloudwatch_observability,
    aws_cloudwatch_log_group.application
  ]
}

data "aws_iam_policy_document" "ebs_csi_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"
    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:sub"
      values   = ["system:serviceaccount:kube-system:ebs-csi-controller-sa"]
    }
    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ebs_csi" {
  name               = "${local.name}-ebs-csi"
  assume_role_policy = data.aws_iam_policy_document.ebs_csi_assume.json
}

resource "aws_iam_role_policy_attachment" "ebs_csi" {
  role       = aws_iam_role.ebs_csi.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}

resource "aws_eks_addon" "ebs_csi" {
  cluster_name                = module.eks.cluster_name
  addon_name                  = "aws-ebs-csi-driver"
  addon_version               = data.aws_eks_addon_version.ebs_csi.version
  service_account_role_arn    = aws_iam_role.ebs_csi.arn
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_iam_role_policy_attachment.ebs_csi]
}

resource "aws_eks_addon" "metrics_server" {
  cluster_name                = module.eks.cluster_name
  addon_name                  = "metrics-server"
  addon_version               = data.aws_eks_addon_version.metrics_server.version
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
}

data "aws_iam_policy_document" "cluster_autoscaler_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"
    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:sub"
      values   = ["system:serviceaccount:kube-system:cluster-autoscaler"]
    }
    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cluster_autoscaler" {
  name               = "${local.name}-cluster-autoscaler"
  assume_role_policy = data.aws_iam_policy_document.cluster_autoscaler_assume.json
}

data "aws_iam_policy_document" "cluster_autoscaler" {
  statement {
    sid = "DiscoverCapacity"
    actions = [
      "autoscaling:DescribeAutoScalingGroups",
      "autoscaling:DescribeAutoScalingInstances",
      "autoscaling:DescribeLaunchConfigurations",
      "autoscaling:DescribeScalingActivities",
      "ec2:DescribeImages",
      "ec2:DescribeInstanceTypes",
      "ec2:DescribeLaunchTemplateVersions",
      "ec2:GetInstanceTypesFromInstanceRequirements",
      "eks:DescribeNodegroup"
    ]
    resources = ["*"]
  }
  statement {
    sid = "ScaleTaggedNodeGroups"
    actions = [
      "autoscaling:SetDesiredCapacity",
      "autoscaling:TerminateInstanceInAutoScalingGroup"
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "autoscaling:ResourceTag/k8s.io/cluster-autoscaler/enabled"
      values   = ["true"]
    }
    condition {
      test     = "StringEquals"
      variable = "autoscaling:ResourceTag/k8s.io/cluster-autoscaler/${local.name}"
      values   = ["owned"]
    }
  }
}

resource "aws_iam_role_policy" "cluster_autoscaler" {
  name   = "scale-tagged-managed-node-groups"
  role   = aws_iam_role.cluster_autoscaler.id
  policy = data.aws_iam_policy_document.cluster_autoscaler.json
}

resource "aws_acm_certificate" "edge" {
  domain_name               = var.portal_hostname
  subject_alternative_names = [var.api_hostname]
  validation_method         = "DNS"
  lifecycle {
    create_before_destroy = true
    precondition {
      condition = (
        var.portal_hostname != var.api_hostname &&
        endswith("${var.portal_hostname}.", data.aws_route53_zone.public.name) &&
        endswith("${var.api_hostname}.", data.aws_route53_zone.public.name)
      )
      error_message = "Portal/API hostnames must be distinct names inside the selected public Route53 zone."
    }
  }
}

resource "aws_route53_record" "certificate_validation" {
  for_each = {
    for option in aws_acm_certificate.edge.domain_validation_options : option.domain_name => {
      name   = option.resource_record_name
      record = option.resource_record_value
      type   = option.resource_record_type
    }
  }
  zone_id = var.route53_zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "edge" {
  certificate_arn         = aws_acm_certificate.edge.arn
  validation_record_fqdns = [for record in aws_route53_record.certificate_validation : record.fqdn]
}

resource "aws_sns_topic_subscription" "platform_email" {
  topic_arn = aws_sns_topic.platform_alerts.arn
  protocol  = "email"
  endpoint  = var.oncall_email
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.name}-rds-high-cpu"
  alarm_description   = "RDS CPU exceeds 80 percent for 15 minutes"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  dimensions = {
    DBInstanceIdentifier = module.rds.db_instance_identifier
  }
  alarm_actions = [aws_sns_topic.platform_alerts.arn]
  ok_actions    = [aws_sns_topic.platform_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage" {
  alarm_name          = "${local.name}-rds-low-storage"
  alarm_description   = "RDS free storage is below 5 GiB"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 5368709120
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "missing"
  dimensions = {
    DBInstanceIdentifier = module.rds.db_instance_identifier
  }
  alarm_actions = [aws_sns_topic.platform_alerts.arn]
  ok_actions    = [aws_sns_topic.platform_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_free_memory" {
  alarm_name          = "${local.name}-rds-low-memory"
  alarm_description   = "RDS freeable memory is below 512 MiB"
  namespace           = "AWS/RDS"
  metric_name         = "FreeableMemory"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 536870912
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "missing"
  dimensions = {
    DBInstanceIdentifier = module.rds.db_instance_identifier
  }
  alarm_actions = [aws_sns_topic.platform_alerts.arn]
  ok_actions    = [aws_sns_topic.platform_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "${local.name}-rds-high-connections"
  alarm_description   = "RDS connections approach the reviewed capacity threshold"
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.rds_connection_alarm_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  dimensions = {
    DBInstanceIdentifier = module.rds.db_instance_identifier
  }
  alarm_actions = [aws_sns_topic.platform_alerts.arn]
  ok_actions    = [aws_sns_topic.platform_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "cache_evictions" {
  alarm_name          = "${local.name}-cache-evictions"
  alarm_description   = "Valkey evictions indicate memory pressure and threaten queue availability"
  namespace           = "AWS/ElastiCache"
  metric_name         = "Evictions"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.this.replication_group_id
  }
  alarm_actions = [aws_sns_topic.platform_alerts.arn]
  ok_actions    = [aws_sns_topic.platform_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "cache_cpu" {
  alarm_name          = "${local.name}-cache-high-engine-cpu"
  alarm_description   = "Valkey engine CPU exceeds 80 percent for 15 minutes"
  namespace           = "AWS/ElastiCache"
  metric_name         = "EngineCPUUtilization"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.this.replication_group_id
  }
  alarm_actions = [aws_sns_topic.platform_alerts.arn]
  ok_actions    = [aws_sns_topic.platform_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "cache_free_memory" {
  alarm_name          = "${local.name}-cache-low-memory"
  alarm_description   = "Valkey freeable memory is below 128 MiB"
  namespace           = "AWS/ElastiCache"
  metric_name         = "FreeableMemory"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 134217728
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "missing"
  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.this.replication_group_id
  }
  alarm_actions = [aws_sns_topic.platform_alerts.arn]
  ok_actions    = [aws_sns_topic.platform_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "certificate_expiry" {
  alarm_name          = "${local.name}-certificate-expiry"
  alarm_description   = "Public ACM certificate has fewer than 30 days remaining"
  namespace           = "AWS/CertificateManager"
  metric_name         = "DaysToExpiry"
  statistic           = "Minimum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 30
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "missing"
  dimensions = {
    CertificateArn = aws_acm_certificate_validation.edge.certificate_arn
  }
  alarm_actions = [aws_sns_topic.platform_alerts.arn]
  ok_actions    = [aws_sns_topic.platform_alerts.arn]
}

resource "aws_budgets_budget" "monthly" {
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = [format("user:Environment$%s", var.environment)]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.oncall_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.oncall_email]
  }
}

resource "aws_wafv2_web_acl" "edge" {
  name        = "${local.name}-edge"
  description = "Managed protections and per-IP request-rate control for public ALBs"
  scope       = "REGIONAL"

  default_action { allow {} }

  rule {
    name     = "AWSManagedCommonRuleSet"
    priority = 10
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedIpReputation"
    priority = 20
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "PerIpRateLimit"
    priority = 30
    action { block {} }
    statement {
      rate_based_statement {
        aggregate_key_type = "IP"
        limit              = 2000
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-edge"
    sampled_requests_enabled   = true
  }
}

resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-${local.name}"
  retention_in_days = 30
}

resource "aws_wafv2_web_acl_logging_configuration" "edge" {
  resource_arn            = aws_wafv2_web_acl.edge.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]

  redacted_fields { single_header { name = "authorization" } }
  redacted_fields { single_header { name = "x-platform-api-key" } }
  redacted_fields { single_header { name = "x-payment-signature" } }
}
