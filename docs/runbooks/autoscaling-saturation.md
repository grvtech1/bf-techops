# Autoscaling Saturation

## Trigger

`MerchantPlatformAutoscalerAtMaximum` has remained active for 15 minutes.

## Triage

1. Identify the saturated HPA and its source metric:

   ```bash
   kubectl -n merchant-platform get hpa,scaledobject
   kubectl -n merchant-platform describe hpa <name>
   kubectl -n merchant-platform top pods
   kubectl get nodes
   kubectl top nodes
   kubectl -n kube-system logs deployment/cluster-autoscaler --since=20m | tail -200
   ```

2. For API saturation, compare request rate, p95 latency, errors, CPU throttling, RDS connections, and downstream latency. For workers, compare queue depth, oldest outbox age, provider latency, retries, and DLQ creation.
3. Distinguish pod maximum from cluster capacity. Pending pods or autoscaler scale-up failures require node-group/IAM/quota investigation; fully scheduled replicas with poor throughput require application or dependency investigation.

## Recovery

- Do not increase `maxReplicas` until database, cache, provider, IP, and node capacity can support the new concurrency.
- Rate-limit or shed nonessential traffic when a dependency is the bottleneck.
- Reduce worker concurrency if provider throttling is amplifying retries.
- Record the limiting resource, approved temporary change, rollback point, and a follow-up capacity test. Close only after the HPA leaves maximum and SLOs remain healthy for 15 minutes.
