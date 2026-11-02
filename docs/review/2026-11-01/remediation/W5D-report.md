# W5D-ci report — wave 5 (0.3.0)

Package W5D-ci of [wave5-plan.md](wave5-plan.md): action outputs, F151 engines, release cadence and trusted publishing text, version-default preparation. Branch `worktree-agent-acc3d594710219548`, written 2026-11-02.

## Items

| Item | Status | What |
|---|---|---|
| Action outputs | done | `action.yml`: the single CLI run adds `--json-output "$json_file"` (`$RUNNER_TEMP/mcp-review-check-$$.json`), SARIF unchanged. A new step `id: report`, `if: always()`, between the run step and the upload step, reads the JSON with `node -e` and writes the outputs `score`, `verdict`, `verdict-claude`, `verdict-chatgpt`, `errors`, `warnings` and `new-findings`. The run step adds the output `report-json`. `version` default `'0.3'`. `ci.yml` `action` job: assertions on the new outputs. |
| F151 engines | done | `engines.node` `>=22.12` (package.json and lockfile root). `@types/node` `^22.20.5` (installed 22.20.5) through `npm install --ignore-scripts @types/node@^22 --save-dev`. `npm ci --ignore-scripts` from a clean `node_modules` works, and typecheck passes with no type changes needed. CI matrix `['22', '24']` on every OS, with the 20.19 exclusions and the Node 20 comment removed. The action's "node is not on PATH" hint now says Node 22.12. CONTRIBUTING: Setup and CI paragraph. |
| Dependabot | kept, comment updated | The ignore rule was not specific to Node 20: it ignores **semver-major** updates of `@types/node`, so the types follow the oldest supported Node major. After the bump it holds `@types/node` on 22, which matches `engines >=22.12` and is the intended policy. Without the rule, Dependabot would propose `@types/node` 24 and let code that uses Node 24-only APIs typecheck. The comment now says `engines >=22.12`. If the maintainer wants the rule gone anyway, it is a two-line deletion. |
| `release.yml` | unchanged | It does not mention Node 20 (it builds on `'24'`). |
| Release cadence, trusted publishing | done | CONTRIBUTING "Releasing" now covers: the cadence (while 0.x, each feature or coherent feature set is its own minor release); trusted publishing, configured 2026-11-02 for `release.yml` with environment `npm`; and the `Publish to npm (first release, NPM_TOKEN)` step as a documented fallback that runs only while the secret exists and can be removed once a trusted-publishing release has passed the provenance check. I did not remove the step. |
| Version bump preparation | done | `package.json` `version` stays `0.2.0`. The `action.yml` default is `'0.3'`. Two tests tie it to package.json, and both accept `MAJOR.MINOR` **or the next minor**: the existing W4D assertion (already tolerant) and the new W5D one. They pass now (0.2.0, default 0.3) and after `npm version minor` (0.3.0, default 0.3). After that, the W5D test's literal `toBe('0.3')` has to move with the next minor, as CONTRIBUTING step 2 says. |
| `v0` moving tag, coverage job | not in scope | Unchanged from §8.3. |

### Outputs: how each is derived (from `src/report/json.ts`, `src/report/index.ts`, `src/baseline.ts`)

| Output | Source |
|---|---|
| `score` | `summary.score`, only when it is a non-negative integer. `null` (partial check) gives an empty output. |
| `verdict` | **The JSON has no overall result word.** It has `summary.failed` (boolean), per-platform `summary.verdicts`, and `limits.stopped`. The step derives the word the CLI's Result line prints (`resultLine` in `src/report/index.ts`): `INCOMPLETE` when `limits.stopped` is set, otherwise `FAIL` when `summary.failed` is true, otherwise `PASS`. A connect failure (exit 3) has `failed: true` and gives `FAIL`, as the Result line does. |
| `verdict-claude`, `verdict-chatgpt` | `summary.verdicts.<platform>.verdict` (`BLOCKED`, `NEEDS ATTENTION`, `NO AUTOMATED BLOCKERS`, `INCOMPLETE`). Empty when the platform is not a target. These are added beyond the task list because MARKET.md and §8.3 asked for `verdict-claude` / `verdict-chatgpt` and they cost nothing more. |
| `errors`, `warnings` | `summary.errors`, `summary.warnings`. With `--baseline` these are already the new findings only (`renderJsonWithBaseline`). |
| `new-findings` | `findings.length - (summary.baselined ?? 0)`. With a baseline, `findings` holds the new and the known findings, each with `baselined`. All severities, info included. Findings dropped with `--ignore` are in `ignored`, not `findings`, so they are not counted. |
| `report-json` | The JSON report's path, empty when the file was not written. |

Safety: only integers and words matching `^[A-Z][A-Z ]*$` are written, so a report value with a newline cannot inject an output line (tested). The step's script has no `${{ }}` and receives the path through `env: REPORT_JSON`.

Missing report: when there is no `report-json` (exit 2, or a CLI older than 0.3 that rejects the flag), no file, no `node` on PATH, or JSON that does not parse, every output is empty and the step exits 0. A parse failure also prints a `::warning`. The run step has already failed the job with the CLI's code, so the action's overall result is unchanged.

The JSON file name includes `$$`, the run step's PID, so two uses of the action in one job (as in the CI self-test) do not overwrite each other's report.

## Files changed

- `action.yml`: `--json-output` in the run step, `report-json` output, new `report` step, 7 new outputs, `version` default `'0.3'`, Node 22.12 hint, header comment.
- `.github/workflows/ci.yml`: matrix `['22', '24']` without exclusions. In the `action` job's check step: `GOOD_SCORE` must be a number, `GOOD_VERDICT` non-empty and `PASS`, `GOOD_ERRORS` 0, `GOOD_NEW` numeric, `report-json` set; `BAD_VERDICT` `FAIL`, `BAD_CLAUDE` `BLOCKED`, `BAD_ERRORS` ≥ 1. All checks now run one per line. **Pre-existing bug fixed:** the old `test a && test b` lines did not fail the step when `a` failed, because `bash -e` ignores a failure before the last `&&` of a list.
- `.github/dependabot.yml`: comment only (see above).
- `package.json`, `package-lock.json`: engines, `@types/node`.
- `CONTRIBUTING.md`: Node 22.12, CI matrix description, cadence, trusted publishing and fallback, the action needs 0.3 or newer, and the example default is now `'0.4'`.
- `test/remediation-w5d-action.test.ts`: new, 15 tests (1 skipped until W5A lands, see below).
- `test/remediation-w4d-action.test.ts` (**outside the new-file list; edited because my change broke it**): the outputs assertion `toEqual(['exit-code', 'sarif-file'])` became `arrayContaining` (the full list is asserted in the W5D test). The exit-2 outputs now include `'report-json': ''`. The script helper sets `RUNNER_TEMP` to its temp dir. The happy-path script test (`writes the SARIF report and the outputs…`) is `skipIf` the built CLI's `--help` lacks `--json-output`: before W5A is integrated, the CLI exits 2 on the unknown option.
- `docs/review/2026-11-01/remediation/W5D-report.md`: this file.

Not touched: `test/workflows.test.ts`, `test/lifecycle.test.ts`, `test/remediation-w4a-package.test.ts` (they still pass), and README, CHANGELOG, spec, `src/`.

## Dependency on W5A (`--json-output`)

This worktree does not have W5A's `--json-output`, so two tests skip here: the W4D happy-path script test and the W5D end-to-end "run and report steps with the built CLI" test. **After integrating W5A, both must run and pass; check that they are not reported as skipped.** The CI `action` job also depends on the flag. The `report` step itself is fully tested here, on real JSON reports from `dist/cli.js --format json --output` (good, bad, bad against its own baseline, a stopped report, missing, broken and hostile files, no node).

A local end-to-end simulation through a shim CLI that emulates `--json-output` with a second run (scratchpad only, not committed), with both steps extracted from `action.yml` with PyYAML and run in bash:

- good-server: run exit 0, `score 100`, `verdict PASS`, both platform verdicts `NO AUTOMATED BLOCKERS`, `errors 0`, `warnings 0`, `new-findings 2`.
- bad-server, `platform: claude`: run exit 1, report step exit 0, `score 0`, `FAIL`, `verdict-claude BLOCKED`, `verdict-chatgpt` empty, `errors 11`, `warnings 15`, `new-findings 35`.

macOS (bash 3.2) and Windows (Git Bash) are verified only by the CI `action` job once pushed. The report script uses only `[`, `echo`, `command`, a `for` loop and `node`, all portable. On Windows `RUNNER_TEMP` is a `D:\a\_temp` path: the CLI and `node` read it fine, and CI asserts only that `report-json` is non-empty, not `test -f` on it.

## Verification

| Command | Result |
|---|---|
| `npm install --ignore-scripts @types/node@^22 --save-dev`, then `rm -rf node_modules && npm ci --ignore-scripts` | installs, 0 vulnerabilities |
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `MCP_REVIEW_CHECK_SKIP_BUILD=1 npx vitest run test/remediation-w5d-*.test.ts test/remediation-w4d-action.test.ts test/workflows.test.ts test/lifecycle.test.ts test/remediation-w4a-package.test.ts test/pack.test.ts` | 6 files, 39 passed, 2 skipped (the two `--json-output` tests above) |
| `python3 -I yamlcheck.py <worktree>` (`yaml.safe_load` of `.github/workflows/*.yml`, `.github/dependabot.yml`, `action.yml`) | all 5 parse |
| Shim simulation (above) | outputs as listed |

## Proposed CHANGELOG lines (`## [Unreleased]`)

### Added
- GitHub Action outputs from the report of the same run: `score` (empty for a partial check), `verdict` (`PASS`, `FAIL` or `INCOMPLETE`, as the Result line), `verdict-claude` and `verdict-chatgpt` (the directory verdicts), `errors`, `warnings`, `new-findings` (findings not in the `--baseline`) and `report-json` (path of the JSON report). The action writes the report with `--json-output`, so its `version` input now defaults to `0.3` and needs 0.3 or newer.

### Changed
- Requires Node 22.12 or newer (was 20.19): Node 20 has been end-of-life since 2026-04-30. CI runs Node 22 and 24 on Linux, macOS and Windows, and the development types are `@types/node` 22. While the version is 0.x, a minor release may raise the minimum Node version.
- Releases publish through npm trusted publishing only. The `NPM_TOKEN` step in `release.yml` stays as a documented fallback for while the secret exists (CONTRIBUTING.md).

## Proposed README text (for the docs step to paste)

Line 9 (requirements bullet):

```markdown
- Requires Node 22.12 or newer; no telemetry.
```

In the GitHub Action section, the `version` row of the input table:

```markdown
| `version` | `0.3` | npm version or range of mcp-review-check to run; 0.3 or newer (the outputs read the report written with `--json-output`). |
```

and the `uses:` examples move to `@v0.3.0`. Replace the "Outputs:" paragraph (README line 310) with:

````markdown
| Output | Value |
|---|---|
| `exit-code` | The CLI's exit code (see [Exit codes](#exit-codes)); the step fails with the same code. |
| `sarif-file` | Path of the SARIF report, empty when none was written. |
| `report-json` | Path of the JSON report (the `--format json` document) in the runner's temp directory, empty when none was written. |
| `score` | Score 0–100, empty for a partial check. |
| `verdict` | `PASS`, `FAIL` (threshold reached, or the server could not be checked) or `INCOMPLETE` (stopped by `--max-duration`), as the Result line. |
| `verdict-claude`, `verdict-chatgpt` | Directory verdict: `BLOCKED`, `NEEDS ATTENTION`, `NO AUTOMATED BLOCKERS` or `INCOMPLETE`; empty when the platform is not checked. |
| `errors`, `warnings` | Number of error and warning findings (with `--baseline` in `extra-args`, of the new ones only). |
| `new-findings` | Findings of any severity that are not in the baseline (all findings without one). |

Every output except `exit-code` and `sarif-file` is empty when no report was written (a usage error, exit 2). The outputs are set also when the check fails, so a later step with `if: always()` can use them:

```yaml
      - uses: alisaosipova/mcp-review-check@v0.3.0
        id: review
        with:
          stdio: node dist/server.js
      - if: always()
        run: echo "score ${{ steps.review.outputs.score }}, ${{ steps.review.outputs.verdict }}, ${{ steps.review.outputs.new-findings }} new"
```

The action needs Node 22.12 or newer on the runner (GitHub-hosted runners have it; add `actions/setup-node` otherwise). Pin a full tag such as `@v0.3.0` or a commit SHA.
````
