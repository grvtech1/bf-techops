# Pod Instability

## Trigger

`MerchantPlatformContainerRestarting` or `MerchantPlatformContainerOOMKilled` is firing.

## Triage

1. Record the alert start, release revision, affected pod, node, and container before changing anything.
2. Inspect current and previous state:

   ```bash
   kubectl -n merchant-platform get pods -o wide
   kubectl -n merchant-platform describe pod <pod>
   kubectl -n merchant-platform logs <pod> -c <container> --previous --tail=200
   kubectl -n merchant-platform get pod <pod> -o jsonpath='{.status.containerStatuses[0].lastState.terminated}'
   kubectl top pod -n merchant-platform --containers
   ```

3. For `OOMKilled`/exit 137, compare working-set history with the workload memory request and limit. Check for load growth, an application leak, oversized batches, and node pressure.
4. For other restarts, inspect probe failures, exit code, application logs, dependency health, node events, and the current ReplicaSet before assuming Kubernetes is the root cause.
5. Confirm at least one healthy replica and the PDB remain available. Escalate immediately if the API or portal has no ready endpoint.

## Recovery

- Roll back the image digest when the restart began with the release and no forward fix is approved.
- Change a resource limit only with observed peak data and a capacity check; raising a limit can transfer the failure to the node.
- Reduce worker concurrency or batch size before adding memory when the worker workload is the driver.
- Verify rollout completion, restart-count stability for 15 minutes, business smoke, and alert resolution. Attach before/after metrics and commands to the incident record.
