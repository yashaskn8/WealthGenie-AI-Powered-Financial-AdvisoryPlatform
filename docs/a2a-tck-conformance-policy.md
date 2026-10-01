# KNOWN UPSTREAM APPLICABILITY EXCEPTION

The repository runs the official A2A TCK from `a2aproject/a2a-tck` at pinned
commit `263b9cfaf16a554bdfb166a7ba5b67716e946349`, without modifying its tests,
validators, requirements, markers, or assertions.

At this pin, five HTTP+JSON MUST fixtures send the same generic prompt,
`TCK artifact test`, while expecting mutually different canned artifact or
direct-Message outcomes. The domain-bounded WealthGenie ResearchAgent requires a
valid structured research brief and must not fabricate those unrelated outputs.
The applicability request is tracked upstream at
[a2aproject/a2a-tck#229](https://github.com/a2aproject/a2a-tck/issues/229).

The machine-readable allowlist is
[`../.github/a2a-tck-known-blockers.json`](../.github/a2a-tck-known-blockers.json).
Only the exact five pinned testcase identities, their specified requirement
IDs, and their reviewed failure fragments may be accepted. Each must execute;
skips, changed reasons, report incompleteness, checkout changes, errors, and
every other failure fail CI. If one of the five starts passing, that is
accepted; the exception is not tied to an exact failure count. The step summary
continues to report the raw TCK result and explicitly forbids a claim of full
100% A2A conformance.

No product code is changed to satisfy the fixtures. Authentication remains
enabled, and the deterministic backend remains the sole financial authority.
This exception must be removed when upstream provides a corrected official TCK
pin with scenario applicability semantics.
