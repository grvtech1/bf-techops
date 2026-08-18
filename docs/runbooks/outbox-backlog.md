# Outbox or Queue Backlog

## Diagnose the stage

```bash
kubectl -n merchant-platform get deploy,pods -l app.kubernetes.io/component=worker
kubectl -n merchant-platform logs -l app.kubernetes.io/name=merchant-worker --since=15m --prefix | tail -200
kubectl -n merchant-platform port-forward svc/merchant-worker-metrics 19091:9091
curl -s http://127.0.0.1:19091/metrics | grep -E 'outbox_oldest|queue_waiting|deliveries_total'
```

- Outbox age rising, queue flat: inspect MySQL/Redis connectivity and relay errors.
- Queue rising, provider failures rising: provider degradation; preserve bounded retries and contact the provider.
- Queue rising, provider success normal: scale workers while checking provider rate limits and DB connection headroom.

Never mark outbox rows published manually. After Redis replacement, the worker reconciles published rows without terminal delivery and re-adds them with the original event ID.

