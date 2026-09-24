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

The Kind CD workflow applies database prerequisites, runs the one-shot Job at
`k8s/phase2-index-migration/job.yaml`, waits for `Complete`, and only then
applies application workloads. That Job uses the base MongoDB topology and the
ephemeral `wealthgenie-secrets/MONGODB_URI` used by Kind. Production DocumentDB
runtime attachment is separate: its deployment pipeline must provide a
controlled one-shot index migration with the production URI and TLS/CA
configuration before API rollout; do not apply the Kind-specific Job unchanged
to DocumentDB. API startup verification remains read-only and never creates
indexes.
