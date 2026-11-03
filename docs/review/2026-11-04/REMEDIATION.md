# Review round 3 remediation plan

Inputs: [FINDINGS.md](FINDINGS.md) (73 confirmed, 1 disputed, 0 refuted; 27 medium, 46 low, no high) and the improvement list there. Release mapping follows the README stability policy for 1.x: a **patch** never makes a passing run fail (fixes, false positives, lower severities, messages, performance, security hardening that removes unsafe behaviour); a **minor** may add findings (wider detection, raised severities, new options). Nothing here needs a major.

## 1. Release 1.0.1 — fixes (patch)

| Package | Owns | Items |
|---|---|---|
| P1 CLI and config | `src/cli.ts`, `src/config.ts`, `src/input-file.ts`, `src/baseline.ts`, `src/report/drift.ts` | **A01-01** (security) a discovered config file may not supply the server, outputs or `activeAuth`; it only sets options, and stderr names the file applied; `$MCP_REVIEW_CHECK_TOKEN` never goes to a URL from a discovered file; explicit `--config` keeps full power. **A01-02** `--save-baseline`/`--json-output` not written on exit 3. A01-04, A07-06 listing-only drift (`toolFingerprints: null`, no false "removed"). A01-05 fingerprints before run-specific redaction. A01-06 collision check incl. `--baseline` and symlinks. A01-07, A01-10 messages. A01-08 warn at save time when the baseline exceeds the read cap. A01-09 invalid-URL error does not echo the argument. **A07-04** server stderr in `--verbose` neutralised for GitHub workflow commands. **A10-01** `--fail-on-incomplete` exit 3 also reads as failed in Result, `summary.failed`, JUnit and annotations. Improvement: linear baseline/drift matching. |
| P2 Transport and proxy | `src/proxy.ts`, `src/redact.ts`, `src/diagnose.ts`, `src/connect.ts`, `src/protocol/**` | **A02-01 = A07-01** (security) `ALL_PROXY` credentials redacted; one shared proxy-variable list. A02-02 `NO_PROXY` matching identical to undici. A02-03 SSE picks the response, not a server-to-client request with the same id. A02-04, A02-05 diagnoses (gateway 502/503, TLS behind a proxy). A02-06 stdio close waits once. A04-04 notification tally on a null-prototype map. A10-02 a server that answers only `initialize` reports progress instead of minutes of silence. |
| P3 Probes | `src/probe/**` | **A03-01** (security) `--active` write-verb filter covers more mutating verbs, inflections and glued names (calls fewer tools: patch-safe). A03-02 listen/GET probes respect a lower `--timeout`. A03-03 `--active-auth` prints the registered `client_id`. |
| P4 Protocol, server and auth rules, engine | `src/rules/spec.ts`, `server.ts`, `auth.ts`, `runtime.ts`, `engine.ts` | **A04-01** SRV-013 and SPEC-022 no longer double-report the same missing serverInfo. A04-02 SPEC-024/SRV-018 skipped, not passed, after a stop. A04-03 AUTH-021 false error on a well-formed RFC 6749 error. A10-05 rules that need a connection are skipped after connect-failed (JUnit no longer shows them passed). A10-06, A10-07 stdio start failures diagnosed; SRV-003 carries its own metadata. |
| P5 Content rules: false positives and performance | `src/rules/annotations.ts`, `injection.ts` (false-positive part), `policy.ts`, `src/rules/util/**` | **A05-03**, **A05-04**, A05-09 false positives (INJ-007 "call the `x`", `$ref`-unaware type skips, biomedical Greek letters). **A09-01**, **A09-02**, **A09-03** quadratic regexes on server-controlled text, with a regex-complexity guard test. |
| P6 Listings | `src/listing/**`, `src/rules/listing.ts`, `src/rules/manual.ts` | **A06-01**, A06-02 manual items kept when the LST rule could not check. **A06-03**, **A06-04** symlinked folders and inputs. **A06-05**, A06-10 consistent severities, our own read caps are not vendor errors. **A06-06** SVG detection. **A06-07** (security) verbose listing dump redacts `privateKey`, `x-auth` and credential flags. A06-08, A06-09 messages. |
| P7 Reports and schema | `src/report/**` (except drift), `schema/report.schema.json`, `src/report/json.ts` | **A07-02 = A10-03**, **A07-03** the JSON Schema accepts listing-only and budget-exhausted reports; the schema test validates every report shape. A07-05, A07-07 (security) ESC/bidi and legacy `##[command]` neutralised in annotations and the text report. A09-05 SARIF on very large servers. A10-04 `$schema` points at the release tag. |
| P8 Pipeline | `action.yml`, `Dockerfile`, `.github/workflows/docker.yml` | **A08-01** multi-line `extra-args`. A08-02 `npx --ignore-scripts` in the action. A08-06 a bearer with a newline never reaches the log. A08-04 Docker output directory permissions. A08-05 push the image that was smoke-tested. |
| P9 Docs (facts only) | `docs/guide/privacy-and-requests.md`, `docs/guide/options-and-config.md`, Docker recipe in `docs/guide/ci.md` | A03-04 complete request list (modern-era probes, DELETE). Config discovery with `--cwd` worded as the code behaves, and the A01-01 trust model. Docker recipe for A08-04. Coordinated with the session that owns the docs. |

## 2. Release 1.1.0 — wider detection and options (minor)

| Package | Items |
|---|---|
| Q1 Content detection | **A05-01** INJ/DATA/POL corpus includes schema titles, enum/const, default and examples. **A05-02** INJ-001 invisible characters outside `\p{Cf}` (variation selectors, Hangul fillers, Braille blank, tag characters). A05-10 INJ-002 fullwidth, mathematical alphanumerics, Armenian. **A05-05** unresolvable `$ref` reported. **A05-06** APPS-006 wildcard with an explicit port. A05-07 APPS-007 sees XHR, sendBeacon, Worker, poster, embed. A05-08 TOOL-034 advice consistent with TOOL-024. |
| Q2 Protocol and listings | A04-05 SRV-015 reads the 2026-07-28 tasks extension. **C-01**, C-02 LST-008/009 launcher forms (`npm exec`, `bunx`, `uv tool run`, `pnpx`, `cmd /c`, `env`) and `pyproject.toml` uv index. A06-11 font file as plugin icon. A04-06 (disputed) SPEC-013 integer `ttlMs`: decide from the spec text, then fix or drop. |
| Q3 CLI behaviour | **A09-04** `--max-duration` also bounds rule evaluation (exit 4). A01-03 a command-line option overrides the config file's opposite key; `--no-<flag>` for config booleans. Warnings for options ignored by the chosen format. Supply chain: A08-03 `npm-shrinkwrap.json` for the CLI. |
| Q4 Selected improvements (S effort) | memoized per-snapshot data shared by rules; lazy-load for `--version`/`--help`/`explain`; end Streamable HTTP sessions on a stop; `docker.yml` chained to the Release run; tag-release guard (tag commit on `main` and green); verify the provenance attestation content. |

Not planned: RFC 7592 DCR clean-up, SOCKS4, a programmatic API (unchanged decisions).

## 3. Execution

- One workflow per release, all agents on Opus (user choice). Packages in their own worktrees from `origin/main`, disjoint files as above; each package ends with a test per fixed item (fails before, passes after), typecheck, build, its own test files.
- One adversarial reviewer per package; a fixer for high/medium review findings.
- Integration by the maintainer session: rebase and fast-forward push, full suite with the CI environment, CI green on three OS, CHANGELOG, version, tag, then npm/provenance, GitHub release and ghcr checks.
- Docs package P9 only after the docs-owning session is told which lines change.

## 4. Status log

| When | Event |
|---|---|
| 2026-11-04 | Review finished: 80 agents, 74 findings, 73 confirmed, 1 disputed, 0 refuted. Plan written; waiting for approval. |
