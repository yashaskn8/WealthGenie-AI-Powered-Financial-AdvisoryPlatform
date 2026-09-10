ARCHITECTURE_REFERENCE.md — WealthGenie Agent / Plugin Routing Guide

Repository: yashaskn8/WealthGenie-Architecture-Restoration
Purpose: Tell coding agents exactly which installed agent/team/plugin/skill to use for which WealthGenie task, in what order, and where not to use it.
Companion file: AGENTS.md remains the higher-level engineering constitution.
Rule: This file is a routing map, not a replacement for AGENTS.md.

1. HOW MODELS MUST USE THIS FILE

Before every non-trivial task:

Read AGENTS.md.

Read this ARCHITECTURE_REFERENCE.md.

Inspect the real repository files for the requested subsystem.

Select the smallest relevant plugin/skill set from this file.

Use one lead implementation owner.

Use specialist plugins for review/validation, not for competing rewrites.

Complete the task end-to-end: inspect → implement → test → validate → review → report.

Core rule

Do not load every plugin for every task.

Use this pattern:

Lead Orchestrator
→ Primary Implementation Plugin
→ 1–3 Specialist Plugins
→ Review Plugin
→ Tests / Build / Validation

Too many plugins increase contradictory instructions and context noise.

2. GLOBAL PRECEDENCE

If any plugin advice conflicts with project correctness, use this order:

1. AGENTS.md
2. Explicit user task
3. Actual repository code/tests/contracts
4. WealthGenie financial/security invariants
5. This routing guide
6. Primary plugin guidance
7. Secondary plugin guidance
8. Design taste / stylistic preference

No plugin may override:

suitability,

provider provenance,

tax semantics,

auth/ownership,

fail-closed behavior,

LLM explanation-only boundary,

historical-vs-expected-return semantics.

3. TEAM / ORCHESTRATION LAYER

A Team — use as the coordinator

Best use

Use A Team for:

breaking down multi-file/multi-layer tasks,

assigning implementation ownership,

sequencing backend → frontend → QA,

enforcing review gates,

avoiding duplicate edits,

final integration review.

Best WealthGenie tasks

feature spanning React + Express + tests,

provider integration,

recommendation-pipeline changes,

security-sensitive flow changes,

performance work touching multiple layers,

major release-hardening tasks.

Do NOT use A Team for

a one-line copy fix,

a trivial CSS correction,

one isolated test typo,

a tiny static documentation edit.

Recommended team roles

Lead Orchestrator
├── Frontend Engineer
├── Backend Engineer / Architect
├── Python / ML Reviewer
├── Database Reviewer
├── Security Reviewer
├── QA / Test Engineer
└── Performance Reviewer

Single-writer rule

One agent owns a given file/subsystem at a time.

Reviewers may propose changes; they should not independently rewrite the same file.

4. FRONTEND SKILL STACK

The frontend stack is primarily:

React 19

Vite

JavaScript/JSX

React Router

Recharts

Framer Motion

Vitest

Playwright

Use frontend skills after confirming backend contracts.

4.1 UI/UX Pro Max

Primary strength

Information architecture, product UX, financial-dashboard structure, beginner comprehension, visual system decisions.

Best WealthGenie tasks

Use for:

reorganizing the Where-to-Invest screen,

simplifying technical financial data for beginners,

tax-flow usability,

card hierarchy,

comparison layouts,

dashboard density,

chart selection,

responsive information structure.

Best examples

“Make this market-context panel understandable to a beginner.”

“Reorganize top-5 recommendations.”

“Improve investment comparison cards.”

“Design a beginner-friendly tax input flow.”

Do NOT use it for

authoritative tax logic,

provider facts,

recommendation ranking,

backend financial decisions,

security architecture.

Pair with

Leon Taste,

Impeccable,

Vercel Web Interface Guidelines.

4.2 Leon Taste — design-taste-frontend

Primary strength

Visual composition, premium feel, layout taste, density, anti-generic-AI styling.

Best WealthGenie tasks

Use for:

preventing generic dashboard styling,

improving whitespace and rhythm,

refining dark-theme composition,

cleaning over-carded layouts,

making sections feel deliberate and premium,

improving visual hierarchy without redesigning the entire product.

Best examples

“This screen looks cluttered and generic.”

“Improve the visual balance of product cards.”

“Make this feel premium without changing functionality.”

Do NOT use it for

backend behavior,

financial semantics,

tax calculations,

provider ranking,

business rules.

Pair with

UI/UX Pro Max first,

Impeccable after.

4.3 Impeccable

Primary strength

UI critique, polish, accessibility, UX writing, spacing, hierarchy, design anti-pattern detection.

Best WealthGenie tasks

Use for:

final frontend audit,

accessibility issues,

unclear wording,

spacing inconsistencies,

responsive defects,

visual polish,

beginner-language cleanup.

Best examples

“Audit this finished WTI screen.”

“Find confusing wording.”

“Improve focus states and hierarchy.”

“Check responsive polish.”

Do NOT use it as

a financial authority,

a substitute for backend validation,

a reason to change product semantics.

Best position in workflow

After core UX structure is already correct.

4.4 Emil Kowalski — design / animation skills

Useful installed skills may include:

emil-design-eng

animate

review-animations

improve-animations

find-animation-opportunities

animation-vocabulary

pick-ui-library

prototype

Primary strength

Motion language, easing, timing, micro-interactions, interaction polish.

Best WealthGenie tasks

Use for:

technical-details accordion animation,

modal transitions,

product-card reveal,

loading-state transition,

tax drawer open/close,

subtle hover/selection behavior.

Best examples

“Make the technical-details expansion smoother.”

“Polish modal transitions.”

“Improve selection-state animation.”

Do NOT use it for

ranking,

tax math,

data fetching,

provider logic,

unnecessary decorative animation.

Always pair with

fixing-motion-performance for final review.

4.5 Vercel Web Interface Guidelines

Primary strength

Interaction correctness, accessibility, keyboard/focus behavior, forms, semantic UI.

Best WealthGenie tasks

Use for:

form controls,

modal accessibility,

keyboard navigation,

focus states,

validation messages,

responsive interaction behavior,

proper button/link semantics.

Best examples

Financial Profile form,

Tax Optimizer inputs,

deep-dive modal,

collapsible technical details,

mobile interaction review.

Do NOT use it for

visual brand direction,

financial correctness.

4.6 Vercel React Best Practices

Primary strength

React runtime performance and implementation quality.

Best WealthGenie tasks

Use for:

unnecessary rerenders,

request waterfalls,

duplicate API calls,

expensive derived state,

poor memoization boundaries,

bundle growth,

async sequencing,

client-side performance.

Best examples

dashboard latency,

WTI fetch behavior,

recommendation/advisory state handling,

large list rendering,

expensive chart re-renders.

Do NOT use it to

change backend financial behavior,

redesign screens.

Best position

Run after functional implementation, before final merge.

4.7 Vercel Composition Patterns

Primary strength

React component API design and maintainable component structure.

Best WealthGenie tasks

Use only when:

a component has become too large,

boolean prop explosion exists,

state ownership is unclear,

reusable compound components are needed.

Best examples

breaking down an oversized deep-dive component,

standardizing repeated financial cards,

refactoring a complex modal API.

Do NOT use it for

tiny bug fixes,

cosmetic edits,

broad refactors without a maintainability problem.

4.8 fixing-motion-performance

Primary strength

Animation runtime performance / jank prevention.

Best WealthGenie tasks

Use for:

Framer Motion performance,

layout-thrashing review,

paint-heavy animation,

scroll-triggered motion,

reduced-motion behavior.

Best position

Final animation-performance pass.

5. BACKEND PLUGIN STACK — 18 INSTALLED PLUGINS

The backend stack is primarily:

Node.js / Express

MongoDB / Mongoose

Redis

Joi validation

JWT

OpenTelemetry

FastAPI ML service

external financial data providers

Use these plugins selectively.

5.1 backend-development

Primary strength

General backend architecture, API/service design, server-side implementation patterns.

Best WealthGenie tasks

Use for:

new Express route/service,

recommendation pipeline changes,

backend orchestration,

service boundaries,

API contract changes,

provider-service integration.

Best examples

add a new backend endpoint,

restructure recommendation orchestration,

wire a provider into WTI.

Pair with

javascript-typescript

database-design

backend-api-security

unit-testing

Do NOT rely on it alone for

financial data semantics,

tax-law correctness,

provider schema validation.

5.2 javascript-typescript

Primary strength

Node.js / Express / JS implementation correctness.

Best WealthGenie tasks

Use for:

Express route implementation,

middleware,

async error handling,

Node service patterns,

module/API cleanup,

JS runtime bugs.

Best examples

route bug,

Promise/async issue,

middleware ordering,

Node memory/performance issue.

Pair with

backend-development

debugging-toolkit

5.3 python-development

Primary strength

FastAPI / Python service implementation, async Python, testing, code quality.

Best WealthGenie tasks

Use for:

ML service routes,

Python model wrapper,

FastAPI validation,

inference endpoint,

PyTorch/scikit pipeline code,

Python performance.

Best examples

ML service timeout,

FastAPI schema issue,

model-loading improvement,

Python-side validation.

Pair with

unit-testing

application-performance

data-validation-suite

5.4 database-design

Primary strength

Schema modeling, indexes, persistence structure, transactional data design.

Best WealthGenie tasks

Use for:

MongoDB schema changes,

Mongoose model review,

recommendation persistence,

audit model changes,

idempotency persistence,

index design.

Best examples

recommendation history schema,

advisory persistence,

query/index optimization,

new audit records.

Mandatory pairing for transaction-sensitive work

backend-api-security

unit-testing

distributed-debugging if production-like failure is involved.

Do NOT use it to

bypass Mongo transaction requirements.

5.5 backend-api-security

Primary strength

Backend trust boundaries, auth, authorization, validation, API attack prevention.

Best WealthGenie tasks

Use for:

JWT flows,

ownership checks,

role checks,

financial-profile APIs,

input validation,

rate limiting,

NoSQL injection defense,

SSRF/external provider boundary,

sensitive error handling.

Best examples

authenticated user resource access,

recommendation ownership,

provider URL handling,

financial input validation.

Always use when

task touches:

auth,

identity,

permissions,

financial PII,

external URLs,

admin/operator behavior.

5.6 security-scanning

Primary strength

Independent vulnerability scanning / secure-code review.

Best WealthGenie tasks

Use after implementation for:

security audit,

dependency-risk scan,

SAST-style review,

unsafe secrets,

injection patterns,

auth bypass checks.

Best position

Review stage, not primary implementation.

Pair with

backend-api-security

Trail of Bits security skills when available.

5.7 unit-testing

Primary strength

Unit and regression test design.

Best WealthGenie tasks

Use for:

regression tests,

edge cases,

provider parser tests,

tax engine tests,

recommendation logic tests,

frontend API-contract-adjacent backend tests.

Mandatory when

fixing bugs,

changing financial logic,

changing auth,

changing provider parsing,

changing tax behavior.

Do NOT stop at one happy-path test.

5.8 debugging-toolkit

Primary strength

Root-cause debugging and evidence-first diagnosis.

Best WealthGenie tasks

Use for:

failing tests,

intermittent errors,

wrong API responses,

409/500 behavior,

runtime exceptions,

regression diagnosis.

Best examples

“Why is WTI returning unavailable?”

“Why is advisory stuck generating?”

“Why does this tax test fail only on Windows?”

Use before

random code edits.

5.9 application-performance

Primary strength

Latency, memory, throughput, bottleneck analysis.

Best WealthGenie tasks

Use for:

slow recommendation path,

Node latency,

FastAPI latency,

expensive provider calls,

CPU/memory hot spots,

response-time regression.

Best examples

recommendation request took 30 seconds,

ML endpoint slow,

provider ranking slow,

excessive serialization.

Mandatory pattern

measure before
→ identify bottleneck
→ optimize
→ measure after
→ verify semantics unchanged

5.10 observability-monitoring

Primary strength

Logs, metrics, tracing, SLOs, telemetry design.

Best WealthGenie tasks

Use for:

OpenTelemetry,

Prometheus/Grafana work,

structured logging,

tracing recommendation latency,

provider failure observability,

operational dashboards.

Best examples

Server-Timing,

tracing Express → ML service,

provider health metrics,

Redis/Mongo visibility.

Do NOT log

income,

tax deductions,

JWTs,

API keys,

sensitive financial details.

5.11 distributed-debugging

Primary strength

Cross-service and infrastructure failure diagnosis.

Best WealthGenie tasks

Use for:

Express ↔ FastAPI failures,

Mongo replica-set issues,

Redis timeouts,

provider timeouts,

connection pool problems,

cross-service race conditions.

Best examples

backend works locally but fails with Redis,

Mongo transaction failures,

ML service unreachable,

intermittent cache/provider behavior.

Pair with

debugging-toolkit

observability-monitoring

5.12 data-validation-suite

Primary strength

Data contract validation, schema drift, malformed external data, fail-closed behavior.

Best WealthGenie tasks

This is one of the most important WealthGenie-specific plugins.

Use for:

AMFI parser validation,

NSE schema validation,

RBI source validation,

India Post/DEA source validation,

SBI source validation,

freshness checks,

malformed data handling,

provider normalization contracts.

Best examples

provider page changed,

field missing,

wrong date format,

stale financial fact,

unexpected provider schema.

Mandatory for

any external financial-data adapter change.

5.13 comprehensive-review

Primary strength

Final broad review across correctness, maintainability, security, tests, performance.

Best WealthGenie tasks

Use at the end of:

large backend change,

cross-layer feature,

financial pipeline change,

provider integration,

release-hardening task.

Best position

Last independent code-review pass before merge/commit.

Do NOT use it as

the main implementation plugin.

5.14 documentation-generation

Primary strength

OpenAPI, architecture docs, developer docs, endpoint docs.

Best WealthGenie tasks

Use for:

server/openapi.yaml,

architecture docs,

provider contract docs,

environment setup docs,

release notes,

migration docs.

Use when

a public/internal contract changes.

5.15 llm-application-dev

Primary strength

LLM integration, structured outputs, fallback chains, grounding, reliability.

Best WealthGenie tasks

Use only for:

NVIDIA NIM integration,

Gemini/Groq fallback,

grounded advisory prompts,

evidence packet structure,

LLM output validation,

LLM retry/timeout logic.

Critical WealthGenie boundary

LLM is explanation-only.

This plugin must never:

rank products,

choose suitability,

calculate tax,

set allocations,

override market context.

Pair with

backend-api-security

unit-testing

comprehensive-review

5.16 cicd-automation

Primary strength

GitHub Actions, build/test pipelines, release/deployment automation.

Best WealthGenie tasks

Use for:

CI matrix,

test jobs,

deployment workflow,

artifact/release automation,

security gates,

environment-specific CI logic.

Best examples

Windows/Linux CI divergence,

Mongo service matrix,

Playwright CI,

deployment gating.

Do NOT use it to

disable meaningful tests merely to make CI green.

5.17 api-testing-observability

Primary strength

API contract testing plus endpoint-level observability.

Best WealthGenie tasks

Use for:

route integration tests,

API contract validation,

endpoint health,

latency/error visibility,

auth/error-path API testing.

Best examples

/api/recommend,

/api/instruments/rank-wti,

advisory endpoint,

tax endpoint,

provider health/qualification endpoints.

Pair with

unit-testing

observability-monitoring

5.18 dependency-management

Primary strength

Dependency upgrades, compatibility, lockfiles, vulnerability/version hygiene.

Best WealthGenie tasks

Use for:

npm dependency upgrades,

Python package upgrades,

security-patch upgrades,

version conflict resolution,

lockfile analysis.

Best examples

React/Vite upgrade,

Mongoose update,

FastAPI/Pydantic conflict,

OpenTelemetry version alignment.

Mandatory rule

Do not upgrade dependencies during an unrelated bug fix.

6. OPTIONAL SPECIALIST LAYERS

6.1 Superpowers

Best strength

Structured debugging, TDD discipline, implementation planning.

Best WealthGenie use

difficult bug with uncertain root cause,

risky multi-step change,

regression-heavy feature,

test-first work.

Best pairing

debugging-toolkit

unit-testing

6.2 Trail of Bits security skills

Best strength

Independent security research / adversarial security review.

Best WealthGenie use

auth/authorization changes,

LLM security,

SSRF/external URL handling,

injection risks,

secrets,

high-risk API changes.

Best position

Independent review after implementation.

7. TASK → PLUGIN ROUTING MATRIX

Use this table as the default routing decision.

WealthGenie task

Primary plugin / skill

Secondary

Final review

New Express endpoint

backend-development

javascript-typescript, backend-api-security

unit-testing, comprehensive-review

Express bug

debugging-toolkit

javascript-typescript

unit-testing

FastAPI / Python bug

python-development

debugging-toolkit

unit-testing

Mongo schema/index

database-design

backend-development

unit-testing, comprehensive-review

Mongo transaction failure

distributed-debugging

database-design, observability-monitoring

unit-testing

Redis issue

distributed-debugging

observability-monitoring

application-performance

Auth / JWT / ownership

backend-api-security

javascript-typescript

security-scanning, unit-testing

Input validation

backend-api-security

backend-development

unit-testing

AMFI adapter

data-validation-suite

backend-development

unit-testing, comprehensive-review

NSE adapter

data-validation-suite

backend-development

unit-testing, comprehensive-review

RBI adapter

data-validation-suite

backend-development

unit-testing, comprehensive-review

SBI / India Post / DEA adapter

data-validation-suite

backend-development

unit-testing

Tax engine logic

backend-development

unit-testing

comprehensive-review + security review

Post-tax product calculation

backend-development

data-validation-suite, unit-testing

comprehensive-review

Recommendation pipeline

backend-development

javascript-typescript

unit-testing, comprehensive-review

Recommendation latency

application-performance

observability-monitoring, distributed-debugging

comprehensive-review

LLM advisory

llm-application-dev

backend-api-security

unit-testing, comprehensive-review

CI failure

cicd-automation

debugging-toolkit

comprehensive-review

API integration test

api-testing-observability

unit-testing

comprehensive-review

Dependency upgrade

dependency-management

language plugin

unit-testing/build

OpenAPI / architecture docs

documentation-generation

backend-development

comprehensive-review

Beginner UI redesign

UI/UX Pro Max

Leon Taste

Impeccable

UI visual polish

Leon Taste

Impeccable

Web Interface Guidelines

UI accessibility

Web Interface Guidelines

Impeccable

Playwright/axe

UI motion

Emil Kowalski

fixing-motion-performance

Web Interface Guidelines

React rerender / waterfall

React Best Practices

application-performance

comprehensive-review

Oversized React component

Composition Patterns

React Best Practices

Impeccable

End-to-end multi-layer feature

A Team

task-specific plugins

comprehensive-review

8. WEALTHGENIE-SPECIFIC TASK PLAYBOOKS

8.1 Add or change a financial data provider

Use:

A Team (if multi-file)
→ data-validation-suite
→ backend-development
→ javascript-typescript
→ unit-testing
→ comprehensive-review

If provider can introduce security risk:

+ backend-api-security

Required checks:

source provenance,

schema validation,

dates,

freshness,

normalization,

malformed payload,

unavailable source,

fail-closed behavior.

8.2 Change recommendation logic

Use:

A Team
→ backend-development
→ javascript-typescript
→ unit-testing
→ comprehensive-review

If performance changes:

+ application-performance
+ observability-monitoring

Must preserve:

suitability first,

market context bounded,

provider facts separate from assumptions,

LLM explanation-only.

8.3 Change tax logic

Use:

A Team
→ backend-development
→ unit-testing
→ comprehensive-review

If input/security changes:

+ backend-api-security

If product/provider tax data is involved:

+ data-validation-suite

Never use:

frontend skills,

React logic,

LLM plugin

as tax authority.

8.4 Change WTI beginner experience

Use:

A Team (only if backend contract also changes)
→ UI/UX Pro Max
→ Leon Taste
→ Impeccable
→ Vercel Web Interface Guidelines
→ Vercel React Best Practices
→ Emil only if motion is needed
→ fixing-motion-performance

Backend contract changes require:

backend-development
+ unit-testing

8.5 Fix dashboard / recommendation latency

Use:

application-performance
→ observability-monitoring
→ distributed-debugging
→ relevant language plugin
→ unit-testing
→ comprehensive-review

Measure before and after.

Do not optimize by:

lowering timeout arbitrarily,

skipping persistence,

removing validation,

bypassing suitability,

suppressing errors.

8.6 Fix auth/security issue

Use:

backend-api-security
→ debugging-toolkit
→ unit-testing
→ security-scanning
→ Trail of Bits review (if available)
→ comprehensive-review

Required tests:

unauthenticated,

wrong user,

wrong role,

malformed request,

valid authorized request.

8.7 Fix UI-only bug

Use the minimum set.

Example:

React implementation bug
→ React Best Practices
→ Web Interface Guidelines
→ relevant component tests

Do not involve:

database-design,

security-scanning,

data-validation-suite,
unless the bug actually crosses those boundaries.

8.8 Add motion / animation

Use:

Emil Kowalski
→ fixing-motion-performance
→ Web Interface Guidelines

Do not involve backend plugins.

8.9 ML-service change

Use:

python-development
→ unit-testing
→ application-performance (if inference/latency)
→ data-validation-suite (if input/dataset schema)
→ comprehensive-review

For model behavior:

preserve reproducibility,

check leakage,

keep HMM shadow-only unless explicitly changed.

8.10 CI/CD change

Use:

cicd-automation
→ debugging-toolkit
→ dependency-management (if version-related)
→ comprehensive-review

If CI failure is DB-related:

+ distributed-debugging

9. MINIMUM PLUGIN RULE

Default to:

1 primary
+ 1 or 2 specialists
+ 1 final reviewer

Examples:

Small backend bug

debugging-toolkit
+ javascript-typescript
+ unit-testing

Small frontend accessibility bug

Web Interface Guidelines
+ Impeccable

Provider schema drift

data-validation-suite
+ backend-development
+ unit-testing

Major cross-layer feature

A Team
+ backend-development
+ UI/UX Pro Max
+ unit-testing
+ comprehensive-review

Do not invoke 15 plugins for a 20-line fix.

10. PLUGINS THAT SHOULD NOT OWN FINANCIAL AUTHORITY

The following must never decide financial truth:

UI/UX Pro Max
Leon Taste
Impeccable
Emil Kowalski
Vercel Web Interface Guidelines
Vercel React Best Practices
Composition Patterns
fixing-motion-performance
LLM application plugin
A Team personas by themselves

They may help present, orchestrate, review, or implement.

Financial authority still comes from:

validated backend logic,

explicit tax engine,

qualified provider evidence,

suitability rules,

repository tests/contracts.

11. FINAL REVIEW ROUTING

Before finalizing a non-trivial change, choose at least one final reviewer.

Backend

Use:

comprehensive-review

Security-sensitive backend

Use:

security-scanning
+ comprehensive-review

Frontend

Use:

Impeccable
+ Web Interface Guidelines

Performance

Use:

application-performance
+ observability-monitoring

Motion

Use:

fixing-motion-performance

Provider/data

Use:

data-validation-suite
+ comprehensive-review

12. MODELS MUST NOT CLAIM PLUGIN OUTPUT WITHOUT USING IT

Do not write:

“Security plugin confirms this is safe.”

unless the plugin was actually invoked.

Do not write:

“Impeccable approved the UI.”

unless that skill was actually used.

If a plugin is installed but not needed:

do not invoke it,

do not mention it as evidence.

13. FINAL EXECUTION RULE

Every implementation prompt should end with this mental flow:

Read AGENTS.md
→ Read ARCHITECTURE_REFERENCE.md
→ Inspect actual files
→ Select smallest plugin set
→ Implement with one owner
→ Run tests
→ Run relevant validation
→ Run final specialist review
→ Inspect diff
→ Report exact evidence

If the selected plugin conflicts with WealthGenie architecture:

ignore the plugin recommendation and preserve WealthGenie correctness.

14. QUICK ROUTING CHEAT SHEET

FRONTEND UX          → UI/UX Pro Max
VISUAL TASTE         → Leon Taste
UI POLISH            → Impeccable
ANIMATION            → Emil Kowalski
ACCESSIBILITY        → Vercel Web Interface Guidelines
REACT PERFORMANCE    → Vercel React Best Practices
COMPONENT STRUCTURE  → Vercel Composition Patterns
MOTION PERFORMANCE   → fixing-motion-performance

BACKEND ARCHITECTURE → backend-development
NODE / EXPRESS       → javascript-typescript
FASTAPI / PYTHON     → python-development
DATABASE             → database-design
API SECURITY         → backend-api-security
SECURITY AUDIT       → security-scanning
TESTING              → unit-testing
DEBUGGING            → debugging-toolkit
PERFORMANCE          → application-performance
OBSERVABILITY        → observability-monitoring
DISTRIBUTED FAILURES → distributed-debugging
PROVIDER DATA        → data-validation-suite
FINAL CODE REVIEW    → comprehensive-review
DOCUMENTATION        → documentation-generation
LLM INTEGRATION      → llm-application-dev
CI/CD                → cicd-automation
API TESTING          → api-testing-observability
DEPENDENCIES         → dependency-management

MULTI-LAYER TASK     → A Team
SECURITY DEEP REVIEW → Trail of Bits
TDD / SYSTEMATIC FIX → Superpowers

15. WEALTHGENIE-SPECIFIC PRIORITY MAP

Most important plugin categories for this project:

1. data-validation-suite
   Because WealthGenie depends on AMFI/NSE/RBI/SBI/India Post external facts.

2. backend-api-security
   Because Financial Profile, tax inputs, auth, and recommendation data are sensitive.

3. backend-development
   Because authoritative recommendation/tax/provider orchestration lives in the backend.

4. unit-testing
   Because financial regressions must be caught.

5. application-performance
   Because recommendation/advisory latency is user-visible and has already been a major issue.

6. comprehensive-review
   Because cross-layer financial changes need an independent final pass.

7. UI/UX Pro Max
   Because the primary user is a beginner, not a finance professional.

8. Vercel React Best Practices
   Because the frontend must remain responsive without request waterfalls.

9. observability-monitoring
   Because distributed provider/ML/database failures need evidence.

10. debugging-toolkit
    Because speculative fixes are dangerous in a financial system.

16. LAST RULE

Use the plugin that is best at the task, not the plugin with the broadest description.

Examples:

Provider schema changed?
Use data-validation-suite, not generic backend-development alone.

Auth bug?
Use backend-api-security, not generic code review alone.

React waterfall?
Use React Best Practices, not UI/UX Pro Max.

Animation jank?
Use fixing-motion-performance, not Emil alone.

Tax calculation bug?
Use backend-development + unit-testing, not frontend plugins.

Cross-layer feature?
Use A Team to coordinate, then specialists by subsystem.

This is the routing contract for WealthGenie.
