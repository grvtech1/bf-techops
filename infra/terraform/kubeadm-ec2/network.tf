# network.tf — Custom VPC (4 tukde: VPC + Subnet + IGW + Route Table)
# Ye SAB FREE hai (koi NAT gateway/EIP nahi — isliye zero networking cost)

# 1️⃣ VPC — tera apna private network (ek bada IP block)
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16" # 65k IPs — bahut jagah
  enable_dns_hostnames = true          # instances ko DNS naam mile
  enable_dns_support   = true          # DNS resolution on

  tags = { Name = "kubeadm-vpc" }
}

# 2️⃣ Public Subnet — jahan EC2 instances baithenge
#    "public" isliye kyunki iska route IGW se juda hoga (neeche)
resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id # kaunsi VPC me
  cidr_block              = "10.0.1.0/24"   # 256 IPs is subnet ke
  availability_zone       = "ap-south-1a"   # ek AZ (EBS bhi isi AZ me banegi)
  map_public_ip_on_launch = true            # ← instances ko AUTO public IP
                                            #   (isse SSH kar sakte, EIP nahi chahiye)
  tags = { Name = "kubeadm-public-subnet" }
}

# 3️⃣ Internet Gateway — VPC ko internet se jodta hai
#    (iske bina VPC bilkul cut-off hai)
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "kubeadm-igw" }
}

# 4️⃣ Route Table — "internet (0.0.0.0/0) ka traffic IGW ko bhejo"
#    Yahi subnet ko "public" banata hai
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"                     # sab (internet)
    gateway_id = aws_internet_gateway.main.id    # → IGW ke through
  }

  tags = { Name = "kubeadm-public-rt" }
}

# Route table ko subnet se JODO (warna route lागू nahi hoga)
resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}
