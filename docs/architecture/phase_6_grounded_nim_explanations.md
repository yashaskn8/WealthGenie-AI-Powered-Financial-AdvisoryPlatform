# Phase 6: Grounded NVIDIA NIM explanations

## Authority boundary

Phase 6 adds a narrative layer after the existing financial authorities. The path remains:

`Financial Profile -> hard suitability -> eligible universe -> verified facts -> deterministic recommendation/market/tax/projection engines -> versioned evidence packet -> LLM -> validator -> UI narrative`

NVIDIA NIM is not a decision engine. Its output is never written into a Financial Profile, recommendation instruments or weights, product ranking, market context, HMM role, tax result, official rate, or projection assumption. Phase 3's deterministic market policy remains CHAMPION; the Phase 4 HMM remains a SHADOW diagnostic.

## Provider contract

The preferred provider is the hosted NVIDIA API at `https://integrate.api.nvidia.com/v1/chat/completions` using `nvidia/nemotron-3.5-lightning-30b-a3b`. Requests are server-only, use bearer authentication, JSON response mode, temperature 0, disabled thinking output, a 20-second timeout, and one bounded retry for HTTP 429 or 5xx responses. No self-hosted NIM or GPU is required.

Gemini and Groq are optional language fallbacks. Every provider receives the same evidence payload, the same system boundary, no tools, and the same post-generation validator. Runtime response metadata supplies the provider/model label; stale marketing labels are not used. The terminal fallback is a deterministic evidence template rather than an ungrounded model prompt.

## Evidence contract

Contract version: `grounded-financial-evidence-1.0.0`.

Each entry has a stable evidence ID, kind, data class, value, display value, backend authority, source metadata where available, observation time, and freshness. The packet hash covers the complete canonical packet and therefore changes with profile, recommendation, market, product, tax, projection, source, or version changes.

The baseline external profile allowlist is: age, monthly savings capacity, stated risk tolerance, final suitability, investment horizon, investment goals, and suitability reason codes. Monthly take-home, savings rate, liquid savings, EMI burden, dependents, emergency-fund coverage, and deployable lump sum are included only when the question requires that fact. Email, phone, password hash, JWT, address, and user Mongo ID are excluded. Recommendation Mongo IDs are not sent.

Question-specific assembly is bounded. Market evidence is fetched only for market-context questions; India Post or SBI evidence only for the named supported fixed-income topic; projection assumptions only for projection questions. The mutual-fund universe, raw Mongo documents, raw provider payloads, market histories, raw HTML, conversation memory, and secrets are never sent.

## Tool registry audit

The Phase 6 LLM tool allowlist is empty.

- `sip_projection`, `lump_sum_projection`, `reverse_sip`, `tax_calculator`, and `xirr_calculator` are category B deterministic what-if calculators. They remain available only through explicit validated backend/MCP workflows and are not NIM tools.
- `portfolio_optimizer` and `rebalance_calculator` are categories C/D because they can create authority-sensitive target weights. They are not exposed to NIM.
- Existing provider adapters and normalized evidence services are server-owned category A data sources, but the server calls them while assembling evidence; NIM cannot call them.

NIM has no URL fetch, web search, generic HTTP, Mongo query, filesystem, shell, secret, write, trade, profile, allocation, or recommendation tool.

## Output validation

The model must return one JSON object with final text, evidence IDs, claim-scoped evidence IDs, and unavailable facts. The server rejects malformed output; unknown or missing citations; undeclared evidence; fabricated unavailable facts; unsupported financial numbers, dates, or source URLs; unsupported controlled financial entities; and unsupported suitability/market/HMM labels. Every displayed URL is reconstructed from authoritative evidence metadata, not accepted from model text.

Rejected output is discarded. It is never returned or persisted. The response becomes a deterministic evidence template with `LLM_GROUNDING_VALIDATION_FAILED` or the relevant provider failure code.

## Injection and privacy controls

User text is bounded, strips external URLs, email addresses, and credential-like strings, and is labeled untrusted. Requests to override the profile/evidence, invent rates or returns, reveal credentials/prompts, call URLs, reinterpret HMM state, or create unsupported crypto/specific-stock actions are blocked before external generation. Profile changes must go through the Financial Profile flow.

Only final validated text and non-sensitive operational metadata are persisted: provider, actual model, prompt/evidence versions, evidence hash/IDs, unavailable facts, validation status/reasons, fallback flag, token count, latency, and generation time. Prompts, raw provider responses, tool traces, and chain-of-thought are not persisted.

## Cache and failure behavior

Validated explanations are cached for 15 minutes. The key contains the full evidence hash, prompt version, grounding version, provider, and configured model; it contains no secret or user identifier. Changed evidence cannot reuse the old explanation. Cache read/write failure does not break the grounded response.

Missing credentials, timeout, 401/403, 429, 5xx, circuit-open, empty completion, malformed JSON, model mismatch, schema mismatch, or grounding rejection affects only the explanation layer. Recommendation, ranking, market context, tax, and projection services continue. Providers are attempted in configured order, then the deterministic template is used.

## Frontend

The existing GenieChat UI remains presentation-only. It receives validated text plus provider/model, evidence citations, grounding version, and unavailable-fact metadata from Express. Provenance is displayed in an optional details element and source URLs originate only from backend citation metadata. React has no NVIDIA key, endpoint, provider call, or financial calculation authority. No other page, dashboard, chart, card, navigation, or visual structure is changed by Phase 6.

## Qualification

`npm run qualify:nim` uses a tiny synthetic, non-sensitive evidence packet. It checks the hosted provider/model contract, structured JSON parsing, required citation, numeric hallucination rejection, secret absence from returned output, and latency, and exits non-zero on failure. It never prints the API key or uses a real Financial Profile.

## Known limitations

- Natural-language entailment is guarded conservatively with claim-scoped facts, controlled entities/labels, and strict numeric/date/URL checks; it is not a general theorem prover.
- Specific mutual-fund chat evidence is not loaded without an explicit Where-to-Invest product selection.
- Tax chat output remains unavailable until an explicit canonical tax-engine result is supplied; profile income is never inferred as taxable income.
- HMM state is not included in general chat evidence and has no allocation authority.
