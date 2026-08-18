# Notification Dead Letter

Identify the event by `eventId`, then inspect delivery-attempt error codes and provider status without exposing contact data. Classify permanent payload errors separately from transient provider failures.

Replay is allowed only after the underlying cause is fixed. Use the original event ID so the provider idempotency contract remains effective; never clone the payload under a new ID. Record approver, event count, query/filter, start/end time, success count, and remaining failures.

Close when no new dead letters arrive for 30 minutes, replayed events have terminal success records, and outbox/queue age returns below the SLO.

