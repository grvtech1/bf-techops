# Incident: Worker node kube-proxy + calico-node CrashLoopBackOff

**Date:** 2026-08-18
**Cluster:** self-managed kubeadm on EC2 (3 nodes: 1 control-plane + 2 workers)
**Severity:** Node networking degraded (1 of 2 workers)

## Symptom
After joining worker `ip-10-0-1-26` (10.0.1.26), two system pods on THAT
node only would not stabilise:
- `kube-proxy-hspzw`  → CrashLoopBackOff (8 restarts)
- `calico-node-jdb9r` → CrashLoopBackOff (5 restarts)

Other nodes (control-plane 10.0.1.57, worker 10.0.1.53) fully healthy.
Node showed `Ready` but its networking pods kept restarting.

## Investigation
1. `kubectl describe pod kube-proxy-hspzw -n kube-system`
   - Last State: Terminated, Reason: **Error, Exit Code 2**
   - Events: repeated `SandboxChanged, it will be killed and re-created`
     + `Back-off restarting failed container` + `Killing`
2. `kubectl logs kube-proxy-hspzw -n kube-system`
   - Process started fine: "Using iptables proxy", caches synced —
     **no internal error**, then killed externally.
   - => kube-proxy is collateral: the pod SANDBOX (network namespace)
     keeps being recreated → container killed. Sandbox churn points at
     the node's CNI (calico-node) failing.

## Hypothesis
Root cause is on worker `10.0.1.26` — the node where kube tooling was
initially missing ("kubeadm: command not found"). Likely the node prep
(Step A: kernel modules `br_netfilter`/`overlay` + sysctls) was not
applied, so calico-node cannot program networking → sandbox churn →
kube-proxy CrashLoop.

## Root cause (confirmed)
Prerequisites were NOT the cause — verified on the node:
- `SystemdCgroup = true` in containerd config ✅
- `br_netfilter` + `overlay` modules loaded ✅
So Step A/B were correct. Kubelet logs only showed the back-off loop
(`Back-off restarting failed container`), not an internal crash — the
containers started healthy (kube-proxy synced caches, calico felix
reported `live=true ready=true`) then were killed by repeated
`SandboxChanged` (pod network sandbox recreated).

The node (10.0.1.26) had a MESSY initial join — `kubeadm` was missing
on the first join attempt, leaving inconsistent CNI/iptables/sandbox
state that caused sandbox churn.

## Resolution
1. Cleaned the node state: `kubeadm reset -f`, removed `/etc/cni/net.d`,
   flushed iptables, restarted containerd + kubelet.
2. Re-joined the cluster fresh.
The calico-node and kube-proxy pods self-healed to Running after the
kubelet's restart back-off settled and Calico networking (BGP/dataplane)
established on the node — ~12 restarts before stable.

## Lesson
- A node-specific CrashLoop is isolated by which node the failing pods
  live on, then verifying that node's prerequisites and CNI logs.
- When pods start healthy then die via `SandboxChanged`, the individual
  pod is collateral — the root is node-level networking/CNI or a messy
  join state, not the pod itself.
- Verify prereqs first (cgroup driver, kernel modules). If they're fine
  but the node is in a bad state, a clean `kubeadm reset` + rejoin is the
  reliable fix. Controllers self-heal via restart back-off once the
  underlying state is consistent.
