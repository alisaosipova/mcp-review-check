# WP9-report-redact: remediation report

Branch `worktree-wf_365c0c99-4d0-9`, owned files `src/report/*.ts`, `src/redact.ts`, `src/rules/{engine,types}.ts`. Regression tests: `test/remediation-wp9-report-redact.test.ts`.

Checks run: `npm run typecheck`, `npm run build`, `npx vitest run` on `test/remediation-wp9-report-redact.test.ts`, `test/report.test.ts`, `test/sarif.test.ts`, `test/redact.test.ts`, `test/redaction-tiers.test.ts`, `test/e2e-redaction.test.ts`, `test/engine.test.ts`, `test/root-causes.test.ts`, `test/cta.test.ts`, `test/ci-output.test.ts`, `test/output-modes.test.ts`, `test/incomplete.test.ts`, `test/local-mode.test.ts`, `test/stderr-flush.test.ts`, `test/compat.test.ts`, `test/cli-rules.test.ts`: all green. The full suite was not run (D1).

## Done

| Id | Commit | What changed |
|---|---|---|
| F115 (medium) | da9e0e2 | `visibleText()` in `src/report/index.ts` shows every control or format character but a tab (ESC, CR, LF, BEL, C1, bidi, zero-width, U+2028/2029) as `\u{..}`; `renderText` passes every line through it before adding its own ANSI colours, so server text cannot recolour, erase or add an OSC 8 link. FAIL in the result line is coloured after the connect-failure cause is made visible. |
| F135 (medium) | da9e0e2 | Same fix; LF in a server string can no longer start a line, and a line that would start with `::` after its indent (a fix snippet for a tool named `::warning::x`) gets its first `:` as `\u{3A}`. The `--verbose` `[stdio stderr]` part is in `src/cli.ts` (not owned): see deferred. |
| F147 | da9e0e2 | Markdown `cell()`, `text()` and `code()` show hidden characters as `\u{..}` (done before the zero-width spaces markdown adds itself, so those stay). |
| F127 | da9e0e2 | Markdown `text()` escapes `*`, `_`, `~` and `$` (emphasis, strikethrough, math). |
| F116 (medium) | 738c9c5 | A Cookie header (from `--header`, argv `--header 'Cookie: …'`) adds each `name=value` pair and the value alone when the cookie name is secret-like or the value looks like a token; `theme=dark` does not make `dark` a secret. |
| F117 | 738c9c5 | A `Basic` credential (header, argv, env) adds the decoded `user:pass` and the password; a token that is not base64 of `user:pass` text adds nothing. |
| F118 | 404714f | An `--env` value under a plain name that is a common setting (production, development, staging, test, local, log levels, version numbers like `1.2.3`, `v2.0.1-rc.1`) is not masked in either tier; under a secret name it still is. |
| F124 | 7c90ebe | A rule outside `--target` that throws now gives an INTERNAL finding (platform spec, always active). |
| F123 | 7c90ebe | SARIF `tool.driver.rules` gets an `INTERNAL` entry when there are INTERNAL results (none otherwise, so the rule count of a clean run is unchanged). |
| R023 | 7c90ebe | `subjectOf()` names a tool or resource called `""` as `(empty name)`; text, markdown, GitHub annotations and the SARIF message use it. |
| F134 | 9c5d749 | `fixSnippets` picks tools from TOOL-006/011/012 findings plus the snapshot's missing title, not the exact `no title` message. |
| F129 | 304d515 | JSON `summary.rootCauses` (additive; `schemaVersion` stays 1). |
| F128 | 304d515 | JSON `server.argv` for stdio targets (additive); `server.command` stays the display string. |
| F125 | 8db99b2 | `sortFindings` compares by UTF-16 code unit, not `localeCompare`. |
| F133 | 8db99b2 | The `legacy` need is met by the era alone (a stdio connect is an initialize handshake, so its era is `legacy`). |
| R022 | f5018c6 | `failed()` defaults to `gatedPlatforms('all')` (claude, chatgpt), as the CLI without `--fail-on-spec`. |
| F131 (part) | 2da1c4b | `appendStepSummary` cuts the markdown at a line end to what is left of the step's 1 MiB (the file size already used counts) and adds a note; a full file gets nothing and a stderr warning. |

## Deferred

| Id | Reason |
|---|---|
| F122 | Design decision: `docs/design/spec.md` §5.3 maps severity to SARIF level directly, and the arbiter rated it a format inconsistency, not a contract break. Taking the level from the gated platforms would make a spec-only error a `note` without `--fail-on-spec`. Needs a maintainer choice (gated level, or a `--sarif-level gated\|max` option) and a spec.md change (WP10). |
| F132 | needs `src/rules/util/net.ts` (`displayUrl`, `isKnownToken`), and it goes against the documented "no entropy guess" design: masking hex/base64 path segments and query values under neutral names needs a heuristic plus an opt-out flag (`src/cli.ts`). feature: heuristic URL redaction with `--no-redact-heuristic`. |
| F131 (annotation cap) | Capping or grouping annotations at about 10 per type changes the documented one-annotation-per-finding contract (README) and `test/stderr-flush.test.ts` relies on more than 1000 annotations. Needs a maintainer decision. |
| F135 (`--verbose` stderr) | needs `src/cli.ts`: the `[stdio stderr]` and `[http]` trace in `--verbose` is printed raw there. `visibleText()` is exported from `src/report/index.ts` for that fix. |

## Existing tests changed

- `test/report.test.ts`: the markdown @-mention test now expects `\_` around `_@&#8203;octocat-em_` (F127 escapes `_`).
- `test/redact.test.ts`: two `redactDeep` vocabulary tests gave the word `error` as `LOG_LEVEL=error`; a log level under a plain name is no longer a secret (F118), so they now give it as `API_KEY=error`. The tests still check what they were written for (the report's own vocabulary is kept).

## Notes for WP10 (docs)

- README "Redaction": add the common `--env` settings that are not masked (F118), Cookie pairs and the decoded Basic password (F116, F117).
- README JSON shape: `summary.rootCauses`, `server.argv` (F129, F128).
- README/spec: server text in text and markdown reports shows control and format characters as `\u{..}` (F115, F135, F147).

## CHANGELOG lines

### Fixed

- Text and markdown reports show control, bidi and zero-width characters from the server (ESC, CR, LF, BEL, U+202E, …) as `\u{..}`, so a server name, tool name or message can no longer recolour or erase terminal output, add a hyperlink, reorder text, or start a line the GitHub runner reads as a workflow command.
- Markdown reports escape `*`, `_`, `~` and `$` in server text, so a server name or message cannot render as bold, italic, struck-through or math.
- A Cookie header is redacted pair by pair and a session-like cookie value on its own, and a `Basic` credential also by its decoded `user:pass` and password, so a server that echoes one session cookie or the plain password no longer leaks it into the report.
- A rule outside `--target` that throws is reported as an INTERNAL finding instead of disappearing, and SARIF has a rule entry for INTERNAL results.
- A tool or resource named `""` is shown as `(empty name)` in every format instead of an empty subject.
- Findings are sorted by code unit, so JSON and SARIF order no longer depends on the locale or ICU build of Node.
- Fix snippets no longer depend on the exact wording of the TOOL-006 message.

### Changed

- Common settings given under a plain `--env` name (`production`, `debug`, log levels, version numbers) are no longer masked in the report; under a secret-looking name they still are.
- `failed()` defaults to the CLI's gate (claude and chatgpt; spec only when passed).
- The markdown appended to `$GITHUB_STEP_SUMMARY` is cut at a line end to fit GitHub's 1 MiB step limit, with a note, instead of being dropped by GitHub.

### Added

- JSON reports gain `summary.rootCauses` (the basis of `summary.score`) and, for stdio targets, `server.argv` (each argument whole).
