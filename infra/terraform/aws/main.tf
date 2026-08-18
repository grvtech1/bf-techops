data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_route53_zone" "public" {
  zone_id      = var.route53_zone_id
  private_zone = false
}

locals {
  name = "${var.project_name}-${var.environment}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 3)
  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
    Repository  = "merchant-platform"
  }
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "6.6.1"

  name = local.name
  cidr = var.vpc_cidr
  azs  = local.azs

  public_subnets   = [for index, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, index)]
  private_subnets  = [for index, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, index + 10)]
  database_subnets = [for index, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, index + 20)]
  elasticache_subnets = [for index, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, index + 30)]

  enable_nat_gateway     = true
  single_nat_gateway     = false
  one_nat_gateway_per_az = true
  enable_dns_hostnames   = true
  enable_dns_support     = true

  create_database_subnet_group       = true
  create_elasticache_subnet_group    = true
  create_database_subnet_route_table = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = 1
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = 1
  }
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "21.24.0"

  name               = local.name
  kubernetes_version = var.kubernetes_version

  endpoint_private_access      = true
  endpoint_public_access       = length(var.cluster_public_access_cidrs) > 0
  endpoint_public_access_cidrs = var.cluster_public_access_cidrs
  enable_irsa                  = true

  vpc_id                   = module.vpc.vpc_id
  subnet_ids               = module.vpc.private_subnets
  control_plane_subnet_ids = module.vpc.private_subnets

  addons = {
    coredns = { most_recent = true }
    kube-proxy = { most_recent = true }
    vpc-cni = {
      most_recent    = true
      before_compute = true
    }
  }

  access_entries = {
    platform_admin = {
      principal_arn = var.cluster_admin_principal_arn
      policy_associations = {
        cluster_admin = {
          policy_arn = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
          access_scope = { type = "cluster" }
        }
      }
    }
  }

  eks_managed_node_groups = {
    application = {
      ami_type       = "BOTTLEROCKET_ARM_64"
      instance_types = ["t4g.large"]
      capacity_type  = "ON_DEMAND"
      min_size       = 3
      desired_size   = 3
      max_size       = 8
      labels = {
        workload = "application"
        arch     = "arm64"
      }
      tags = {
        "k8s.io/cluster-autoscaler/enabled"       = "true"
        "k8s.io/cluster-autoscaler/${local.name}" = "owned"
      }
      update_config = { max_unavailable_percentage = 33 }
    }
  }

  enabled_log_types              = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
  cloudwatch_log_group_retention_in_days = 30
  encryption_config = {
    resources = ["secrets"]
  }
}

resource "aws_security_group" "rds" {
  name_prefix = "${local.name}-rds-"
  description = "MySQL from EKS application nodes"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "MySQL from EKS nodes"
    protocol        = "tcp"
    from_port       = 3306
    to_port         = 3306
    security_groups = [module.eks.node_security_group_id]
  }
  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
  lifecycle { create_before_destroy = true }
}

resource "random_password" "db_admin" {
  length           = 40
  special          = true
  override_special = "!#$%^&*()-_=+[]{}:,.?"
}

resource "random_password" "db_application" {
  length  = 40
  special = false
}

module "rds" {
  source  = "terraform-aws-modules/rds/aws"
  version = "7.2.0"

  identifier = local.name
  engine               = "mysql"
  engine_version       = "8.4"
  major_engine_version = "8.4"
  family               = "mysql8.4"
  instance_class       = var.db_instance_class

  db_name  = "merchant_platform"
  username = "merchant_admin"
  password = random_password.db_admin.result
  manage_master_user_password = false
  port     = 3306

  allocated_storage     = 30
  max_allocated_storage = 200
  storage_type          = "gp3"
  storage_encrypted     = true
  multi_az              = true

  db_subnet_group_name   = module.vpc.database_subnet_group_name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  backup_retention_period = 14
  backup_window           = "18:00-19:00"
  maintenance_window      = "Sun:19:30-Sun:20:30"
  auto_minor_version_upgrade = true
  deletion_protection         = true
  skip_final_snapshot         = false
  final_snapshot_identifier_prefix = "${local.name}-final"

  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  monitoring_interval                   = 60
  enabled_cloudwatch_logs_exports       = ["error", "slowquery"]

  parameters = [
    { name = "require_secure_transport", value = "ON" },
    { name = "slow_query_log", value = "1" },
    { name = "long_query_time", value = "1" }
  ]
}

resource "aws_security_group" "cache" {
  name_prefix = "${local.name}-cache-"
  description = "Valkey from EKS application nodes"
  vpc_id      = module.vpc.vpc_id
  ingress {
    description     = "TLS cache traffic from EKS nodes"
    protocol        = "tcp"
    from_port       = 6379
    to_port         = 6379
    security_groups = [module.eks.node_security_group_id]
  }
  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
  lifecycle { create_before_destroy = true }
}

resource "random_password" "cache_auth" {
  length  = 40
  special = false
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = local.name
  description          = "Merchant Platform BullMQ transport"
  engine               = "valkey"
  engine_version       = "8.0"
  node_type            = var.cache_node_type
  port                 = 6379

  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  auto_minor_version_upgrade = true

  subnet_group_name  = module.vpc.elasticache_subnet_group_name
  security_group_ids = [aws_security_group.cache.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.cache_auth.result

  snapshot_retention_limit = 7
  snapshot_window          = "17:00-18:00"
  maintenance_window       = "sun:20:30-sun:21:30"
  apply_immediately        = false
}

resource "random_password" "platform_api_key" {
  length  = 48
  special = false
}

resource "random_password" "payment_webhook_secret" {
  length  = 48
  special = false
}

resource "random_password" "alert_webhook_token" {
  length  = 48
  special = false
}

resource "aws_ecr_repository" "services" {
  for_each = toset(["api", "worker", "portal", "migration"])
  name                 = "${var.project_name}-${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
}

resource "aws_ecr_lifecycle_policy" "services" {
  for_each   = aws_ecr_repository.services
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Retain the most recent 50 release images"
      selection = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 50 }
      action = { type = "expire" }
    }]
  })
}

data "tls_certificate" "github_actions" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github_actions.certificates[0].sha1_fingerprint]
}

data "aws_iam_policy_document" "github_publish_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [var.github_oidc_subject]
    }
  }
}

resource "aws_iam_role" "github_ecr_publish" {
  name               = "${local.name}-github-ecr-publish"
  assume_role_policy = data.aws_iam_policy_document.github_publish_assume.json
}

data "aws_iam_policy_document" "github_ecr_publish" {
  statement {
    sid       = "Authorization"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "PublishReleaseImages"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:ListImages",
      "ecr:PutImage",
      "ecr:UploadLayerPart"
    ]
    resources = [for repository in aws_ecr_repository.services : repository.arn]
  }
}

resource "aws_iam_role_policy" "github_ecr_publish" {
  name   = "publish-immutable-release-images"
  role   = aws_iam_role.github_ecr_publish.id
  policy = data.aws_iam_policy_document.github_ecr_publish.json
}

locals {
  service_secrets = {
    api = {
      MYSQL_HOST        = module.rds.db_instance_address
      MYSQL_PORT        = "3306"
      MYSQL_DATABASE    = "merchant_platform"
      MYSQL_USER        = "merchant_app"
      MYSQL_PASSWORD    = random_password.db_application.result
      MYSQL_SSL         = "true"
      PLATFORM_API_KEY  = random_password.platform_api_key.result
      ACTOR_JWKS_URL     = var.actor_jwks_url
      ACTOR_ISSUER       = var.actor_issuer
      ACTOR_AUDIENCE     = var.actor_audience
      PAYMENT_PROVIDER   = var.payment_provider
      PAYMENT_WEBHOOK_SECRET = random_password.payment_webhook_secret.result
      PAYMENT_WEBHOOK_TOLERANCE_SECONDS = "300"
    }
    worker = {
      MYSQL_HOST        = module.rds.db_instance_address
      MYSQL_PORT        = "3306"
      MYSQL_DATABASE    = "merchant_platform"
      MYSQL_USER        = "merchant_app"
      MYSQL_PASSWORD    = random_password.db_application.result
      MYSQL_SSL         = "true"
      REDIS_HOST        = aws_elasticache_replication_group.this.primary_endpoint_address
      REDIS_PORT        = "6379"
      REDIS_TLS         = "true"
      REDIS_PASSWORD    = random_password.cache_auth.result
      NOTIFICATION_PROVIDER_URL     = var.notification_provider_url
      NOTIFICATION_PROVIDER_API_KEY = var.notification_provider_api_key
    }
    portal = {
      PLATFORM_API_KEY    = random_password.platform_api_key.result
      ALERT_WEBHOOK_TOKEN = random_password.alert_webhook_token.result
    }
    portal-oidc = {
      clientID     = var.portal_oidc_client_id
      clientSecret = var.portal_oidc_client_secret
    }
    migration = {
      MYSQL_HOST         = module.rds.db_instance_address
      MYSQL_PORT         = "3306"
      MYSQL_DATABASE     = "merchant_platform"
      MYSQL_USER         = "merchant_admin"
      MYSQL_PASSWORD     = random_password.db_admin.result
      MYSQL_SSL          = "true"
      MYSQL_APP_USER     = "merchant_app"
      MYSQL_APP_PASSWORD = random_password.db_application.result
    }
    alertmanager-routing = {
      token = random_password.alert_webhook_token.result
    }
  }
}

resource "aws_secretsmanager_secret" "service" {
  for_each                = local.service_secrets
  name                    = "${var.project_name}/${var.environment}/${each.key}"
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret_version" "service" {
  for_each      = local.service_secrets
  secret_id     = aws_secretsmanager_secret.service[each.key].id
  secret_string = jsonencode(each.value)
}

data "aws_iam_policy_document" "external_secrets_assume" {
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
      values   = ["system:serviceaccount:external-secrets:external-secrets"]
    }
    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "external_secrets" {
  name               = "${local.name}-external-secrets"
  assume_role_policy = data.aws_iam_policy_document.external_secrets_assume.json
}

data "aws_iam_policy_document" "external_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [for secret in aws_secretsmanager_secret.service : secret.arn]
  }
}

resource "aws_iam_role_policy" "external_secrets" {
  name   = "read-merchant-platform-secrets"
  role   = aws_iam_role.external_secrets.id
  policy = data.aws_iam_policy_document.external_secrets.json
}

module "load_balancer_controller_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts"
  version = "6.6.1"

  name                                   = "${local.name}-aws-load-balancer-controller"
  attach_load_balancer_controller_policy = true
  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:aws-load-balancer-controller"]
    }
  }
}

data "aws_iam_policy_document" "external_dns_assume" {
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
      values   = ["system:serviceaccount:external-dns:external-dns"]
    }
    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "external_dns" {
  name               = "${local.name}-external-dns"
  assume_role_policy = data.aws_iam_policy_document.external_dns_assume.json
}

data "aws_iam_policy_document" "external_dns" {
  statement {
    actions   = ["route53:ChangeResourceRecordSets"]
    resources = ["arn:aws:route53:::hostedzone/${var.route53_zone_id}"]
  }
  statement {
    actions = [
      "route53:GetChange",
      "route53:ListHostedZones",
      "route53:ListResourceRecordSets",
      "route53:ListTagsForResource"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "external_dns" {
  name   = "manage-approved-route53-zone"
  role   = aws_iam_role.external_dns.id
  policy = data.aws_iam_policy_document.external_dns.json
}
