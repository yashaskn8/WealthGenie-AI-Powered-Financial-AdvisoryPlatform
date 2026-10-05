# Persistence contract test fixture

This file is retained only because the repository's documentation regression
test reads the mutation-idempotency statements below. It is not a feature
inventory, current release report, or independent verification record. The
project overview is maintained in README.md.

## Redis degradation semantics

API request limiting may be DEGRADED / BOUNDED while Redis is unavailable;
that behavior is process-local and does not provide cluster-wide enforcement.
Durable financial mutations continue to require their Mongo-backed safety
coordination.

| Operation | Contract |
| --- | --- |
| `idempotency` (idempotency.js) | FAIL CLOSED — durable mutation claims, request binding, lease fencing, and transaction-coupled completion are required; unavailable coordination returns `IDEMPOTENCY_UNAVAILABLE` before mutation. |
