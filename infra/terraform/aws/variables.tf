variable "project_name" {
  type        = string
  description = "Resource name prefix."
  default     = "merchant-platform"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,24}$", var.project_name))
    error_message = "project_name must be a 3-25 character lowercase resource-name prefix."
  }
}

variable "environment" {
  type        = string
  description = "Deployment environment."
  default     = "production"
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Environment must be staging or production."
  }
}

variable "aws_region" {
  type        = string
  description = "AWS region."
  default     = "ap-south-1"
}

variable "vpc_cidr" {
  type        = string
  description = "VPC address range; keep production NetworkPolicies aligned."
  default     = "10.42.0.0/16"
  validation {
    condition     = can(cidrnetmask(var.vpc_cidr)) && endswith(var.vpc_cidr, "/16")
    error_message = "vpc_cidr must be a valid /16 CIDR so the subnet plan has adequate pod addresses."
  }
}

variable "kubernetes_version" {
  type        = string
  description = "EKS minor version under standard support."
  default     = "1.36"
}

variable "cluster_admin_principal_arn" {
  type        = string
  description = "IAM role granted EKS cluster-admin access through an access entry."
  validation {
    condition     = can(regex("^arn:[^:]+:iam::[0-9]{12}:role/.+$", var.cluster_admin_principal_arn))
    error_message = "cluster_admin_principal_arn must be an IAM role ARN, not a user ARN."
  }
}

variable "cluster_public_access_cidrs" {
  type        = list(string)
  description = "Approved office/VPN egress CIDRs for the public EKS API endpoint."
  default     = []
  validation {
    condition     = alltrue([for cidr in var.cluster_public_access_cidrs : can(cidrnetmask(cidr))])
    error_message = "Every cluster public-access entry must be a valid CIDR."
  }
}

variable "db_instance_class" {
  type        = string
  description = "RDS instance class."
  default     = "db.t4g.medium"
}

variable "rds_connection_alarm_threshold" {
  type        = number
  description = "Sustained open-connection count that pages before the selected RDS class is exhausted."
  default     = 200
  validation {
    condition     = var.rds_connection_alarm_threshold >= 10
    error_message = "rds_connection_alarm_threshold must be at least 10."
  }
}

variable "cache_node_type" {
  type        = string
  description = "ElastiCache node type."
  default     = "cache.t4g.small"
}

variable "notification_provider_url" {
  type        = string
  description = "HTTPS notification-provider endpoint stored in Secrets Manager."
  sensitive   = true
  validation {
    condition     = can(regex("^https://", var.notification_provider_url))
    error_message = "notification_provider_url must use HTTPS."
  }
}

variable "notification_provider_api_key" {
  type        = string
  description = "Notification-provider credential stored in Secrets Manager."
  sensitive   = true
}

variable "actor_jwks_url" {
  type        = string
  description = "OIDC JSON Web Key Set URL used to verify actor access tokens."
  validation {
    condition     = can(regex("^https://", var.actor_jwks_url))
    error_message = "actor_jwks_url must use HTTPS."
  }
}

variable "actor_issuer" {
  type        = string
  description = "Expected OIDC issuer."
  validation {
    condition     = can(regex("^https://", var.actor_issuer))
    error_message = "actor_issuer must use HTTPS."
  }
}

variable "actor_audience" {
  type        = string
  description = "Expected OIDC audience for Merchant Platform."
}

variable "portal_oidc_authorization_endpoint" {
  type        = string
  description = "HTTPS OIDC authorization endpoint used by the portal ALB listener."
  validation {
    condition     = can(regex("^https://", var.portal_oidc_authorization_endpoint))
    error_message = "portal_oidc_authorization_endpoint must use HTTPS."
  }
}

variable "portal_oidc_token_endpoint" {
  type        = string
  description = "HTTPS OIDC token endpoint used by the portal ALB listener."
  validation {
    condition     = can(regex("^https://", var.portal_oidc_token_endpoint))
    error_message = "portal_oidc_token_endpoint must use HTTPS."
  }
}

variable "portal_oidc_userinfo_endpoint" {
  type        = string
  description = "HTTPS OIDC user-info endpoint used by the portal ALB listener."
  validation {
    condition     = can(regex("^https://", var.portal_oidc_userinfo_endpoint))
    error_message = "portal_oidc_userinfo_endpoint must use HTTPS."
  }
}

variable "portal_oidc_client_id" {
  type        = string
  description = "OIDC client identifier for the portal ALB authentication action."
  sensitive   = true
}

variable "portal_oidc_client_secret" {
  type        = string
  description = "OIDC client secret for the portal ALB authentication action."
  sensitive   = true
}

variable "payment_provider" {
  type        = string
  description = "Lowercase identifier accepted on signed payment webhook routes."
  default     = "sandboxpay"
  validation {
    condition     = can(regex("^[a-z0-9-]{2,40}$", var.payment_provider))
    error_message = "payment_provider must contain 2-40 lowercase letters, digits, or hyphens."
  }
}

variable "oncall_email" {
  type        = string
  description = "Email endpoint for infrastructure alarms and budget notifications."
  validation {
    condition     = can(regex("^[^@]+@[^@]+\\.[^@]+$", var.oncall_email))
    error_message = "oncall_email must be a valid email address."
  }
}

variable "monthly_budget_usd" {
  type        = number
  description = "Monthly cost budget for this environment."
  default     = 750
  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "monthly_budget_usd must be positive."
  }
}

variable "github_oidc_subject" {
  type        = string
  description = "Exact GitHub Actions OIDC sub claim allowed to publish images, including repository IDs when enabled."
  validation {
    condition     = can(regex("^repo:[^:]+:ref:refs/heads/main$", var.github_oidc_subject))
    error_message = "github_oidc_subject must be an exact main-branch repository subject."
  }
}

variable "route53_zone_id" {
  type        = string
  description = "Existing public Route53 hosted zone used for TLS validation and ExternalDNS."
  validation {
    condition     = can(regex("^Z[A-Z0-9]{8,31}$", var.route53_zone_id))
    error_message = "route53_zone_id must be a Route53 hosted-zone ID."
  }
}

variable "portal_hostname" {
  type        = string
  description = "Public operations portal hostname."
  validation {
    condition     = can(regex("^[a-z0-9.-]+\\.[a-z]{2,}$", var.portal_hostname))
    error_message = "portal_hostname must be a lowercase fully-qualified DNS name."
  }
}

variable "api_hostname" {
  type        = string
  description = "Public API and payment-webhook hostname."
  validation {
    condition     = can(regex("^[a-z0-9.-]+\\.[a-z]{2,}$", var.api_hostname))
    error_message = "api_hostname must be a lowercase fully-qualified DNS name."
  }
}
