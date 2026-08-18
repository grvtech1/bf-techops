# Persistent Storage Pressure

## Trigger

`MerchantPlatformMonitoringVolumeLow` reports less than 15 percent free space on a monitoring PVC.

## Triage

1. Identify the PVC, bound PV, storage class, and consumer:

   ```bash
   kubectl -n monitoring get pvc
   kubectl -n monitoring describe pvc <pvc>
   kubectl get pv <pv>
   kubectl -n monitoring get pods -o wide
   ```

2. Check Prometheus retention/size limits, recent cardinality growth, scrape additions, WAL growth, and Grafana storage. Preserve the evidence needed for the active incident.
3. Confirm the volume uses `gp3-retain`, encryption is enabled, and the EBS CSI add-on is healthy before resizing.

## Recovery

- Prefer reducing accidental cardinality or obsolete scrape load before deleting operational history.
- If approved, increase the PVC request; `gp3-retain` allows online expansion. Watch PVC conditions, filesystem size, pod health, and EBS modification status.
- Never delete the PVC as a quick cleanup. Its `Retain` policy intentionally leaves the EBS volume for explicit recovery or disposal.
- Verify the alert clears, Prometheus targets and rules are healthy, dashboards load, and the new capacity is documented with a review date.
