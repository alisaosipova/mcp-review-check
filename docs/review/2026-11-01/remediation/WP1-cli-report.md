# WP1-cli remediation report

Package: WP1-cli (`src/cli.ts`, `src/explain.ts`, `src/version.ts`, `src/catalog.ts`, `test/compat.test.ts`).
Branch: `worktree-wf_365c0c99-4d0-1`. 20 items: 17 done, 3 deferred.
Regression tests: `test/remediation-wp1-cli.test.ts`.

## Done

| ID | Commit | What changed |
|---|---|---|
| F002 | 40cceda | A `--header` name that is not an RFC 9110 token is a usage error (exit 2). Before, it reached `fetch` and the run failed as a connect failure (exit 3). The value is not echoed. |
| F015 | 40cceda | `--timeout` and `--max-duration` accept digits only. `0x10`, `1e2`, `1.5`, values with blanks and `+100` are usage errors. |
| F001 | d5cde2e | `--bearer` and `--header` with `--stdio` are usage errors. `$MCP_REVIEW_CHECK_TOKEN` is ignored for stdio, so an exported CI token no longer sets `options.authenticated` and silently turns RT-009 off. |
| F005 | d5cde2e | `--header "Authorization: …"` together with `--bearer` is a usage error. A header name repeated in any case is a usage error. An `Authorization` header wins over `$MCP_REVIEW_CHECK_TOKEN`. |
| F004 | fb315f5 | `--active-auth` with `--stdio` is a usage error, and the DCR notice is no longer printed. `--tool-args` without `--active` and `--sarif-location` without `--format sarif` print a warning on stderr. |
| F161 | fb315f5 | After `--active`, each `--tool-args` entry that no call used is named on stderr with its reason: no tool by that name, not read-only, or past the call cap. The no-`--active` part is covered by F004. |
| F008 | 5bad7d5 | A `--cwd` that is missing, is not a directory or is empty is a usage error (exit 2). Before, the run failed with "spawn node ENOENT" and exit 3. |
| F009 | 5bad7d5 | `--output ""` is a usage error. Before, the report went to stdout. |
| F010 | 5bad7d5 | `--stdio "<command>"` with `-- <command>` says "not both". A `--` without a bare `--stdio` before it says so. Neither case reports "expected a single <url>" any more. |
| F016 | 5da372e | `--target`, `--format` and `--fail-on` (also with `--list-rules`) take values in any case. |
| R018 | 5da372e | `--ignore A,B` is a comma-separated list. A bad entry is named when it looks like an ID. The `--help` line says "repeatable or comma-separated". |
| R021 | 3cbe683 | The `--output` summary line uses the singular for 1: "1 error", "1 warning". |
| R005 | e36ab26 | `node dist/cli` (no extension) runs the CLI. `isMain` also tries `argv[1] + ".js"`. Before, the CLI exited 0 without running. |
| R004 | 946a52f | `runCli` takes an `AbortSignal` that the main module aborts on SIGINT/SIGTERM/SIGHUP/SIGQUIT. If the snapshot finishes after the signal, the run writes no report to `--output` or stdout and prints "interrupted by a signal; no report written". |
| R015 | 0f10848 | `explain` prints a `Needs` line (for example `--active`, `--active-auth (<url> only)`, `tools/list works`). For a MAN item it prints `Shown when …` for `[ui]`/`[oauth]` and `To hide it: --ignore MAN-xxx`. `--list-rules --verbose` prints the needs. The text listing tags MAN items with `[ui]`/`[oauth]`. |
| R016 | 0f10848 | `--list-rules <prefix> --format markdown` omits the rule table or the checklist table when it would be empty. The full catalog (docs/RULES.md) is unchanged. |
| F165 | 7278ace | The comment in `test/compat.test.ts` now says that `BASE_RULE_IDS` is the frozen 0.1.0 baseline, checked only as a subset of the catalog, and is never updated. The finding's premise that both lists need updating for a new rule does not hold: only `test/catalog.test.ts` changes. A shared JSON would merge two lists that differ by design, so none was added and no CONTRIBUTING change is needed. |

## Deferred

| ID | Reason |
|---|---|
| F003 | needs src/connect.ts. The useful fix strips the URL userinfo before `fetch` and sends it as `Authorization: Basic` (redacted), keeping `urlAsEntered`; that is connect.ts (WP2). A CLI usage error instead would turn the deliberate user:pass@ redaction tests into vacuous or failing ones (`test/e2e-redaction.test.ts` "password in user:pass@", "a token as the URL username …", `test/sarif.test.ts` run.properties), and would make Basic-auth servers uncheckable. |
| F011 | feature: a separate exit code (4) for "stopped by --max-duration" changes the documented exit-code contract (spec §3.2, README Exit codes, `--help`). It needs a maintainer decision and docs/design/spec.md and README.md (WP10). |
| R013 | feature: a non-zero exit code for `token-rejected` (or a `--fail-on-incomplete` flag) changes the exit-code contract that spec §3.2 and §3.4 leave open. It needs a maintainer decision, docs/design/spec.md and README.md (WP10), plus src/report/github.ts for the `::warning` annotation on a partial check (WP9). |

Related note for WP9: R021's second location, the `Score` line in `src/report/text.ts:149` ("1 errors · 1 warnings"), is in WP9's file and was not changed here.

## Existing tests changed

- `test/compat.test.ts`: comment only (F165). No expectations changed.
- No other existing test was edited. Tests run: `test/cli-rules.test.ts`, `test/compat.test.ts`, `test/e2e-stdio.test.ts`, `test/e2e-http.test.ts`, `test/e2e-redaction.test.ts`, `test/output-modes.test.ts`, `test/sarif.test.ts`, `test/windows.test.ts`, `test/incomplete.test.ts`, `test/ci-output.test.ts`, `test/docs.test.ts`, `test/catalog-stale.test.ts`, `test/stderr-flush.test.ts`, `test/max-duration.test.ts`, `test/process-tree.test.ts`. All pass except one: `max-duration.test.ts` "stopped during active tool calls …" failed once when run alongside 15 other files under load. It passed on a rerun on its own (timing). The test does not use the code paths changed here.

## CHANGELOG lines

### Fixed

- `--bearer` and `--header` with `--stdio` are usage errors, and `$MCP_REVIEW_CHECK_TOKEN` is ignored for stdio targets. An exported CI token no longer marks a stdio run as authenticated and silently turns RT-009 off.
- `--header "Authorization: …"` together with `--bearer`, or a header name given twice in any case, is a usage error. Before, `fetch` sent one merged, invalid value.
- A `--header` name that is not an HTTP token, a `--cwd` that is not an existing directory and an empty `--output` are usage errors (exit 2). Before, they were connect failures (exit 3) or the report went to stdout.
- `--timeout` and `--max-duration` accept whole milliseconds only. `0x10`, `1e2` and `1.5` are usage errors.
- `--active-auth` with `--stdio` is a usage error and no longer prints a DCR notice for a probe that never runs.
- `--stdio "<command>"` with `-- <command> [args...]` says "not both" instead of "expected a single <url>".
- `node dist/cli` without the `.js` extension runs the CLI. Before, it exited 0 without checking anything.
- After SIGINT or SIGTERM, a run that still finishes during the shutdown grace period writes no report. Before, it overwrote `--output` with a report that looked complete.
- The `--output` summary line reads "1 error" and "1 warning" in the singular.
- `--list-rules <prefix> --format markdown` no longer prints an empty rule table or an empty checklist table.

### Changed

- `--target`, `--format` and `--fail-on` accept values in any case, as `--ignore` and `explain` already did.
- `--ignore` accepts a comma-separated list (`--ignore TOOL-006,TOOL-011`).
- `explain` shows what a rule needs to run (`--active`, `--active-auth`, a `<url>` target, a tools listing). For a manual item it shows the feature the item is shown for and the `--ignore` hint. `--list-rules --verbose` prints the needs, and the text listing tags manual items `[ui]` or `[oauth]`.

### Added

- Warnings on stderr when `--tool-args` is given without `--active` or `--sarif-location` without `--format sarif`, and for each `--tool-args` entry that no `--active` call used, with the reason: unknown tool, not read-only, or past the call cap.
