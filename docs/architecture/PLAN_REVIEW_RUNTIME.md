# Plan Review Runtime Operations

In production the API deployment uses `AGENT_WORKER_MODE=external` and
`AGENT_WORKER_ENABLED=false`. It owns authentication, HTTP, validation, run
creation, queue insertion, and status reads. A separate `node worker.js`
deployment owns queue claims, LangGraph execution, checkpointing, heartbeats,
and finalization. Local development may use the embedded worker by leaving the
mode at its development default, while Docker Compose and Kubernetes run the
separate `agent-worker` process.

Each worker has an ephemeral private identity. A claim carries a lease, a
monotonic `executionGeneration`, and a periodic heartbeat. Every operational
write checks the worker and generation fence; a stale worker cannot finalize a
run. Expired leases are reclaimed up to the bounded attempt limit, and runs at
the limit become structured dead letters. Shutdown stops new claims, drains the
current job for the configured grace period, stops heartbeats after the grace
period, and closes infrastructure connections.

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
