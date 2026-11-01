# W3C-cli-tests: remediation report (wave 3)

Branch `worktree-wf_a7e88476-bcc-3`, owned files `src/cli.ts`, `src/explain.ts`, `test/**` (new files and `test/remediation-wp8-tools-schema-rt.test.ts`). Base: `main` with waves 1 and 2 merged (f0f06ea).

Checks run: `npm ci --ignore-scripts`, `npm run typecheck`, `npm run build` (green before and after); `npx vitest run` on `test/remediation-w3c-cli-tests.test.ts`, the new `test/unit-*.test.ts` files, `test/remediation-wp4-protocol.test.ts`, `test/remediation-wp8-tools-schema-rt.test.ts`, `test/remediation-wp1-cli.test.ts`, `test/e2e-redaction.test.ts`, `test/redact.test.ts`, `test/docs.test.ts`, `test/catalog-stale.test.ts`, `test/ci-output.test.ts`, `test/cli-rules.test.ts`, `test/compat.test.ts` (all green). The full suite was not run (D1).

## Done

| Id | Commit | What changed |
|---|---|---|
| F135 (`--verbose` stderr) | 5f42edf | The `[http]` trace lines and each line of the `[stdio stderr]` tail go through `visibleText()`: ESC, CR, bidi overrides and other control or format characters print as `\u{..}`; the tail is split on CRLF or LF, so a Windows server's line ends do not show as `\u{D}`. Redaction (`scrub`) still runs over the whole stderr afterwards. New fixture `test/fixtures/w3c-noisy-stderr.mjs`. |
| R006, R019 (`--help`) | 17da702 | `--help` has an `Exit codes:` block with one line per code, as the README table: 0, 1, 2, 3 (could not connect, `--max-duration` stop, or an internal error with `fatal:` and a stack trace), 128+N (130 SIGINT, 143 SIGTERM, 131 SIGQUIT, 129 SIGHUP; a stdio server is ended first, no report). Every line of the block is at most 120 columns. |
| SECRET-FIXTURE | 1d6a829 | Token fixtures that matched provider formats without the repo's `SYNTH` mark: `ghp_` (36 chars) in `test/remediation-wp8-tools-schema-rt.test.ts` and, found by the same grep, `ghp_` (33 chars) in `test/remediation-wp4-protocol.test.ts`, plus `sk_live_` and `xoxb-` in the WP8 file. Each now carries `SYNTH`, same length for the `ghp_` ones, and still matches `KNOWN_TOKEN` (the tests that assert detection and redaction pass). grep over every `test/remediation-*.test.ts` for `gh[pousr]_`, `github_pat_`, `glpat-`, `xox?-`, `[sr]k_live_`, `AKIA`, `AIza`, `npm_`, `hf_` finds no unmarked token now. |
| F156 (rest) | 4246c64 | In-process unit tests, no network or child process: `test/unit-legacy.test.ts` (listAll pagination, cursor echo, error keeps pages, repeated cursor, page cap; rpc error/timeout/transport error), `test/unit-manual.test.ts` (ids and sources, platform and feature filters, OAuth detection, MAN-031 URL without credentials), `test/unit-wire.test.ts` (probe selection for legacy, modern and dual eras over fake clients; `sdkSessionGet`), `test/unit-catalog-lexicon.test.ts` (catalog age, stale threshold and warning text; verb set invariants), `test/unit-rules-util.test.ts` (access guards and accessors, `uiUriOf` precedence, `hasUi`, `hostOf`, `listPreview`; `decodeItem`, `uiResources` joins and uri-mismatch fallback, `cspOf` merge, malformed and near-miss fields). |

## Deferred

| Id | Reason |
|---|---|
| F156 (thresholds) | Coverage thresholds and a CI coverage artifact need a full-suite run to calibrate (D1 forbids it here) and touch `vitest.config.ts` / `.github/**` (not owned). The `[http]` part of `wire.ts` (origin, challenge, GET reuse) needs a tracer stub or a local server and is covered by the e2e HTTP tests. |

## Existing tests changed

- `test/remediation-wp8-tools-schema-rt.test.ts`, `test/remediation-wp4-protocol.test.ts`: fixture strings only (SYNTH mark), no expectation changed.

## CHANGELOG lines

- Fixed: `--verbose` prints control and format characters in the `[http]` trace and the `[stdio stderr]` tail as `\u{..}`, so a server cannot move the cursor, recolour or overwrite lines in a terminal or CI log (F135).
- Changed: `--help` lists the exit codes one per line, including exit 3 for an internal error and 128+N when ended by a signal (R006, R019).
