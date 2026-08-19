# iam.tf — EC2 nodes ko EBS manage karne ki IAM permission (EBS CSI ke liye)
# Chain: Role (identity) → Policy (permissions) → Instance Profile (EC2 ko attach)

# 1. IAM Role — "ye role EC2 assume kar sakta"
resource "aws_iam_role" "node" {
  name = "kubeadm-node-role"

  # Trust policy — kaun ye role le sakta? → EC2 service
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
  tags = { Name = "kubeadm-node-role" }
}

# 2. Policy attach — AWS ka ready-made EBS-CSI policy (EBS create/attach/delete)
resource "aws_iam_role_policy_attachment" "ebs" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}

# 2b. ECR read — nodes private ECR se app images PULL kar sakein
#     kubelet ka ECR credential-provider is role se auto-auth karta
#     (isliye imagePullSecrets ki zaroorat nahi — node-level identity)
resource "aws_iam_role_policy_attachment" "ecr" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# 3. Instance Profile — role ko EC2 ko attach karne ka "wrapper"
#    (EC2 seedha role nahi, instance-profile ke through leta)
resource "aws_iam_instance_profile" "node" {
  name = "kubeadm-node-profile"
  role = aws_iam_role.node.name
}
