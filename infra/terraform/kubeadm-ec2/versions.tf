# versions.tf — Terraform + provider versions ko PIN karta hai
# (taaki har jagah same version chale — reproducible)
terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws" # kaunsa provider (AWS)
      version = "~> 5.0"        # 5.x koi bhi (5.0, 5.9 ... par 6.0 nahi)
    }
  }
}
