#!/usr/bin/env bash
set -Eeuo pipefail

kubectl -n monitoring port-forward svc/monitoring-kube-prometheus-alertmanager 19093:9093 >/tmp/merchant-alertmanager-pf.log 2>&1 &
PF_PID=$!
trap 'kill "$PF_PID" 2>/dev/null || true' EXIT
sleep 3

START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
END="$(date -u -d '+5 minutes' +%Y-%m-%dT%H:%M:%SZ)"
curl --fail --silent --show-error -X POST -H 'content-type: application/json' \
  --data "[{\"labels\":{\"alertname\":\"MerchantPlatformRoutingTest\",\"severity\":\"critical\",\"service\":\"routing-test\"},\"annotations\":{\"summary\":\"Synthetic routing verification\"},\"startsAt\":\"$START\",\"endsAt\":\"$END\"}]" \
  http://127.0.0.1:19093/api/v2/alerts

for _ in {1..30}; do
  if kubectl -n merchant-platform logs -l app.kubernetes.io/name=merchant-portal --since=2m 2>/dev/null | grep -q alertmanager_webhook_received; then
    echo 'Alertmanager webhook delivery verified.'
    exit 0
  fi
  sleep 2
done
echo 'Alertmanager webhook was not observed in portal logs.' >&2
exit 1

