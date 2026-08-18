# outputs.tf — apply ke baad zaroori values print karta (IPs, SSH commands)

output "control_plane_ip" {
  description = "Control-plane public IP"
  value       = aws_instance.control_plane.public_ip
}

output "worker_ips" {
  description = "Worker nodes public IPs"
  value       = aws_instance.worker[*].public_ip # [*] = saare workers ki list
}

output "ssh_control_plane" {
  description = "Control-plane pe SSH karne ka command"
  value       = "ssh -i ~/.ssh/kubeadm-key ubuntu@${aws_instance.control_plane.public_ip}"
}
