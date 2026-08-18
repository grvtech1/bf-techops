# Ansible Boundary

Kubernetes workloads are configured through GitOps, not Ansible. This playbook exists only for an optional, tightly controlled break-glass diagnostic host used when private EKS or database endpoints must be inspected during an incident.

Run `ansible-playbook --check --diff site.yml` first. The play runs serially, preserves host-key verification, disables password/root SSH, restricts named administrators, enables auditd and security updates, validates `sshd` before reload, and asserts the effective policy afterward.

