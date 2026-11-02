# W4A-cli — report

Package W4A-cli of wave 4 (see `wave4-plan.md`). Branch `worktree-agent-a51f643012a337d9e`, based on `14cce30`.

## Items

| Item | Status | Summary |
|---|---|---|
| F011 | done | Exit **4** when `limits.stopped` is set and `snap.fatal` is not (a `--max-duration` stop after the handshake), at any `--fail-on`. Exit 3 stays for a failed connect or handshake (also when the deadline ran out before the handshake, which sets `fatal`) and for internal errors. `--help`, README "Options", "Exit codes", "GitHub Actions" and FAQ updated. |
| R013 | done | New opt-in `--fail-on-incomplete`: exit 3 when `coverage.toolLevel !== 'ok'` and the run is neither fatal nor stopped. Without the flag the exit code follows `--fail-on` as before. `src/report/github.ts` `annotations()` always prints one `::warning title=mcp-review-check::Partial check: <toolLevel> (<reason>); tool-level checks were skipped (N rules skipped) …` for a partial check that is not fatal and not stopped (those already get their `::error`). Documented in `--help`, README Options, Exit codes, GitHub Actions and a new CI recipe. |
| F148 | done | README install note now covers only a machine without registry access. |
| F150 | done | `package.json`: `main` removed, `"exports": { "./package.json": "./package.json" }` added, `bin` unchanged. Nothing in `test/` or `scripts/` imports the package by name or reads `main` (grep for `from 'mcp-review-check`, `import('mcp-review-check`, `"main"`, `pkg.main`: no hits). `test/pack.test.ts` passes (it packs a clean copy and runs the bin). README states that `exports` exposes only `package.json`. |
| F168-baseline | done | `--baseline <file>` in new `src/baseline.ts`, wired in `src/cli.ts`; details below. |

### Interpretation notes (decisions not reopened, only made precise)

- **Exit 4 vs `--fail-on-incomplete`.** The plan lists "stopped" among the partial states of R013 (exit 3 with the flag) and also makes a stop exit 4 (F011). I kept **exit 4 for every stop, with or without the flag**: the flag's goal (a partial check is never green) is met by 4 as well, and mapping a stop to 3 under the flag would undo F011's purpose (tell "too slow" from "unreachable"). Precedence in `src/cli.ts`: `fatal → 3`, `stopped → 4`, `--fail-on-incomplete && toolLevel !== 'ok' → 3`, `summary.failed → 1`, else 0.
- **`list-failed` counts as partial** for the flag and the annotation, next to `auth-required` and `token-rejected`: tool checks did not run in that state either (`coverage.toolLevel !== 'ok'`, score `n/a`). Drop it in `src/cli.ts`/`github.ts` if the maintainer wants the plan's literal list.
- **Score with `--baseline`** keeps counting every finding (`scored` is passed through unchanged); only the gate, the verdicts, the `errors`/`warnings`/`info` counts and the annotations see the new findings. Rationale: the score describes the server, not the delta; a baselined server with many known errors should not show 100/100.

### `--baseline` design

- **Input.** A report written by `--format json` (UTF-8, UTF-8 with BOM, UTF-16LE with BOM). Validated: JSON object, `tool.name === 'mcp-review-check'`, `schemaVersion` between 1 and `JSON_SCHEMA_VERSION`, `findings` an array whose entries have a string `ruleId`, a string-array `platforms`, and string-or-absent `tool`, `resource`, `path`, `message`. Anything else, an empty path, or a missing/unreadable file is a usage error (exit 2) before connecting; messages never quote the file (a JSON syntax error is reported as "not valid JSON").
- **Identity.** Rule ID + `tool` + `resource` + `path` (the SARIF `partialFingerprints` basis), with platforms as a covering condition: a finding is known when an unused baseline entry with the same key lists all of its platforms (a baseline for `--target all` covers a run for `--target claude`, not the reverse). Each baseline entry covers one finding, so one more repeat than the baseline had is new. Among several entries on the same key, the one with the same message after replacing every number with `#` is taken first, then any free one, so a reworded message (new release) or a changed number (sizes, counts, timings) stays known. `SRV-020` (the era note shown in the text/markdown header) is never baselined. Findings are matched in their redacted form, as the baseline file was written.
- **Output** (reporters `json.ts`, `sarif.ts`, `text.ts`, `markdown.ts` untouched; `src/baseline.ts` post-processes their output from data the CLI already has):
  - JSON: every finding (new and known, in the usual sort order) with `baselined: true|false`; `summary.baselined` = number of known findings. `schemaVersion` stays 1 (additive).
  - SARIF: every result with `baselineState: "new" | "unchanged"` (SARIF 2.1.0 §3.27.24); `runs[0].properties.summary.baselined`. Validated against `test/fixtures/sarif-schema-2.1.0.json` in the new test.
  - Text: only the new findings, plus one line `N known finding(s) from baseline, not listed: TOOL-014 ×3, …` (rule IDs only, at most 8, no server text) above the Score line; not with `--quiet` (its documented content is findings, Score, Result, disclaimer).
  - Markdown and the GitHub job summary: a `| Baseline | … |` row under `| Findings |` in the summary table, same text.
  - `--output` summary line: `· N known from baseline`.
  - GitHub annotations: only new findings (`annotations()` reads `report.findings`).
- **Redaction.** Known findings are passed through `redactDeep(…, redactor)` like the report; the new e2e test runs the leaky fixture with `--api-key` in all four formats plus the job summary and finds no secret.

## Deferred

| Item | Reason |
|---|---|
| Update of existing tests that assert the old exit 3 for a `--max-duration` stop | needs `test/incomplete.test.ts`, `test/e2e-stdio.test.ts`, `test/e2e-http.test.ts`, `test/remediation-w3c-cli-tests.test.ts` (not owned by W4A). Exact assertions to change: `test/incomplete.test.ts:79, 91, 98, 126, 141` (`toBe(3)` → `toBe(4)` for the stopped runs; the `refused` runs stay 3) and the describe/it titles mentioning exit 3; `test/e2e-stdio.test.ts:262` (`toBe(3)` → `toBe(4)`, comment "a stop after the handshake is exit 4"); `test/e2e-http.test.ts:303` and `:327` (`toBe(3)` → `toBe(4)`, comments likewise); `test/remediation-w3c-cli-tests.test.ts:30` (expected codes `['0','1','2','3','4','128+N']`). No other existing test in the files run below fails. |
| `--save-baseline`, tool-definition drift (hash of each tool definition, "Changed tool definitions"), `--diff-only` (MARKET.md §3.3) | feature: separate CLI modes beyond the P0 `--baseline` chosen in wave4-plan.md. `--format json --output <file>` already writes a usable baseline. |
| README pin `@0.1` in the older CI recipes, Docker Compose and Stability policy | release step: the new recipes use `@0.2` because the flags exist only from 0.2.0; bump the remaining `@0.1` pins when 0.2.0 is tagged (W4E / release). |
| CHANGELOG, `docs/design/spec.md` | not W4A files by the plan; proposed text below. |

## Files changed

- `src/cli.ts` — exit 4, `--fail-on-incomplete`, `--baseline` (option, early load, split into new/known, rendering, step summary, `--output` line), `--help`.
- `src/baseline.ts` (new) — `loadBaseline`, `knownFindings`, `renderJsonWithBaseline`, `renderSarifWithBaseline`, `addBaselineToText`, `addBaselineToMarkdown`, `BaselineError`.
- `src/report/github.ts` — partial-check `::warning`; comment for exit 3/4.
- `package.json` — `exports` added, `main` removed.
- `README.md` — Options (`--max-duration`, `--fail-on-incomplete`, `--baseline`), Exit codes (row 4, row 3, partial-check paragraph), GitHub Actions, CI recipes (baseline, `--fail-on-incomplete`, exit 4), FAQ, install note (F148), CLI-only note (F150).
- `test/remediation-w4a-exit-codes.test.ts`, `test/remediation-w4a-package.test.ts`, `test/remediation-w4a-baseline.test.ts` (new).

## Verification

Run in the worktree (with `node_modules` linked from the main checkout; Node 26.13.0):

- `npm run typecheck` — clean.
- `npm run build` — clean.
- `MCP_REVIEW_CHECK_SKIP_BUILD=1 npx vitest run test/remediation-w4a-exit-codes.test.ts test/remediation-w4a-package.test.ts test/remediation-w4a-baseline.test.ts` — 3 files, 28 tests passed (exit codes 7, package 3, baseline 18).
- `MCP_REVIEW_CHECK_SKIP_BUILD=1 npx vitest run` on the three W4A files plus `test/docs.test.ts test/cli-rules.test.ts test/output-modes.test.ts test/ci-output.test.ts test/remediation-wp1-cli.test.ts test/remediation-w3c-cli-tests.test.ts test/report.test.ts test/sarif.test.ts test/remediation-wp9-report-redact.test.ts test/incomplete.test.ts test/max-duration.test.ts test/e2e-redaction.test.ts test/pack.test.ts` — 16 files, 255 tests: 249 passed, 6 failed, all six the old exit-3 expectation for a stop (`incomplete.test.ts` ×5, `remediation-w3c-cli-tests.test.ts` ×1; see Deferred). `pack.test.ts` passes (it needs the commits, since it packs the tracked files).
- `MCP_REVIEW_CHECK_SKIP_BUILD=1 npx vitest run test/e2e-stdio.test.ts test/e2e-http.test.ts test/cta.test.ts test/local-mode.test.ts` — 4 files, 65 tests: 62 passed, 3 failed, all three the old exit-3 expectation for a stop (`e2e-http.test.ts:303`, `:327`, `e2e-stdio.test.ts:262`; see Deferred).

The whole suite was not run (REMEDIATION §3, D1).

## Proposed CHANGELOG lines (`## [Unreleased]`)

### Added
- `--fail-on-incomplete`: exit 3 when the check is partial (the server requires auth and no token was given, the token was rejected, or `tools/list` failed), so a CI job whose token is missing or expired no longer passes. Off by default; without it the exit code follows `--fail-on` as before (review R013).
- In GitHub Actions, a partial check prints one `::warning` titled `mcp-review-check` that names the reason and says that tool-level checks were skipped, with or without `--fail-on-incomplete` (review R013).
- `--baseline <report.json>`: findings already present in an earlier `--format json` report are known and no longer count toward `--fail-on`, the verdicts, the finding counts or the annotations; only new findings do. JSON marks every finding `baselined` and adds `summary.baselined`, SARIF sets `baselineState` (`new` / `unchanged`), text and markdown list only new findings plus one line with the known count. Findings are matched by rule, tool or resource, path and platforms, not by wording. A missing file or a file that is not a JSON report of mcp-review-check is a usage error (exit 2) (review F168).

### Changed
- **Exit code 4** (was 3) when `--max-duration` stops the check after the handshake, so CI can tell a slow server from an unreachable one. Exit 3 still means could not connect or complete a handshake (also when the deadline ran out before it) or an internal error (review F011).
- The package is CLI-only: `package.json` has no `main` any more and an `exports` map that exposes only `./package.json`, so `import 'mcp-review-check'` and deep imports of `dist/` fail; the `mcp-review-check` bin is unchanged (review F150).

### Fixed
- README: the note on running from a checkout no longer says the package is unpublished; it covers only a machine without registry access (review F148).

## Proposed text for `docs/design/spec.md`

### §3.2 Exit codes (replacement table)

| Code | Meaning |
|---|---|
| 0 | Completed, below the `--fail-on` threshold (with `--baseline`: no new finding reaches it). |
| 1 | Completed, threshold reached for a `--target` directory (or for the spec with `--fail-on-spec`); with `--baseline`, counted over new findings only. |
| 2 | Usage or configuration error (including a `--baseline` file that is missing or not a JSON report of mcp-review-check), or `--output` could not be written. |
| 3 | Could not connect or complete a handshake (also when `--max-duration` ran out before the handshake); with `--fail-on-incomplete`, a partial check (`coverage.toolLevel` is `auth-required`, `token-rejected` or `list-failed`); or an internal error (`fatal:` and a stack trace on stderr). |
| 4 | `--max-duration` stopped the check after the handshake (`limits.stopped` set, no fatal error), at any `--fail-on` and with or without `--fail-on-incomplete`; the Result line reads `INCOMPLETE (stopped at --max-duration during <phase>)` and JSON `summary.failed` is `true`. |
| 128+N | Ended by signal N; no report is written. |

Precedence: fatal (3) → stopped (4) → partial with `--fail-on-incomplete` (3) → gate (1) → 0. Without `--fail-on-incomplete`, a partial check exits by `--fail-on`; in GitHub Actions it always adds one `::warning` titled `mcp-review-check` naming the reason. Exit 3 and 4 add one `::error` titled `mcp-review-check` with the cause.

### §8 Q5 (answer)

**Q5 — Should a `--max-duration` stop have its own exit code?** Yes. From 0.2.0 a stop after the handshake exits 4, so CI can tell "too slow" (4) from "unreachable" (3). A deadline that runs out before the handshake is a connect failure and stays exit 3. The change ships in a minor release, as the stability policy allows for a contract change, and is listed under "Changed" in the CHANGELOG.

### §8 Q6 (answer)

**Q6 — Should a partial check (auth required, token rejected) fail the run?** Not by default: the exit code keeps following `--fail-on`, so existing pipelines that check an OAuth server without a token keep their result. The opt-in `--fail-on-incomplete` makes any partial check (`auth-required`, `token-rejected`, `list-failed`) exit 3; a stop is exit 4 with or without it. Independently of the flag, the GitHub Actions output prints one `::warning` for a partial check, naming the reason and that tool-level checks were skipped, so a green job with skipped checks is visible.

## Note on the commit trailer

The commits carry `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, the model that wrote them, not the `Claude Fable 5.1` trailer the brief and earlier commits use; change it on integration if the repository wants one trailer.
