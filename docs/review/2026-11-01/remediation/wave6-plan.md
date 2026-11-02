# Wave 6 — 0.4.0: drift detection, manifest linting, 2026-07-28 deprecations, memory budget

Written 2026-11-02 after 0.3.0 shipped through trusted publishing and a manual end-to-end check of the published package (good/bad/leaky/hang fixtures, baseline loop, JUnit, config file, exit codes 0/1/3/4). Default decisions; the maintainer can revisit in a later minor.

## Decisions

| Item | Decision |
|---|---|
| Tool-definition drift (MARKET §3.3 rest) | `--save-baseline` also stores a SHA-256 fingerprint per tool over the canonical JSON of `name, title, description, inputSchema, outputSchema, annotations, _meta` (sorted keys). `--baseline` compares and reports a **Changed tool definitions** section (added / removed / changed tools, which fields changed) in text, markdown, JSON (`baseline.toolChanges`), SARIF (one `note`-level result per changed tool under a synthetic rule id `BASE-001`, documented), JUnit (`<system-out>`). Drift is informational and does not change the exit code; `--fail-on-drift` makes any change exit 1. `--diff-only` prints only new findings and drift, nothing else. |
| Report JSON Schema (MARKET §3.4 part) | Ship `schema/report.schema.json` (draft 2020-12) in the npm package and keep it in sync with `src/report/json.ts` by a test that validates the fixture reports against it (no new runtime dependency; the test may use a small hand-written validator or `ajv` as a devDependency). The JSON report gains `$schema` pointing at the versioned URL on GitHub. Programmatic API stays out (0.3.0 decision). |
| Manifest linting (MARKET §3.10, spec Q3) | New input options `--plugin-dir <dir>` (Claude plugin: `.claude-plugin/plugin.json`, `.mcp.json`, README, LICENSE) and `--openai-manifest <file>` (ChatGPT app `mcp.json`). New rule category **LST** (listing), platforms claude / chatgpt, severities per the vendor checklists verified online at implementation time (error only for a documented MUST with deterministic detection). Each LST rule names the MAN item it automates; the manual checklist drops those MAN items from the output when the corresponding input was given. Cross-checks against the live server when a URL/stdio target is also given (test-case `tools_triggered` exist in `tools/list`; remote url matches the target). Without the new options nothing changes. |
| New SPEC rules for 2026-07-28 (MARKET §3.12) | SPEC-021 deprecated capabilities/features announced by the server (`sampling`, `roots`, `logging`, HTTP+SSE-only transport, `includeContext` in sampling examples) — spec: info with the deprecation registry link; SPEC-022 modern results without `_meta["io.modelcontextprotocol/serverInfo"]` — spec: info (SHOULD); SPEC-023 `capabilities.extensions` shape (object, `_meta`-style keys, `io.modelcontextprotocol/tasks` requires tasks/get|update|cancel) — error for the deterministic MUST parts; AUTH: `registration_endpoint` without `client_id_metadata_document_supported` — info "DCR deprecated, add CIMD" unless AUTH-012 already says it (then extend its message). All claims verified against the current spec/SEP pages before writing. |
| F036 full | Exchanges keep a snippet, size and digest; the parsed JSON of a body is returned to the caller and no longer retained on the exchange once the snapshot is built (rules that read `exchange.json` get the data through the snapshot fields they already use; the agent inventories every reader first). |
| F146 full | One byte budget per snapshot (`SNAPSHOT_BUDGET`, 64 MiB) enforced in `readBody`, `listAll` and the SDK reader; when exhausted, reading stops, `limits.truncated` records `snapshot budget`, and the run continues with what it has. |
| Coverage in CI | A `coverage` job on Linux/Node 24 runs `npm run test:coverage` with `continue-on-error: false` and uploads the report as an artifact; the two timing-sensitive tests are skipped under coverage via an env flag (`MCP_REVIEW_CHECK_COVERAGE=1`). Thresholds re-measured after waves 4–6 and set 5 points below. |
| `release.yml` | Remove the `NPM_TOKEN` first-release step: 0.3.0 published through trusted publishing. |
| Q1 | Keep: APPS-012 prefers `openai/widgetDomain`. |
| Q2 | Keep: system resolver, message says so. |
| Q3 | Yes, this release (manifest linting above). |
| Q4 | Keep provisional weights; the 7 frozen real-server snapshots show no anomaly. |

## Packages (disjoint files; worktree per package; model opus)

| Package | Owns | Items |
|---|---|---|
| W6A-cli | `src/cli.ts`, `src/baseline.ts`, `src/report/*.ts` (additive drift sections), `schema/` (new), `README.md` (baseline/drift/schema sections), `test/remediation-w6a-*.test.ts` | drift, `--fail-on-drift`, `--diff-only`, report JSON Schema |
| W6B-listing | `src/listing/**` (new), `src/rules/listing.ts` (new), rules registration, `src/manual.ts` (or wherever the manual checklist is filtered), `src/snapshot.ts` (additive `listing` field), `docs/RULES.md` regen, `test/remediation-w6b-*.test.ts`, `test/catalog.test.ts` range for LST; **not** `src/cli.ts` — the CLI wiring (`--plugin-dir`, `--openai-manifest`) is done by W6B itself in a second step after W6A is integrated (the integrator resumes the agent). |
| W6C-spec-rules | `src/rules/spec.ts`, `src/rules/auth.ts`, `test/remediation-w6c-*.test.ts`, `test/catalog.test.ts` range for SPEC (coordinate: W6B edits the LST line, W6C the SPEC line) | SPEC-021..023, AUTH DCR/CIMD message |
| W6D-core-ci | `src/protocol/**`, `src/connect.ts`, `src/limits.ts`, `src/probe/**`, `.github/**`, `vitest.config.ts`, `test/remediation-w6d-*.test.ts` | F036 full, F146 full, coverage job, release.yml cleanup |
| W6E-docs (after integration) | `CHANGELOG.md`, `docs/design/spec.md` (incl. Q1–Q4 decided), README cross-check, REMEDIATION §10 | — |

Rules for implementers: REMEDIATION §3; no CHANGELOG/spec edits (proposals go to `remediation/W6?-report.md`); no whole-suite runs; `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer; repo identity via env.

## Release

0.4.0 per CONTRIBUTING.md after a green CI run; `release.yml` publishes through trusted publishing and verifies provenance.
