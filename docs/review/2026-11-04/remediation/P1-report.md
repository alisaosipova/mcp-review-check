# P1 CLI and config: remediation report (1.0.1)

Base: `origin/main` 5c521cb. Files changed: `src/cli.ts`, `src/config.ts`, `src/baseline.ts`, `src/report/drift.ts`.
`src/input-file.ts` is unchanged: `INPUT_FILE_CAP` is only imported for A01-08. New tests: `test/r3-p1-cli-config.test.ts`
and `test/r3-p1-baseline-cap.test.ts`. The new tests build each reviewer repro and check the fixed behaviour.

Pre-fix check: the test files import helpers that are new in this package (`pinFingerprints`), so against `origin/main`
they fail at import. The behaviour was therefore also checked with `dist/cli.js` built from the `origin/main` sources
and again from the fixed sources (a scratchpad script, nothing written to the repo):

| Item | origin/main | fixed |
|---|---|---|
| A01-01 `.mcp-review-check.json` with `stdio` in a plugin folder, `--plugin-dir .` | exit 3, the command ran (PWNED file created), stderr empty | exit 0, nothing ran, a warning names the file and the keys `"stdio", "args"` |
| A01-09 `--header "X-Api-Key:" "$KEY"` | `error: invalid URL: <the key>` | `error: invalid URL (the value is not shown; is a value missing its option?)` |
| A07-06 listing-only `--save-baseline` | `toolFingerprints: []` | `toolFingerprints: null` |
| A07-04 server stderr `::error ...` and `##[group]` with `--verbose` in GitHub Actions | 2 lines start a workflow command | 0 |

The other items were reproduced by the verifiers at 1f24aba (see r101-items.json).

Patch-policy check: no rule was added and no severity changed. No exit code changes for a run that has a target and
consistent outputs. The exceptions are a discovered config file that named the server (A01-01, a security fix) and
the new `--baseline`/`--output` collision usage error (A01-06). Both are listed under "Changed" below.

## Per item

| ID | What changed | Test |
|---|---|---|
| A01-01 | `loadConfig(file, false)` (a discovered file) still validates every key. It then drops `url`, `stdio`, `args`, `output`, `jsonOutput`, `saveBaseline`, `cwd`, `env`, `header`, `bearer`, `active` and `activeAuth`, and warns with the file and the ignored keys (`DISCOVERED_FORBIDDEN`, `LoadedConfig.given`/`ignoredKeys`). `--config` keeps full power. Each applied config file prints `mcp-review-check: options from config file X` (or `--config X`) on stderr, plus `(the server from its key "url"/"stdio")` when the server came from it. Because a discovered URL is never used, `$MCP_REVIEW_CHECK_TOKEN` is never sent to one. `--help` says the same. | `A01-01 ...` (5 cases) |
| A01-02 | `--save-baseline` is not written when `snap.fatal` (exit 3) or `limits.stopped` (exit 4). A warning says so and keeps the earlier baseline. `--json-output` is still written. | `A01-02 exit 3 keeps the accepted baseline` |
| A01-04 | `incompleteTools()` returns `no server was checked (a listing-only run)` for a listing target, so a listing-only `--baseline` run reads "not compared" and does not list every tool as removed. | `A01-04 a listing-only --baseline run ...` |
| A07-06 | Same root cause: a listing-only report now writes `toolFingerprints: null`. `readBaseline` treats a 1.0.0 listing-only report (`server.listingOnly` with `[]`) as null. `--save-baseline` warns when it records no fingerprints. | `A07-06 ...` (2 cases) |
| A01-05 | `pinFingerprints(report.snap, snap)` computes the JSON `toolFingerprints` and the drift digests over the snapshot the rules saw (strong secrets scrubbed, `--env` values not), while keeping the redacted names. For upgrades, `compareTools` also treats a tool as unchanged when its digest in the report's redacted form matches, which is what 1.0.0 wrote. So a 1.0.1 patch reports no drift that 1.0.0 did not. `knownFindings` gets an optional `alt` (the findings as the rules wrote them), which is tried for findings still new. | `A01-05 ...` (2 cases) |
| A01-06 | `samePath()` compares by device and inode when both files exist (symlink, hard link), else by realpath(parent) + basename, case-folded on win32/darwin. New usage error: `--baseline` and `--output` naming the same file in a non-json format. `--save-baseline` = `--baseline` and `--output` in `--format json` over the baseline stay allowed. | `A01-06 ...` (2 cases) |
| A01-07 | `Drift.notComparedBy` is `'baseline'` or `'run'`. For a run-side reason, the `--fail-on-drift` warning says "fix this run (see the coverage line) before saving a baseline from it" and no longer says "re-save". `--save-baseline` warns when it writes `toolFingerprints: null`. | `A01-07 a partial run says to fix the run` |
| A01-08 | `--save-baseline` warns when the JSON document is larger than `INPUT_FILE_CAP` (what `--baseline` reads). The cap is unchanged. | `A01-08 ...` (cap mocked to 4 KiB) |
| A01-09 | `invalidUrlMessage()`: an argument without `://` is not shown ("invalid URL (the value is not shown; is a value missing its option?)"). A shown one has token-like pieces of 16 characters or more cut and goes through `visibleText`. | `A01-09 ...` |
| A01-10 | Treated as messages (REMEDIATION row; a usage error would turn a passing run into exit 2). `--bearer ""` warns that no token is sent, `$MCP_REVIEW_CHECK_TOKEN` included. `--tool-args ""` warns that no file is read. Behaviour is unchanged. | `A01-10 ...` (2 cases) |
| A07-04 | New `ciSafeLine()` in `src/cli.ts` does `visibleText`, then a leading `:` before `:` becomes `\u{3A}` and a leading `#` before `#[` becomes `\u{23}`. It covers every `--verbose` line built from server text: `[listing]`, `[http]` and `[stdio stderr]`. `github.ts` has no such helper (only `escapeCommand`). Hardening on the same path: the fatal (unexpected error) stack lines go through `ciSafeLine` after redaction, and the fatal `::error` annotation goes through `visibleText` before `escapeCommand`. | `A07-04 leading ::, ##[ and ESC ...`; `test/r3-p1-fatal.test.ts` (2 cases; the first fails on the code before this hardening) |
| A10-01 | With `--fail-on-incomplete` on a partial check (not fatal, not stopped), `summary.failed` is true and `gate.reason` gets `partial check: <level> (--fail-on-incomplete)`. So text, markdown, the `--output` summary line and JSON read FAIL. JUnit gets one `<error type="incomplete">` test case per suite, with counts updated, as a post-process in `cli.ts`. In GitHub Actions the partial-check `::warning` becomes `::error` and drops the "add the flag" advice. Without the flag nothing changes. | `A10-01 ...` (2 cases) |
| improvement | `knownFindings`: entries are pushed per subject, with used marks and a first-free pointer (no spread, no splice). `compareTools`: a queue per name with a read index (no spread, no shift). Measured with dist under load average 37: knownFindings 10k 0.65 s → 40k 1.19 s; compareTools 10k 3.1 s → 40k 6.7 s, mostly SHA-256 hashing. | `knownFindings grows about linearly ...`, `compareTools grows about linearly ...`, `knownFindings keeps its pairing ...` |

Existing tests changed because a fix changes the behaviour they assert:
- `test/remediation-w5a-config.test.ts`: four discovered-file tests now give the server on the command line or use `--config`. A discovered file no longer names the server and no longer sets env, bearer or jsonOutput (A01-01).
- `test/remediation-w4a-exit-codes.test.ts` "token-rejected": with `--fail-on-incomplete` the partial check is now one `::error` and no `::warning` (A10-01).

## Not fixed

None. Parts left for the integrator (files outside P1):
- A01-02: `docs/guide/ci.md`, GitLab recipe. Guard the `after_script` copy over the baseline with `[ "$CI_JOB_STATUS" = success ]`. The CLI no longer writes `--save-baseline` on exit 3 or 4, but the recipe copies `--json-output`, which is still written.
- A10-01: the CLI post-processes the report (`summary.failed`, `gate.reason`), the JUnit XML (`junitIncomplete`, a regex over `renderJunit` output) and the annotation (`incompleteAnnotation`, a prefix rewrite). A native version would pass `failOnIncomplete` to `buildReport` (`src/report/index.ts`), emit `<error type="incomplete">` in `src/report/junit.ts`, and choose `::error` in `src/report/github.ts`. The CLI helpers can then go. Until then, a change to the JUnit layout (the `<properties>` block of a suite) or to the partial-check annotation text silently turns this off. The A10-01 tests catch that.
- Docs: `docs/guide/options-and-config.md` and `listings.md` should state the A01-01 trust model (a found file only sets options, and the list of ignored keys). The fingerprint paragraph should say the digests do not depend on non-secret `--env` values (A01-05).
- Annotations built by `src/report/github.ts` from finding text use `escapeCommand` only. They keep raw ESC and bidi characters, but they cannot start a new command line. If wanted, apply `visibleText` in `annotations()` too. That is outside P1.

## Proposed CHANGELOG lines (1.0.1)

### Security
- A config file found in the working directory or `--cwd` (no `--config`) may no longer name the server (`url`, `stdio`, `args`), output files (`output`, `jsonOutput`, `saveBaseline`), `cwd`, `env`, `header`, `bearer`, `active` or `activeAuth`. Those keys are ignored with a warning that names the file. `--plugin-dir` inside an untrusted checkout therefore stays listing-only, and `$MCP_REVIEW_CHECK_TOKEN` never goes to a URL from such a file. `--config <file>` keeps full power. Every config file that is applied is named on stderr. (review A01-01)
- Server text printed by `--verbose` (`[stdio stderr]`, `[http]`, `[listing]`) can no longer start a GitHub workflow command: a leading `::` or `##[` is shown as `\u{3A}:` or `\u{23}#`. The stack of an unexpected error and its `::error` annotation show control and format characters as `\u{..}` too. (review A07-04)
- The "invalid URL" usage error no longer echoes an argument that is not a URL, such as a value that lost its option; token-like parts of a shown URL are cut. (review A01-09)

### Fixed
- `--save-baseline` is not written by a run that did not connect (exit 3) or was stopped by `--max-duration` (exit 4), so one flaky start no longer replaces an accepted baseline. `--json-output` is still written. (review A01-02)
- A listing-only run records `toolFingerprints: null` and compares no tools. It no longer reports every baseline tool as removed, and a listing-only baseline (also one written by 1.0.0) no longer reports every server tool as added. (review A01-04, A07-06)
- Tool fingerprints no longer depend on non-secret `--env` values: adding or changing `--env WORKSPACE=…` no longer reports changed tools, and baselines written by 1.0.0 still match. A baseline finding whose subject held such a value still matches. (review A01-05)
- `--output` in a non-json format may no longer name the `--baseline` file. The `--output`/`--save-baseline`/`--json-output` collision check now also catches symlinks, hard links and case differences on macOS and Windows. (review A01-06)
- With `--fail-on-incomplete`, a partial check (exit 3) reads as failed everywhere: `Result: FAIL`, JSON `summary.failed` and `gate.reason`, a JUnit `<error type="incomplete">`, and in GitHub Actions an `::error` in place of the `::warning`. (review A10-01)
- Matching findings against a baseline and comparing tool fingerprints are now linear for many findings on one subject or many tools with one name. (review improvement)

### Changed
- `--fail-on-drift` "not compared" advice: when this run is partial it says to fix the run before saving a baseline. `--save-baseline` warns when it records no tool fingerprints, and when the report is larger than the 16 MiB `--baseline` reads. (review A01-07, A01-08)
- `--bearer ""` and `--tool-args ""` print a warning: no token is sent, no file is read. (review A01-10)

## Proposed spec paragraphs (docs/design/spec.md)

- **Config file trust.** The CLI uses a config file found by discovery (`mcp-review-check.config.json` or `.mcp-review-check.json` in `--cwd` or the working directory) only for options. Its server keys (`url`, `stdio`, `args`), output paths (`output`, `jsonOutput`, `saveBaseline`), `cwd`, `env`, `header`, `bearer`, `active` and `activeAuth` are validated, then ignored with a stderr warning that names the file and the keys. Only `--config <file>` may set them. Each applied config file is named on stderr, with the key the server came from.
- **Tool fingerprints.** `toolFingerprints` digests the tool definitions as the rules saw them: strong secrets scrubbed, run-specific `--env` values not redacted. Names are the redacted report's. When it compares, a tool also counts as unchanged if its digest in the report's redacted form matches, which keeps 1.0.0 baselines valid. A listing-only report has `toolFingerprints: null`.
- **Baseline writes.** `--save-baseline` is skipped on exit 3 (no connect) and exit 4 (a `--max-duration` stop). It warns when the report records no fingerprints or is larger than `INPUT_FILE_CAP`.
- **--fail-on-incomplete.** On a partial check the report is failed: `summary.failed` is true and `gate.reason` names `partial check: <level> (--fail-on-incomplete)`. JUnit adds one `<error type="incomplete">` per suite, and the GitHub partial-check annotation is an `::error`.

## Tests run

- `npm run typecheck`: pass. `npm run build`: pass. Every commit of the package was checked with `tsc --noEmit`.
- `npx vitest run test/r3-p1-cli-config.test.ts test/r3-p1-baseline-cap.test.ts`: 2 files, 24 tests, 24 pass. `test/r3-p1-fatal.test.ts`: 2/2 pass. With the fatal-path change reverted, 1 of the 2 fails as expected.
- After the fatal-path change: `test/max-duration.test.ts` (the other test file that asserts `fatal:` output) was run again with the three r3-p1 files. See the final line below.
- Existing test files that import or run the changed modules (`grep -l` on `src/cli|config|input-file|baseline|report/drift.js`, `dist/cli`, `runCli`): 27 files, 299 tests. catalog-stale, ci-output, cli-rules, docs, e2e-http, incomplete, max-duration, p5a-proxy, p6-listing-offline, pack, process-tree, remediation-w3c-cli-tests, w4a-baseline, w4a-exit-codes, w4a-package, w4d-action, w5a-config, w5a-json-output, w5a-junit, w5d-action, w6a-drift, w6a-schema, w6f-listing-cli, w6h-review-fixes, wp1-cli, sarif, windows. In one run, 295 passed and 4 failed. Those 4 hit 30 to 60 s timeouts at load average 26 to 31 (other sessions share the host). The 3 files with failures (ci-output, incomplete, remediation-w4a-baseline) were then run on their own: 30/30 pass.
- Final run on the last commit: `npm run typecheck` and `npm run build` pass. `npx vitest run` on r3-p1-cli-config, r3-p1-baseline-cap, r3-p1-fatal, max-duration, remediation-w4a-exit-codes and remediation-w5a-config: 6 files, 65 tests, 65 pass.
