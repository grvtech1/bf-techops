# variables.tf — inputs (jaise function ke arguments)
# Inhe hardcode karne ke bajaye variable banaya taaki aasani se badal sakein.

variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-south-1" # Mumbai
}

variable "instance_type" {
  description = "EC2 size — t3.small (2 vCPU, 2GB) = kubeadm minimum, sasta"
  type        = string
  default     = "t3.small" # t3.medium (4GB) zyada comfortable, par mehnga
}

variable "worker_count" {
  description = "Kitne worker nodes"
  type        = number
  default     = 2
}

variable "my_ip_cidr" {
  description = "TERA public IP /32 — SSH sirf tere IP se allow (security)"
  type        = string
  # default nahi — apply ke waqt dena padega (ya terraform.tfvars me)
}
