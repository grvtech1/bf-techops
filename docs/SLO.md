# Service Level Objectives

## Invoice API

- Availability SLO: 99.9 percent of valid invoice requests return a non-5xx response over 30 days.
- Latency SLO: 95 percent of invoice API requests complete within 750 ms over 30 days.
- Correctness invariant: an accepted invoice has exactly one committed financial record and at least one durable outbox event; retries may not create another invoice.

## Notification pipeline

- Freshness SLO: 99 percent of committed invoice events are published to the delivery queue within 120 seconds.
- Delivery SLO: 99 percent of valid notifications either succeed or reach an operator-visible terminal state within 10 minutes.
- Durability invariant: Redis loss may delay delivery but cannot delete a committed invoice event.

## Payment callbacks

- Acceptance SLO: 99.9 percent of authentic, schema-valid callbacks are durably recorded within two seconds over 30 days.
- Correctness invariant: a provider event ID maps to one payload hash; replays return the original outcome and altered replays are rejected.
- Financial invariant: captured amounts cannot exceed the invoice total, refunds cannot exceed their payment, and every accepted change commits its audit and outbox records atomically.

## Alert policy

Paging alerts map to immediate user impact or a threatened durability invariant. Warning alerts identify reduced capacity or a burn trend. Every alert includes a repository runbook; an alert without an owner and executable first checks is rejected in review.
