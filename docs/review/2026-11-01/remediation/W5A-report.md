# W5A-cli — report

Package W5A-cli of wave 5 (release 0.3.0, see `wave5-plan.md`). Branch `worktree-agent-a0cb75bf5ea2fb43e`, based on `a885abd`.

## Items

| Item | Status | Summary |
|---|---|---|
| Config file | done | New `src/config.ts` (`findConfig`, `loadConfig`, `ConfigError`), wired in `src/cli.ts`: `--config <file>`, discovery of `mcp-review-check.config.json` then `.mcp-review-check.json` in `--cwd` (else the working directory), `--no-config`. README "Config file" subsection with a full example, `--help` lines. |
| `--save-baseline <file>`, `--json-output <file>` | done | Both write the `--format json` document (with `baselined` marks under `--baseline`) besides the primary output, from the same redacted report. Write failure is exit 2. Config keys `saveBaseline`, `jsonOutput`. README Options, Exit codes and the baseline CI recipe updated. |
| `--format junit` | done | New `src/report/junit.ts` (`renderJunit(r, known?)`, `xmlText`), wired into both format lists, the render switch, the `--list-rules` warning and the local-mode banner (stderr, as for json/sarif). README "Output formats" subsection with a sample and a GitLab CI recipe, plus a pointer to `dorny/test-reporter`. |

Nothing deferred.

### Interpretation notes (decisions not reopened, only made precise)

- **Config precedence.** parseArgs defaults (`target`, `format`, `timeout`, `fail-on`) were removed from `OPTIONS` and applied after the merge, so "not on the command line" can be told apart from "the default". A flag on the command line wins. A list option given on the command line (`--ignore`, `--header`, `--env`) **replaces** the file's list. It does not add to it, so the command line always says exactly what runs. The server (`url`, `stdio`/`args`) comes from the file only when the command line names neither a `<url>` nor `--stdio`.
- **Scope of the file.** It applies to a check only. `--help`, `--version`, `--list-rules` and `explain` return before it is read, so a broken config file never breaks them (tested).
- **Value shapes.** `timeout`/`maxDuration` take a number or a string (both then go through the CLI regex). Switches take `true`/`false`, and `false` counts as an absent key. `ignore` is a string or an array. `header` is `["Name: value"]` or `{"Name": "value"}`, and `env` is `["K=V"]` or `{"K": "V"}`. `stdio` is a string, split like `--stdio "<command>"`, or `stdio` + `args` / a `stdio` array, kept verbatim like `--stdio -- …`.
- **Paths** (`output`, `jsonOutput`, `saveBaseline`, `baseline`, `toolArgs`, `cwd`) are resolved relative to the config file's directory, as tsconfig and eslint do. `sarifLocation` is left alone (repository-relative by design).
- **Errors.** Errors from the file itself are usage errors (exit 2) that name `--config <file>` or `config file <file>` and the key, never a value: an unknown key (a kebab-case key gets "did you mean failOn"), a wrong type, a non-object, invalid JSON, a missing `--config` file, `url` together with `stdio`, or `args` without `stdio`. A value that the flag's validation rejects reuses the flag's message plus ` (from <file>: key "failOn")` (`configNote` in `src/cli.ts`). The flag messages never contain values, so neither does this one. The JSON parser's message is never shown, because it quotes the file.
- **Secrets.** `header` and `bearer` are accepted, with one stderr warning that names the keys and points to `$MCP_REVIEW_CHECK_TOKEN`. File values go through the same `redactorFor` as the flags, since they become the same `values`. The `rerun:` line is built from the real argv, so file values never appear in it.
- **JSON outputs.** If `--save-baseline` or `--json-output` names the `--output` file while `--format` is not `json`, that is a usage error (one of the two reports would be lost). With `--format json` the same path is allowed. `--baseline b.json --save-baseline b.json` (refresh in place) is allowed: the baseline is read before connecting. Without `--output`, stderr gets one line `mcp-review-check: JSON report written to <path>`. With `--output`, the summary line gets `· JSON report written to <path>`. When a JSON file cannot be written, the primary report is still printed or written and the exit code is 2.
- **JUnit shape.**
  - Suites: one per platform in `summary.gate.platforms` (the gated platforms).
  - Test cases: every catalog rule whose `severity` has that platform, plus any other rule ID with findings on it (for example `INTERNAL`).
  - Failures: a test case has **one** `<failure>`, as the Ant JUnit schema allows, when at least one of its findings reaches `--fail-on` at the platform's own severity. The `message` attribute is the first finding (or "N findings …; first: …"). The body lists every failing finding with its evidence and fix.
  - `<system-out>`: lower findings, `known from baseline, not a failure: …` and `ignored with --ignore: …`.
  - Skipped: `<skipped message="reason"/>` for a skipped rule without findings.
  - Run errors: a failed connect or a `--max-duration` stop adds one `mcp-review-check run` test case with `<error>` per suite (with `errors` counted), so a dead server is not a green test report.
  - Properties: each suite has `<properties>` (target, score, failOn, verdict, baselined) and, with `--baseline`, the one-line `baselineLine()` tally from `src/baseline.ts` in its `<system-out>`. No new baseline helper was needed: the CLI already passes the known findings separately.
- **XML escaping.** `visibleText()` (control, format and bidi characters as `\u{..}`, as in text and markdown), then lone surrogates, U+FFFE and U+FFFF as `\u{..}` (not allowed in XML 1.0), then `& < > " '`. `time` is omitted on test cases and set to the run duration on `<testsuites>`.

## Files changed

- `src/config.ts` (new)
- `src/report/junit.ts` (new)
- `src/cli.ts`
- `README.md`
- `test/remediation-w5a-config.test.ts` (new, 22 tests)
- `test/remediation-w5a-json-output.test.ts` (new, 6 tests)
- `test/remediation-w5a-junit.test.ts` (new, 9 tests)
- `src/baseline.ts` unchanged (its `baselineLine` is reused by the JUnit reporter).

## Verification

```
npm run typecheck                         # clean
npm run build                             # clean
npx vitest run test/remediation-w5a-*.test.ts test/remediation-w4a-*.test.ts test/cli-*.test.ts \
  test/output-modes.test.ts test/e2e-stdio.test.ts test/docs.test.ts test/remediation-w3c-cli-tests.test.ts
#   11 files, 117 tests passed (W5A files alone: 3 files, 37 tests)
MCP_REVIEW_CHECK_SKIP_BUILD=1 npx vitest run test/e2e-redaction.test.ts test/redaction-tiers.test.ts test/ci-output.test.ts \
  test/remediation-wp1-cli.test.ts test/sarif.test.ts test/local-mode.test.ts test/remediation-w4d-action.test.ts
#   7 files, 159 tests passed (extra CLI-adjacent check, because the parseArgs defaults moved)
```

The whole suite was not run (D1).

## Notes for integration

- **W5D (action outputs).** `--json-output <path>` behaves as agreed: the full `--format json` document at `<path>` whatever `--format`, exit codes unchanged (exit 2 only if a file cannot be written). Fields: `summary.score`, `summary.verdicts.{claude,chatgpt}.verdict`, `summary.errors`, `summary.warnings`, `summary.failed` and, with `--baseline`, `summary.baselined`. The new findings are `findings.filter(f => !f.baselined)`; without `--baseline` they are all findings.
- **Help/README.** `test/docs.test.ts` (options in `--help` vs the README Options table) and the exit-code block test pass. The `2` line of the exit-code block is two lines, under 120 characters each.
- **Commit trailer.** The plan asks for `Co-Authored-By: Claude Fable 5.1`, but this package was implemented by Claude Opus 5.5. The commits carry `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` so that the attribution is accurate.

## Proposed CHANGELOG lines (`## [Unreleased]`)

### Added
- Config file: `--config <file>`, or `mcp-review-check.config.json` / `.mcp-review-check.json` found in `--cwd` or the working directory (`--no-config` turns discovery off). Keys are the long option names in camelCase (`failOn`, `toolArgs`, …), plus `url` or `stdio`/`args` for the server. Values are validated like the options, and an option on the command line overrides the file. Unknown keys and wrong types are usage errors (exit 2) that name the file and the key and never repeat a value. `header` and `bearer` in the file print a warning (keep tokens in `$MCP_REVIEW_CHECK_TOKEN`).
- `--json-output <file>` writes the JSON report (the `--format json` document, with `baselined` marks under `--baseline`) besides the chosen format, so one run can print text or SARIF and keep a JSON file. `--save-baseline <file>` does the same under the baseline name: write it once, then pass it to `--baseline`. A file that cannot be written is exit 2.
- `--format junit`: JUnit XML for CI test views (GitLab `reports: junit`, Jenkins, `dorny/test-reporter`). It has one test suite per gated platform and one test case per rule. A test case fails when its findings reach `--fail-on`, and skipped rules are `<skipped>`. Findings known from `--baseline` never fail. A failed connect or a `--max-duration` stop is an `<error>`.

### Changed
- Exit code 2 also covers a wrong config file and a `--json-output` or `--save-baseline` file that cannot be written.

## Proposed `docs/design/spec.md` text

**§3.1 Usage, option table**: change the `--format` row to `text\|json\|markdown\|sarif\|junit`, and add rows:

| Option | Default | Notes |
|---|---|---|
| `--json-output <file>` | — | Also writes the JSON report (§5.3 json, with `baselined` marks under `--baseline`) to the file, whatever `--format`, from the same redacted report. A write failure is exit 2; the primary report is still emitted. Naming the `--output` file with a non-json `--format` is a usage error. |
| `--save-baseline <file>` | — | The same document under the baseline name (§3.5). |
| `--config <file>`, `--no-config` | discovery | §3.7. |

**§3.2 Exit codes, row 2**: "Usage or config error (including a `--baseline` file that is missing or not a JSON report of mcp-review-check, and a wrong config file, §3.7), or `--output`, `--json-output` or `--save-baseline` could not be written".

**§3.5 Baseline, last bullet**, replace it with: "`--save-baseline <file>` (0.3.0) writes the JSON report besides the chosen format; the loop is a first run with `--fail-on never --save-baseline baseline.json`, then `--baseline baseline.json`. Not yet: tool-definition drift and `--diff-only`."

**New §3.7 Config file** (`src/config.ts`, 0.3.0):
- **Location.** `--config <file>`. Otherwise the first of `mcp-review-check.config.json` and `.mcp-review-check.json` that exists in `--cwd`, or else the process working directory. `--no-config` disables discovery, and `--config` together with `--no-config` is a usage error. The file is read for a check only, not for `--help`, `--version`, `--list-rules` or `explain`.
- **Format.**
  - The file is a JSON object (UTF-8 with or without BOM, or UTF-16LE with BOM). Keys are the camelCase long option names: `target`, `format`, `output`, `jsonOutput`, `saveBaseline`, `sarifLocation`, `timeout`, `maxDuration`, `failOn`, `failOnSpec`, `failOnIncomplete`, `baseline`, `local`, `noLocal`, `active`, `activeAuth`, `toolArgs`, `ignore`, `header`, `bearer`, `env`, `cwd`, `noColor`, `verbose`, `quiet`, `checklist`.
  - The server is `url`, or `stdio`: a string split like `--stdio "<command>"`, or `stdio` + `args` (or a `stdio` array), kept verbatim.
  - Switches take booleans (`false` counts as absent). `timeout`/`maxDuration` take a number or a string. `ignore` takes a string or an array. `header` and `env` take an array of `"Name: value"` / `"K=V"` strings or an object.
  - Path keys are relative to the file's directory.
- **Semantics.**
  - Each value becomes the string or list the flag would give and then goes through the flag's validation.
  - A flag on the command line overrides the key, and a list flag replaces the file's list.
  - The file's server is used only when the command line names none.
  - parseArgs has no defaults for `target`, `format`, `timeout` and `fail-on`; the defaults are applied after the merge.
- **Errors** (exit 2) name the file and the key and never a value:
  - an unknown key, with "did you mean" for a kebab-case spelling;
  - a wrong type, a non-object, invalid JSON or a missing `--config` file;
  - `url` with `stdio`, or `args` without `stdio`.
  
  A value rejected by the flag's validation reuses the flag's message plus `(from <file>: key "<key>")`.
- **Secrets.** `header` and `bearer` keys print a warning recommending `$MCP_REVIEW_CHECK_TOKEN`. File values are redacted like the flags (§4.5). The markdown `rerun:` line shows the command line only.

**§5.3 Other formats, new bullet after sarif**:
- **junit:** JUnit XML (`src/report/junit.ts`).
  - Structure: a `<testsuites name="mcp-review-check">` root with `tests`, `failures`, `errors`, `skipped` (the sums of its suites) and `time` (the run duration, in seconds). It holds one `<testsuite>` per gated platform (`summary.gate.platforms`: the `--target` directories, plus `spec` with `--fail-on-spec`) with the same counts and `<properties>` (target, score, failOn, verdict, baselined).
  - Test cases: one `<testcase classname="<platform>" name="<RULE-ID> <title>">` per catalog rule of that platform, plus any other rule ID with findings there (`INTERNAL`).
  - Failures: a test case with findings that reach `--fail-on` at the platform's severity has one `<failure message="…" type="<severity>">` listing each such finding with its evidence and fix.
  - `<system-out>`: lower findings, findings known from `--baseline` (never failures) and ignored findings.
  - Skipped: a skipped rule is `<skipped message="<reason>"/>`.
  - Run errors: a failed connect or a `--max-duration` stop adds one `<error>` test case per suite.
  - Escaping: text passes through `visibleText` (control and format characters as `\u{..}`), then lone surrogates, U+FFFE and U+FFFF are shown as `\u{..}`, then `& < > " '` are escaped.
  - Manual items are excluded.
  - On `--list-rules` the format prints the text catalog with a warning, as sarif does.
- **json, addition:** `--json-output` and `--save-baseline` write this document besides any `--format`.
