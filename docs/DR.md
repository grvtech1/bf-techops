# Disaster Recovery

## Recovery objectives

- RPO objective: 15 minutes for MySQL using RDS automated backups and point-in-time recovery.
- RTO objective: 60 minutes for same-region workload recovery after infrastructure approval.
- Redis RPO: zero is not required; Redis is reconstructable transport state. MySQL outbox reconciliation restores undelivered jobs.

These are objectives until a timed restore exercise proves them. Cross-region database copy, DNS failover, and a warm secondary EKS footprint are not implemented, so this repository must not claim regional disaster recovery.

## Recovery order

1. Declare the incident, freeze GitOps promotions, and record the last known healthy Git revision and image digests.
2. Restore RDS to a new same-region instance using point-in-time recovery; never overwrite the damaged source during investigation.
3. Provision/validate ElastiCache and update Secrets Manager endpoints.
4. Run migration checksum verification without introducing a new migration.
5. Sync the last healthy GitOps revision with worker replicas initially set to zero.
6. Validate invoice reads and idempotency records, then scale workers to one and observe outbox age/delivery errors.
7. Restore normal replicas, execute the business smoke test, and capture evidence.

## Mandatory exercise

Run `make restore-drill` for every release candidate, a quarterly tabletop, and a semiannual isolated RDS restore. Evidence must include backup timestamp, restored endpoint, schema checksum output, financial/audit row counts, trigger verification, replayed outbox count, smoke output, achieved RPO/RTO, and follow-up actions. A backup without a tested restore is not accepted as recovery evidence.
