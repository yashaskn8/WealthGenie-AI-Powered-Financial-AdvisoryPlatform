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
