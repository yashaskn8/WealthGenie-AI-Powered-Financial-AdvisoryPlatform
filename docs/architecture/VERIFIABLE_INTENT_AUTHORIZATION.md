# Verifiable Intent Authorization

WealthGenie uses an AP2-inspired verifiable authorization architecture for a
single gated action: `APPROVE_RECOMPUTE`. This is not an AP2 payment
implementation and does not authorize trading, payments, transfers, purchases,
sales, or rebalancing.

The Plan Review Agent can propose a recompute, but it cannot execute or mutate
financial state. A server-created `UserIntentMandate` binds the action to the
authenticated user, Plan Review Agent identity, profile/recommendation
snapshot, policy version, constraints, expiry, and a single-use nonce. The
deterministic policy engine and capability grant are authoritative; an LLM
output is never authorization evidence.

In production, approval uses the existing `@simplewebauthn/server` adapter with
required user verification, expected origin/RP ID, challenge binding, and
credential ownership. Development approval is available only outside
production. Mandates are signed with Ed25519 through the authorization key
provider, execution uses an atomic `AUTHORIZED -> EXECUTING` transition, and a
signed, tamper-evident `ExecutionReceipt` is emitted after the existing
authoritative recommendation workflow commits.

Authorization and execution lifecycle events are persisted in the existing
`AgentRunEvent` stream without credentials, passkey assertions, challenges,
private keys, or raw financial data. The UI exposes a read-only Authorized
Actions surface and uses the API receipt endpoint for verification.

Feature flags are disabled by default. Production requires WebAuthn and
configured signing keys; no Docker, payment, or trading runtime is required
for local validation.
