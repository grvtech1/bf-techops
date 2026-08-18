# ADR 0001: Modular API With an Independent Worker

## Status

Accepted.

## Decision

Use one modular NestJS API, one BullMQ worker, and one Next.js operations portal. Keep merchant, identity, and invoice boundaries as modules until a measured scaling, availability, or team-ownership need justifies another network boundary.

## Rationale

Invoice issuance requires strong consistency across financial data, idempotency, and the transactional outbox. Splitting those operations early adds distributed transactions and operational load without creating user value. Notification delivery has a genuinely different scaling and failure model, so it is a separate worker now.

## Consequences

- API modules share one MySQL schema and deployment lifecycle.
- Notification processing scales independently.
- Extraction requires an explicit data-ownership migration, not merely moving files.

