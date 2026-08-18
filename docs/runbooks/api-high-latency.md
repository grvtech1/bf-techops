# API High Latency

Compare p50/p95/p99 by route, request rate, pod CPU throttling, RDS Performance Insights, and slow-query logs. A low p50 with high p99 points toward contention or dependency tail latency; uniformly high latency points toward capacity or a broad dependency problem.

```bash
kubectl -n merchant-platform top pods -l app.kubernetes.io/name=merchant-api
kubectl -n merchant-platform get hpa merchant-api
kubectl -n merchant-platform describe pods -l app.kubernetes.io/name=merchant-api
```

Do not increase timeouts first. Roll back a correlated release, remove pathological queries, or add temporary replicas within tested DB connection limits. Close only after p95 is below 750 ms for 30 minutes and the error budget burn is normal.

