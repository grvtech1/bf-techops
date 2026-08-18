# Rollout Failure

```bash
kubectl -n merchant-platform rollout status deploy/merchant-api --timeout=2m || true
kubectl -n merchant-platform get rs,pods -o wide
kubectl -n merchant-platform describe deploy merchant-api
kubectl -n merchant-platform logs deploy/merchant-api --all-containers --since=10m
```

Compare the live image digest with the GitOps revision. If the migration failed, stop: do not bypass the pre-rollout migration gate. If the application digest is faulty and the schema remains backward compatible, revert the promotion commit so Argo restores the previous digest. If schema compatibility is broken, execute the migration-specific recovery decision approved before deployment.

Verify `Synced/Healthy`, two Ready API replicas on distinct eligible nodes, business smoke success, normal errors/latency, and no outbox backlog before closing.
