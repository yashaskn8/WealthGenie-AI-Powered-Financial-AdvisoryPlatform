# WealthGenie MCP integration

WealthGenie exposes a small, explicit set of deterministic calculators through the Model Context Protocol. MCP output is always **NON_AUTHORITATIVE**: it is a calculation or what-if result, never a recommendation, suitability decision, portfolio instruction, or write to financial state.

## Transport and endpoint

Remote clients use the MCP SDK's Streamable HTTP transport at:

```text
POST /api/mcp
Content-Type: application/json
Accept: application/json, text/event-stream
```

The service uses stateless Streamable HTTP (`sessionIdGenerator: undefined`) and creates an isolated protocol server/transport for each request. It does not require sticky sessions. Legacy `/api/mcp/sse` and `/api/mcp/messages` routes are removed and return not found. The server is tested against the repository-pinned `@modelcontextprotocol/sdk` dependency; protocol negotiation is performed by the SDK client/server rather than a WealthGenie-specific session contract.

## Feature flags and production prerequisites

MCP feature flags default on for local development/test and off in production:

```text
MCP_ENABLED
MCP_REMOTE_ENABLED
MCP_LEGACY_SSE_ENABLED=false
```

Production remote access requires `MCP_ENABLED=true`, `MCP_REMOTE_ENABLED=true`, `MCP_JWT_AUDIENCE`, `MCP_REQUIRED_SCOPE`, `MCP_ALLOWED_HOSTS`, `REQUIRE_REDIS=true`, an explicit valid `REDIS_URL` (`redis://` or `rediss://`), and Redis health. It never relies on the Redis client's local-development URL default. Any configured MCP browser origin must also be in `CORS_ORIGINS`; production origins must use HTTPS. Legacy SSE cannot be re-enabled.

Remote calls require an `Authorization: Bearer <JWT>` token signed by the configured application JWT secret. Production tokens must carry the configured audience and scope. Cookie-only authentication is rejected. Requests are checked against the direct `Host` header and configured `Origin`; `X-Forwarded-Host` is not used as authority.

## Explicit calculator allowlist

The remote allowlist is declared in `mcp/toolPolicy.js` and must also be attached to a registry tool. A newly registered backend tool is private by default. Tool name, description, version, Joi input schema, and the structured output schema are served from runtime metadata.

| Tool | Profile context | Remote | stdio |
| --- | --- | --- | --- |
| `sip_projection` | Optional owned profile snapshot; otherwise generic what-if | Yes | Yes |
| `lump_sum_projection` | Optional owned profile snapshot; otherwise generic what-if | Yes | Yes |
| `reverse_sip` | User-supplied what-if only | Yes | Yes |
| `tax_calculator` | Explicit inputs and supported fiscal-year policy | Yes | Yes |
| `xirr_calculator` | User-supplied historical cashflows | Yes | Yes |
| `portfolio_optimizer` | Required owned canonical profile snapshot | Yes | No |
| `rebalance_calculator` | Required owned canonical profile snapshot | Yes | No |

Portfolio-sensitive calls select a profile with `X-WealthGenie-Profile-Id`. The ID is only a selector: the server queries it together with the authenticated user ID, builds the canonical recommendation-profile allowlist, and returns the profile version plus a snapshot hash. Profile IDs, user IDs, risk settings, or profile facts in tool arguments are rejected as unknown fields. The snapshot is immutable input to a non-authoritative calculation; MCP never writes it or claims it remains current after the call.

Generic projection inputs are explicitly user-supplied assumptions. Product weights and rebalancing outputs are simulations only. MCP cannot create or update recommendations, allocations, profiles, goals, mandates, authorization records, or audit state. Stdio runs with no authenticated user or personal profile database access and omits profile-required tools.

## Result and errors

Successful calls return both structured content and a JSON text compatibility block. The structured envelope includes the actual registry tool/calculation version, assumption basis, result classification, and `authority: "NON_AUTHORITATIVE"`. Outputs are bounded and reject non-finite numbers. Errors contain a stable MCP error code and safe message; internal exception text, stack traces, credentials, and profile facts are not returned.

Expected HTTP-level errors include `MCP_DISABLED` (503), `MCP_AUTH_REQUIRED`/`MCP_AUTH_SCOPE_REQUIRED` (401), `MCP_HOST_REJECTED`/`MCP_ORIGIN_REJECTED` (403), `MCP_REQUEST_TOO_LARGE` (413), `MCP_CAPACITY_EXCEEDED` (429), and `MCP_CAPACITY_UNAVAILABLE` (503). Tool validation failures are returned as MCP tool errors with safe codes.

## Budgets and resource limits

`server/.env.example` documents the supported limits, including request body bytes, per-user request window, aggregate per-user/per-cost-class call windows, concurrent per-user/global tool permits, tool timeout, drain grace, and XIRR cashflow/value bounds. Production counters/permits use Redis Lua operations and fail closed when Redis commands fail or Redis is unavailable. Redis permits are unique expiring leases, so a stale completion cannot release a newer operation's permit. Development/test can use bounded process-local limits; those are not distributed guarantees.

The MCP runtime tracks requests and underlying calculations, propagates client aborts, rejects work while draining, and applies a bounded shutdown wait. A timed-out client response does not free a capacity permit while non-cooperative work is still running.

## Local stdio

From the repository's `server` directory, a local MCP host may launch:

```text
node mcp/wealthgenieMcpServer.js
```

This mode exposes only tools whose policy explicitly permits stdio. It does not receive remote JWT identity, profile selectors, or a personalized profile context.

## Observability and deployment

MCP counters use bounded event labels only; user IDs, profile IDs, tokens, and raw arguments are never metric labels. `/health/ready` includes MCP readiness only when production remote MCP is enabled, and then requires both the MCP lifecycle and distributed capacity dependency. With MCP disabled, MCP does not make the general API unready. Multiple backend replicas can serve stateless requests without affinity.

OAuth discovery/authorization-server support is not implemented or claimed. Do not expose remote MCP publicly until production audience/scope/host/origin values, TLS edge behavior, Redis availability, and CI checks have been verified for that deployment.
