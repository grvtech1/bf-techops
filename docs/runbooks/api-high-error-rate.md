# API High Error Rate

## First five minutes

```bash
kubectl -n merchant-platform get deploy,pods,endpointslice
kubectl -n merchant-platform logs -l app.kubernetes.io/name=merchant-api --since=10m --prefix | tail -200
kubectl -n merchant-platform get events --sort-by=.lastTimestamp | tail -50
```

Split errors by route/status in Prometheus. Correlate `requestId` across API logs; do not log or paste customer contact data into the incident channel. Check RDS connectivity and saturation before restarting anything.

## Mitigation

- New release correlation: pause Argo auto-sync and roll back to the previous reviewed digest.
- Database saturation: shed nonessential reads, verify pool usage/slow queries, and scale only after query evidence.
- Single pod/node failure: remove the unhealthy endpoint through readiness and drain only the affected node.

## Exit

5xx ratio remains below 1 percent for 15 minutes, invoice create/read smoke passes, and no idempotency or outbox backlog anomaly remains.

