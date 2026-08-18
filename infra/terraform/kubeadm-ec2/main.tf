# main.tf — Compute: AMI + SSH key + Security Group + 3 EC2 (kubeadm nodes)

# Latest Ubuntu 22.04 AMI dhundta hai (Canonical = Ubuntu banane wale)
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical ka official account
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
}

# SSH key pair — tere LOCAL public key se AWS pe banega
resource "aws_key_pair" "main" {
  key_name   = "kubeadm-key"
  public_key = file("~/.ssh/kubeadm-key.pub") # ssh-keygen se banaya wala
}

# Security Group — kubeadm + Calico ke liye ports khol do
resource "aws_security_group" "kubeadm" {
  name        = "kubeadm-sg"
  description = "kubeadm cluster traffic"
  vpc_id      = aws_vpc.main.id

  ingress { # SSH — sirf TERE IP se (security)
    description = "SSH from my IP"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.my_ip_cidr]
  }
  ingress { # kube-apiserver — kubectl laptop se chalega
    description = "kube-apiserver from my IP"
    from_port   = 6443
    to_port     = 6443
    protocol    = "tcp"
    cidr_blocks = [var.my_ip_cidr]
  }
  ingress { # NodePort — apps ko browser se access karne ko
    description = "NodePort from my IP"
    from_port   = 30000
    to_port     = 32767
    protocol    = "tcp"
    cidr_blocks = [var.my_ip_cidr]
  }
  ingress { # Nodes ke beech SAB traffic (etcd/kubelet/Calico BGP/pod-net)
    description = "all traffic between cluster nodes"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"  # -1 = saare protocols
    self        = true  # isi SG ke members ke beech (node-to-node)
  }
  egress { # Outbound — sab allowed (package/image pull ke liye)
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "kubeadm-sg" }
}

# Control-plane node (master)
resource "aws_instance" "control_plane" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.kubeadm.id]
  key_name               = aws_key_pair.main.key_name

  root_block_device {
    volume_size = 20    # 20 GB disk
    volume_type = "gp3"
  }
  tags = { Name = "kubeadm-control-plane", Role = "control-plane" }
}

# Worker nodes — count se 2 banenge
resource "aws_instance" "worker" {
  count                  = var.worker_count # variables.tf me 2
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.kubeadm.id]
  key_name               = aws_key_pair.main.key_name

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }
  tags = { Name = "kubeadm-worker-${count.index + 1}", Role = "worker" }
}
