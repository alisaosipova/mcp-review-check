# Wave 5 — 0.3.0: the remaining backlog with default decisions

Written 2026-11-02. The maintainer asked for a real feature release (not an empty one) to exercise the newly configured npm trusted publisher, and set the cadence: every feature or coherent feature set ships as its own minor release. Decisions below are defaults; no open question is left for later.

## Scope and decisions

| Item | Decision |
|---|---|
| Config file (MARKET roadmap) | `--config <path>`, and auto-discovery of `mcp-review-check.config.json` or `.mcp-review-check.json` in `--cwd`/cwd when `--config` is absent. JSON only, keys are the long option names without dashes prefix (`target`, `failOn`, `ignore`, `tolArgs`…) in camelCase, same validation as the CLI; a CLI flag always overrides the file; unknown keys are usage errors (exit 2). The target URL/stdio may come from the file too. `--no-config` disables discovery. |
| `--save-baseline <path>` | Writes the JSON report to `<path>` in addition to the primary output (the baseline consumed by `--baseline`). `--json-output <path>` is the same mechanism under a general name; both may be given, both honour redaction. |
| `--format junit` | JUnit XML reporter `src/report/junit.ts`: one `<testsuite>` per gated platform (plus `spec` when `--fail-on-spec`), one `<testcase>` per rule that ran (`classname` = platform, `name` = `RULE-ID title`), a `<failure>` per finding at or above `--fail-on` with message and evidence, `<system-out>` for lower-severity findings, `<skipped>` for skipped rules, counts in attributes. Baselined findings are not failures. |
| Action outputs | `action.yml` gains outputs `score`, `verdict`, `errors`, `warnings`, `new-findings` read from a JSON report written with `--json-output` (one CLI run). |
| F146 rest | Export `capStrings` from `src/limits.ts` and apply it to `active.calls[].jsonRpcError/transportError/args` and `observedErrors[].message`; record in `limits.truncated`. |
| R003 Origin probes on stop | `originProbes()` publishes each completed probe into the snapshot accumulator, as the wire probes do since wave 4. |
| R003 partial `clientInfoVariants` | Keep as is (RT-012 needs the full set); document in spec. |
| F151 engines | `engines.node >=22.12`, CI matrix `['22', '24']` on every OS, `@types/node` ^22, dependabot ignore for Node 20 removed. Node 20 is end-of-life since 2026-04-30; a minor release may change this while 0.x, and CHANGELOG says so under **Changed**. |
| `--listing`, `--oauth` | Stay on the roadmap (0.4.0 candidates): the listing formats and an interactive OAuth flow each need their own design note first. |
| Coverage job in CI | Still deferred (flaky under instrumentation). |
| Release cadence | CONTRIBUTING.md states it: each feature set is its own minor release; releases publish through npm trusted publishing (configured 2026-11-02); the `NPM_TOKEN` first-release step stays in `release.yml` only as documented fallback and can be removed once a trusted-publishing release has succeeded. |

## Packages (disjoint files; worktree per package; model opus)

| Package | Owns | Items |
|---|---|---|
| W5A-cli | `src/cli.ts`, `src/config.ts` (new), `src/report/junit.ts` (new), `src/baseline.ts`, `README.md`, `test/remediation-w5a-*.test.ts` | config file, `--save-baseline`, `--json-output`, `--format junit` |
| W5C-connect | `src/limits.ts`, `src/connect.ts`, `src/probe/**`, `src/snapshot.ts`, `test/remediation-w5c-*.test.ts` | F146 rest, Origin probes on stop |
| W5D-ci | `action.yml`, `.github/**`, `package.json`, `package-lock.json`, `CONTRIBUTING.md`, `.github/dependabot.yml`, `test/remediation-w5d-*.test.ts` | action outputs, engines bump, cadence text |
| W5E-docs (after integration) | `CHANGELOG.md`, `docs/design/spec.md`, README cross-check, REMEDIATION §9 | — |

Agreed interface between W5A and W5D: `--json-output <path>` writes the full JSON report (same document as `--format json`) to `<path>` regardless of `--format`; exit codes unchanged. W5D's action reads `summary.score`, `summary.verdicts` (or the verdict fields the JSON report has; W5D checks `src/report/json.ts`), `summary.errors`, `summary.warnings`, `summary.baselined`/new counts from it.

Rules for implementers: REMEDIATION §3; do not edit `CHANGELOG.md`/`docs/design/spec.md` (put proposed text in `remediation/W5?-report.md`); do not run the whole suite; commit with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer and the repo identity in env.

## Release

0.3.0 per CONTRIBUTING.md; tag `v0.3.0` after a green CI run on `main`; `release.yml` publishes through trusted publishing and verifies `dist.attestations`.
