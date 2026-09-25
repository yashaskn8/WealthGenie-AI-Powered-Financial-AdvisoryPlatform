# Production overlay

The base manifests are retained for ephemeral Kind validation. This overlay is
the production topology contract: HTTPS redirect is enabled, the browser origin
is HTTPS-only, and the server is configured for TLS-protected DocumentDB.

Before applying, replace all `${WEALTHGENIE_PRODUCTION_HOST}`,
`${WEALTHGENIE_PRODUCTION_TLS_SECRET}`, and
`${WEALTHGENIE_DOCUMENTDB_CA_SECRET}` placeholders with real deployment values.
The referenced TLS and DocumentDB CA secrets must already exist. Applying this
overlay with placeholders is intentionally unsupported and must be rejected by
the deployment pipeline.

The Terraform in this repository provisions network, database, ALB, and DNS
scaffolding only. Application compute/runtime attachment remains a separate
deployment step.

The Kind CD workflow applies database prerequisites, runs and waits for the
Phase-2 index migration, then the Phase-3 shared-state migration, then the
trusted serving-bundle bootstrap, and only then applies application workloads.
The bootstrap verifies the checked-in external bundle anchors and registers the
complete bundles in shared GridFS; it never replaces an already active model.
These jobs use the base MongoDB topology and ephemeral
`wealthgenie-secrets/MONGODB_URI` used by Kind.

Production DocumentDB/runtime attachment is separate: its deployment pipeline
must provide controlled one-shot Phase-2 and Phase-3 migrations and the trusted
bundle bootstrap with the production URI and TLS/CA configuration before API/ML
rollout. Do not apply Kind-specific jobs unchanged to DocumentDB. The production
database must support the transactions required by model activation and RAG
lifecycle writes. Application startup verifies migration state read-only and
never creates indexes or guesses model state.
