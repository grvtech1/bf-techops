# Production Drills

Run drills only in the local kind namespace. Capture a baseline first and record every hypothesis before executing the next command.

## 1. Idempotency race

Submit the same `Idempotency-Key` and body from 20 concurrent clients. Expected: every successful response contains one invoice ID, MySQL contains one invoice and one `invoice.issued.v1` event, and the replay metric increases. Then reuse the key with a changed body; expected HTTP status is `409`.

```bash
REQUESTS=20 CONCURRENCY=20 npm run load
bash scripts/smoke-test.sh
```

The general load script uses unique keys; use the smoke request body/key when testing the collision itself.

## 2. Cross-tenant attack

Use the root Northstar actor token and target store `10000000-0000-4000-8000-000000000099`. Expected: `403`, no invoice, no idempotency record committed, and no outbox event. The smoke test performs this check on every run.

## 3. Notification provider outage and DLQ

Patch the local worker to use a webhook URL that returns 503, then issue one invoice. Observe bounded exponential retries, one delivery-attempt row per attempt, and a terminal dead-letter alert. Pods must remain Ready because a provider outage is not a process/dependency-readiness failure.

```bash
kubectl -n merchant-platform set env deploy/merchant-worker \
  NOTIFICATION_PROVIDER=webhook \
  NOTIFICATION_PROVIDER_URL=http://merchant-portal:3000/not-found \
  NOTIFICATION_PROVIDER_API_KEY=drill-only
kubectl -n merchant-platform logs -f deploy/merchant-worker --prefix
```

Recover by reapplying the GitOps overlay, then replay only the identified event with its original event ID after approval.

## 4. Redis destruction and outbox reconciliation

Keep the provider failing so an event has no terminal delivery, then delete Redis state. After Redis returns, the worker must re-add published events lacking `SUCCEEDED` or `DEAD_LETTERED` records. The invoice remains queryable throughout.

```bash
kubectl -n merchant-platform delete pod -l app.kubernetes.io/name=redis
kubectl -n merchant-platform rollout status deploy/redis --timeout=3m
kubectl -n merchant-platform logs deploy/merchant-worker --since=5m --prefix
```

Expected: temporary worker readiness failure, no lost invoice/outbox row, stable event ID after reconciliation, and no duplicate provider delivery after recovery.

## 5. Migration checksum drift

In a disposable branch, change a byte in `001_initial_schema.sql` after applying it. Rerun the migration Job. Expected: checksum drift stops deployment before application sync. Revert the edited migration and add a new numbered migration; never rewrite applied history.

## 6. Worker-node loss

Drain one kind worker while API, worker, and portal each have two replicas. Expected: PDBs preserve availability, API replicas remain spread when schedulable, BullMQ reclaims stalled work, and smoke succeeds.

```bash
kubectl drain merchant-platform-worker --ignore-daemonsets --delete-emptydir-data
kubectl -n merchant-platform get pods -o wide --watch
kubectl uncordon merchant-platform-worker
```

## Evidence closeout

For every drill record: Git revision, deployed digests, timeline, Prometheus query/alert, relevant structured logs, exact root cause, mitigation, recovery proof, and one preventive change. A screenshot without commands and raw evidence is not a completed drill.

