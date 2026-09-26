# Plan Review Runtime Operations

In production the API deployment uses `AGENT_WORKER_MODE=external` and
`AGENT_WORKER_ENABLED=false`. It owns authentication, HTTP, validation, run
creation, queue insertion, and status reads. A separate `node worker.js`
deployment owns queue claims, LangGraph execution, checkpointing, heartbeats,
and finalization. Local development may use the embedded worker by leaving the
mode at its development default, while Docker Compose and Kubernetes run the
separate `agent-worker` process.

Queue admission uses a transactionally updated Mongo singleton fence and
counts capacity in the same transaction as the `AgentRun` insert. The current
AgentRun queue admits interactive PlanReview only; PlanHealth uses its own
scheduled lease and does not enqueue background AgentRuns. Queue ordering uses
an explicit numeric rank, not string enum ordering.

Each worker has an ephemeral private identity. A claim carries a lease, a
monotonic `executionGeneration`, and a periodic heartbeat. Every operational
write checks the worker and generation fence; a stale worker cannot finalize a
run. Expired leases are reclaimed up to the bounded attempt limit, and runs at
the limit become structured dead letters with bounded diagnostic identity
(failure code, attempt, generation, node, trace/correlation IDs, timestamp),
never prompts or financial payloads. Terminal AgentRun and terminal event
publication share a transaction. Recovery checkpoints receive a 30-day
post-terminal TTL; active and approval-waiting recovery state has no expiry.

Shutdown marks both subsystems draining immediately and uses one deadline. The
Kubernetes worker is configured for a 20-second application deadline inside a
30-second pod termination grace period. A drain timeout exits non-zero without
closing Mongo beneath work that may still be running; an expired lease remains
recoverable. Readiness includes required persistence and scheduler lifecycle;
three consecutive scheduler scan failures make the subsystem unready while
scheduled retry continues.

Agent execution is at-least-once. Financial side effects are prohibited and
runtime effects are designed to be replay-safe.

## Plan Health scheduler

The worker also runs a conservative daily deterministic Plan Health scheduler.
It claims one Mongo scheduler lease per UTC period, applies jitter, scans
profiles in bounded `_id` batches, and evaluates only the existing read-only
freshness checks. Profile, recommendation, and goal events trigger the same
deterministic check asynchronously. `PlanHealthEvent` has explicit lifecycle
states (`UNREAD`, `READ`, `ACKNOWLEDGED`, `SUPERSEDED`, and `RESOLVED`) and a
unique condition fingerprint; opening or acknowledging an event does not make
the underlying condition resolved.

Plan Health monitoring is read-only and does not automatically modify a user's
financial plan.

The scheduled scan cursor and execution generation are durable. Per-profile
timeouts/failures are isolated and counted, and a later scheduler recurrence
continues from the last persisted batch cursor. Scheduler/event/admission
indexes are installed only by `npm run migrate:phase5-agent-runtime`; runtime
startup verifies the required persistence state without running index DDL.

## Evaluation and operations

The deterministic evaluation suite runs in ordinary CI. Optional synthetic
live-provider evaluation is enabled only with `RUN_AGENT_LIVE_EVALS=true`, is
bounded to three cases and 2,500 reported tokens, never loads production user
data, and records provider/model/version, tool choices, final action,
grounding, latency, and tokens without chain-of-thought.

Queue depth, oldest queued age, active jobs, completed/failed jobs, lease
conflicts, stale-write rejections, recovery count, Plan Health scan counts,
deduplicated events, and live-evaluation failures are exposed as bounded
Prometheus metrics. No user or profile identifiers are metric labels.
