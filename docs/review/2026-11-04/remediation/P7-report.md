# P7 Reports and schema: remediation report (1.0.1)

Base: `origin/main` 5c521cb. Owned files: `src/report/**` (except `drift.ts`), `schema/report.schema.json`, `test/r3-p7-*.test.ts`. No existing test was changed.

Stability check (README 1.x policy): no change adds a finding or raises a severity. The schema now accepts reports it wrongly rejected. Text, annotation and SARIF/JSON changes are presentation-only: hidden characters shown as `\u{..}`, `##[` neutralised, no indentation above 10 000 findings, and a clear error in place of a crash.

## Fixed

### A07-02 = A10-03: a listing-only JSON report fails the schema
- `schema/report.schema.json`: `server.oneOf` gets a third branch, `{ required: [listingOnly], properties: { url: false, command: false, argv: false } }`. The url and command branches now forbid `listingOnly`, so exactly one branch matches.
- Test: `test/r3-p7-schema.test.ts`, "A07-02 / A10-03": `--plugin-dir` and `--openai-manifest` reports validate. The schema still rejects listingOnly together with url or command, and a server block that has none of the three. Before the fix, 3 of these cases failed with the reviewer's errors.

### A07-03: a budget-exhausted report fails the schema
- `limits.budgetExhausted` is declared (closed object; `bytes` and `overBytes` integers >= 0, `phase` a string, `completed` and `unfinished` string arrays, all required). `limits.truncated[].unit` is now `enum ["items","bytes"]`. The `limits` description now names the budget stop.
- Test: `test/r3-p7-schema.test.ts`, "A07-03". It runs the real CLI against `many-tools-server.mjs`, with `buildSnapshot` mocked to `snapshotBudget: 20000`, as in the w6h test. The report validates; an extra key in `budgetExhausted` and an unknown `unit` are rejected. It failed before the fix.

### A10-04: `$schema` pointed at v0.4.0
- `src/report/json.ts`: `JSON_SCHEMA_URL` is now built from `VERSION` (package.json): `https://raw.githubusercontent.com/alisaosipova/mcp-review-check/v${VERSION}/schema/report.schema.json`. The schema `$id` is set to the v1.0.0 URL, which matches package.json today.
- Test: `test/r3-p7-schema.test.ts`, "A10-04". `JSON_SCHEMA_URL` equals the URL with `v${package.json version}`, `SCHEMA.$id` equals `JSON_SCHEMA_URL`, and a real report names it. **The test fails on a version bump until the release step also updates `$id`** (see the integrator notes). `remediation-w6a-schema.test.ts` still passes (`$id === JSON_SCHEMA_URL`, versioned pattern).

### A07-05: raw ESC and bidi characters in GitHub annotations
- `src/report/github.ts` `annotations()`: the title (`ruleId subject`) goes through `ciSafeText` (visibleText plus `##[` neutralised) before `escapeCommand`. Message and fix go through the same helper line by line, so the intended line break before `Fix:` stays `%0A`. The connect-failure cause and the partial-check reason, which can quote the server, are shown the same way.
- Test: `test/r3-p7-ci-safe.test.ts`, "A07-05" (4 cases): a tool name with ESC[2K, ESC[8m and U+202E; an OSC 8 hyperlink in a message; U+2028; a connect-failure reason with ESC. A run through the real rules gives no hidden characters.

### A07-07: legacy `##[command]` in the text report
- `src/report/index.ts`: new shared helpers.
  - `neutralizeCommands(line)`: a leading `::` becomes `\u{3A}:`, as before, and every `##[` becomes `#\u{23}[`.
  - `ciSafeText(s)`: visibleText plus `##[`.
  - `ciSafeLine(s)`: visibleText plus `neutralizeCommands`. It is meant for P1's `--verbose` stderr lines.
  - `github.ts` re-exports all three.
- `src/report/text.ts`: the final pass uses `neutralizeCommands`. It also splits every output element on `\n` first, so a line inside a multi-line element is covered too.
- Test: `test/r3-p7-ci-safe.test.ts`, "A07-07" and "the CI-safe helpers". A server name `Evil ##[stop-commands]tok1` and a tool name `grab##[set-output name=verdict;]PASS` print as `#\u{23}[`, with colour off and on, and no line starts with `::`.

### A09-05: SARIF crashes with RangeError at about 80 000 tools
- `src/report/index.ts`: new `stringifyReport(doc, format, findings)`, used by `renderSarif` and `renderJson`.
  - Up to `COMPACT_FINDINGS` (10 000) findings the output is indented as before. Above that it is compact, which is about half the size and memory.
  - A `RangeError` from `JSON.stringify` becomes a `ReportTooLargeError`. Its message gives the finding count and suggests `--ignore <rule id>`, `--target` or `--format text`.
- Measured after the fix, with `dist/cli.js --format sarif --output` and 80 000 tools (the reviewer's `many80000.mjs`): exit 1 (findings), a 295 MB SARIF file written, no crash. Before the fix: exit 3, `fatal: RangeError`, no file.
- Test: `test/r3-p7-large-report.test.ts` (4 cases): indentation up to the threshold; above it, one compact line with the same content (SARIF and JSON); a RangeError becomes `ReportTooLargeError` with the hint; other errors pass through.
- Not done, by choice: collapsing repeated per-rule results. It would change code-scanning fingerprints and alert counts, which goes beyond a patch. At about 160 000 or more tools (compact output over V8's ~512 MiB string limit), the run now ends with the clear `ReportTooLargeError` message instead of an internal RangeError. Streaming the output would need a change to the `render()` contract in `cli.ts`.

### Improvements
- "Validate the JSON of every report shape in the schema test": done in `test/r3-p7-schema.test.ts` (listing-only plugin, openai manifest, budget-exhausted). Generating `Snapshot['limits']` and the schema from one source was not done: that needs `src/snapshot.ts` and a build step, which P7 does not own.
- "One CI-safe line helper": `ciSafeText`, `ciSafeLine` and `neutralizeCommands` are in `src/report/index.ts` and re-exported from `src/report/github.ts`. They are used by `text.ts` and `github.ts`. P1's `cli.ts` `--verbose` block should import `ciSafeLine` (integrator note).

## Not fixed
None. A09-05 is fixed for the reported case; its residual limit is described above.

## Integrator notes
1. **Release step (A10-04):** when package.json goes to 1.0.1, set `schema/report.schema.json` `$id` to `https://raw.githubusercontent.com/alisaosipova/mcp-review-check/v1.0.1/schema/report.schema.json`. `test/r3-p7-schema.test.ts` fails until you do. Optionally, add an npm `version` script that rewrites `$id` from package.json and stages it.
2. **`src/cli.ts` (P1), A09-05:** in the final `catch`, handle `ReportTooLargeError` (from `src/report/index.ts`) before the generic `fatal:` branch: `return { code: 3, stdout: '', stderr: \`${stderr}error: ${e.message}\n\` }` (plus the `::error` line in GitHub Actions), with no stack trace.
3. **`src/baseline.ts` (P1), A09-05:** `renderJsonWithBaseline` and `renderSarifWithBaseline` still call `JSON.stringify(doc, null, 2)`. Replace them with `stringifyReport(doc, 'json', all.length)` and `stringifyReport(doc, 'sarif', all.length)` so `--baseline` runs get the same bound.
4. **`src/cli.ts` (P1), A07-04 and the improvement:** use `ciSafeLine` from `src/report/github.ts` for every `--verbose` server stderr line. It covers ESC/bidi, a leading `::` and `##[`.
5. **Docs (P9 / docs owner):** `docs/guide/options-and-config.md:118` still names the `v0.4.0` `$id` and says "the schema URL keeps the tag that introduced it". It should say the `$id` is the URL at the tag of the installed release.

## Proposed CHANGELOG lines (1.0.1)
### Fixed
- The JSON Schema accepts the JSON report of a listing-only run (`--plugin-dir` / `--openai-manifest` without a server) (review A07-02, A10-03).
- The JSON Schema accepts a report whose snapshot byte budget ran out: `limits.budgetExhausted` is declared and `limits.truncated[].unit` may be `bytes` (review A07-03).
- `$schema` in the JSON report and the schema `$id` point at the tag of the installed release, not v0.4.0 (review A10-04).
- SARIF and JSON reports of more than 10 000 findings are printed without indentation, so a server with about 80 000 tools no longer crashes the run with `RangeError: Invalid string length`. A report still too large for one string ends with a clear "report too large" error and a hint (review A09-05).
### Security
- GitHub annotations show ESC, bidi overrides and other hidden characters of tool names and messages as `\u{..}` (review A07-05).
- The text report neutralises the legacy `##[command]` workflow-command syntax anywhere in a line, not just a leading `::` (review A07-07).

## Proposed spec paragraph (docs/design/spec.md §5.3, "Report schema")
Replace "Its `$id` is the raw GitHub URL of the file at the release tag that last changed it" with: "Its `$id` is the raw GitHub URL of the file at the tag of the release (`JSON_SCHEMA_URL`, built from the package version; the release step updates `$id` with the version and a test checks that they agree)". Add: "`server` is exactly one of `url`, `command` (with `argv`) or `listingOnly`; `limits.budgetExhausted` records a snapshot budget stop." Add to §5.3: "JSON and SARIF reports with more than 10 000 findings are printed without indentation; a report too large for one string ends the run with a 'report too large' error (exit 3)." Add to the CI-output paragraph: "No stdout or stderr line built from server text may start a workflow command: visibleText, a leading `::` and the legacy `##[` anywhere are neutralised (`ciSafeLine`)."

## Verification
- `npm run typecheck`: clean. `npm run build`: clean.
- New tests: `r3-p7-schema` 6, `r3-p7-ci-safe` 8, `r3-p7-large-report` 4. All pass.
- Existing test files for the changed modules, plus the CLI and CI-output tests that assert text or annotations (18 files): cta, incomplete, lifecycle, redact, remediation-w4a-exit-codes, remediation-w4a-package, remediation-w5a-junit, remediation-w6a-schema, remediation-w6g-core-followup, remediation-wp9-report-redact, report, root-causes, sarif, stderr-flush, ci-output, remediation-w6h-review-fixes, redaction-tiers, remediation-w4a-baseline. With the 3 new files: 21 files, 211 tests, all pass. `cta.test.ts` timed out once at the default 60 s because of host load (load average 57, one CLI run took 26 s). It passes with `--testTimeout=500000` (3/3). The timeout is not caused by this change.

## Review fixes

### A09-05 (medium): the --baseline renderers and the CLI message
- `src/baseline.ts`: `renderJsonWithBaseline` and `renderSarifWithBaseline` now end with `stringifyReport` (JSON: new + known + ignored findings; SARIF: every result, BASE-001 drift notes included), so `--baseline` runs are compact above `COMPACT_FINDINGS` and a RangeError becomes a `ReportTooLargeError`. This was integrator note 3; it is now done on this branch.
- `src/cli.ts`: the final `catch` handles `ReportTooLargeError` before the generic `fatal:` branch: exit 3, `error: <message>` on stderr with no stack, one `::error title=mcp-review-check::...` line in GitHub Actions, and the message goes through the redactor. This was integrator note 2; it is now done on this branch.
- Both are small edits in P1 files (one import and one block each). The integrator should keep them when merging P1's `cli.ts` and `baseline.ts`.
- Test: `test/r3-p7-review-fixes.test.ts`, "A09-05" (4 cases): the baseline renderers are indented up to the threshold and compact above it (new and known findings counted together), a RangeError becomes `ReportTooLargeError`, and the CLI prints `error:`, no `fatal:` and no stack, exit 3, with the `::error` line in Actions and a `SYNTH` `--env` value redacted from both.

### Low: legacy `##[` in JSON, SARIF and JUnit on stdout
- `stringifyReport` writes every `##[` as `##[`. In JSON, `##[` can only occur inside a string, so every parser reads the same value, and the runner (which looks for `##[` anywhere in a line) finds no command. The check runs only when the output contains `##[`.
- `renderJunit` writes `##[` as `#&#35;[` (no CDATA or comments in the document, so it is always in text or an attribute value, where a character reference is allowed).
- Test: `test/r3-p7-review-fixes.test.ts`: JSON, SARIF and both `--baseline` renderers contain no `##[` and parse back to the original tool names (including `###[`); JUnit has `#&#35;[` and no `##[`.
- Stability: presentation only; parsed values are unchanged and no finding or severity changes.

### Low: spec.md still has the old `$id` rule
- Skipped: `docs/design/spec.md` is not edited by package fixers. The replacement paragraph is in "Proposed spec paragraph" above; add with it: "JSON, SARIF and JUnit write the legacy `##[` as `##[` / `#&#35;[`."

### Changes to the proposals above
- Integrator notes 2 and 3 are done (see above). Notes 1, 4 and 5 stay.
- CHANGELOG, replace the A09-05 line with: "SARIF and JSON reports of more than 10 000 findings, with or without `--baseline`, are printed without indentation, so a server with about 80 000 tools no longer crashes the run with `RangeError: Invalid string length`. A report still too large for one string ends with exit 3 and an `error:` message with a hint, not a stack trace (review A09-05)."
- CHANGELOG, add under Security: "JSON, SARIF and JUnit reports write the legacy `##[` workflow-command syntax as `##[` (JSON) or `#&#35;[` (XML), the same value to a parser, so a report printed to a CI log cannot start a runner command (review A07-07 follow-up)."
