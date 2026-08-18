# providers.tf — AWS provider config (kaunsa cloud, kaunsa region)
provider "aws" {
  region = var.region # variables.tf se aayega (ap-south-1 = Mumbai)

  default_tags {
    tags = {
      Project = "kubeadm-ec2-lab" # har resource pe ye tag lagega
      Owner   = "gaurav"          # (billing/cleanup me pehchaan ke liye)
    }
  }
}
