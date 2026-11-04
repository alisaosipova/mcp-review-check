# P4 report: protocol, server and auth rules, engine (1.0.1)

Base: `origin/main` 5c521cb. Files changed: `src/rules/engine.ts`, `src/rules/spec.ts`, `src/rules/auth.ts`,
`src/rules/server.ts`, new `test/r3-p4-protocol-engine.test.ts`; existing tests adjusted where a fix changes the
behaviour they assert (listed under A04-01). `src/rules/runtime.ts` was not touched (no P4 item lands there).

Patch-release check: no fix adds a finding or raises a severity. Each one removes a duplicate finding, lowers a
severity, turns a pass into a skip, or changes fix text and docs links.

## Fixed

### A04-01 SRV-013 and SPEC-022 report the same server/discover serverInfo
- `src/rules/spec.ts` SPEC-022: when `discoverRaw` is an object, SPEC-022 no longer checks the `server/discover`
  result (from `discoverRaw` or from `modernResults`). SRV-013 owns that result and keeps its 1.0.0 levels (missing:
  warning, malformed: error). The rationale now says so. SPEC-022 still checks every other 2026-07-28 result at info.
- I used the reviewer's second option (SPEC-022 skips server/discover). The first option would put the
  Implementation-shape check in SPEC-022 at error, which raises SPEC-022's severity and so cannot ship in a patch.
- Tests: `A04-01: one finding for the server/discover serverInfo, from SRV-013` (3 cases: missing, malformed, other
  results still reported).
- Existing tests changed because they asserted the duplicate:
  - `test/remediation-w6c-spec-rules.test.ts`: "lists the methods whose results lack it" now expects only
    `tools/list`. "reports a malformed value separately" now uses a malformed `tools/list` `_meta`. The dual-era case is
    renamed "leaves the server/discover result to SRV-013 ..." and expects `[]`.
  - `test/rules/spec.test.ts` SPEC-022 match regex: `lack` became `lacks?`, because one method now gives the singular
    message.

### A04-02 SPEC-024 and SRV-018 pass after a --max-duration or budget stop
- `src/rules/engine.ts` `GROWING_TRANSPORT`: added `notifications: RUN_WIDE` and `stdio: RUN_WIDE`. In a stopped run
  where these rules find nothing, they are now skipped as "stopped by --max-duration" (or "snapshot budget exhausted")
  instead of counted as passed. Findings from data seen before the stop are kept.
- Tests: `A04-02: run-wide notifications and stdio output are partial after a stop` (3 cases).

### A04-03 AUTH-021 error from a body regex
- `src/rules/auth.ts` AUTH-021: when the token response carries one of `invalid_client`, `invalid_grant`,
  `unauthorized_client` or `invalid_scope` (from `json.error` or `oauthError`), the server must have read the form, so
  the free-text regex is skipped for it. `invalid_request` and `unsupported_grant_type` are excluded, because a server
  that saw no grant_type also answers with them. The regex branch is now a warning with the message `token endpoint may
  not parse a form-encoded body (<status>): its error reads like a parse failure`. 415 stays an error.
- Tests: `A04-03: AUTH-021 does not read a well-formed RFC 6749 error as a form-parse failure` (2 cases, covering the
  reviewer's repro).

### A10-05 rules that need a connection pass in JUnit after connect-failed
- `src/rules/engine.ts` `runRules`: in a run with no working transport (`snap.fatal` or `coverage.toolLevel ===
  'connect-failed'`), a rule that finds nothing is skipped with `could not connect` (new export `CONNECT_REASON`, which
  `authReason` also uses) instead of counted as run. The exceptions are the rules that judge only the entered URL or its
  DNS: SRV-001, SRV-004, SRV-005, SRV-017, AUTH-001, plus SRV-003, which reports the failure itself (`URL_ONLY`). Every
  finding is kept, so findings do not change.
- I chose this over a need check in `unmetNeed` because that would have skipped SRV-004's NXDOMAIN finding. Here only
  empty results change.
- Effect on `http://127.0.0.1:59999/mcp`: `34 rules run · 145 skipped` became `6 rules run · 173 skipped (104 could not
  connect; ...)`. Passed JUnit testcases: SRV-006..010, SRV-011, SRV-012, SRV-014..016, SPEC-020, AUTH-003 and POL-005
  are gone. AUTH-001, SRV-003, SRV-005 and SRV-017 remain.
- Tests: `A10-05: rules that need the server are skipped after connect-failed` (3 cases).

### A10-06 stdio start failures without a diagnosis
- `src/rules/server.ts`: new `stdioStartFix(snap)` builds the SRV-003 stdio fix from the cause in `snap.fatal`:
  - `spawn X ENOENT` gives `Command "X" was not found: check PATH or use an absolute path (on Windows, npx is npx.cmd).`
  - `EACCES` gives `Command "X" is not executable ...`.
  - `Connection closed` gives `The server process exited or closed stdout before it answered initialize: run the command
    by hand to see why it stops.`
  - The sentence "The stderr cause is shown above; --verbose prints all of stderr." is added only when
    `transport.stdio.stderrTail` is non-empty.
  - The fix text quotes the command from `snap.fatal`. That text was already printed in the message, and the report's
    `redactDeep` masks it like the rest of the report (tested).
- Tests: `A10-06: stdio start failures get a diagnosis, and the stderr pointer only when there is stderr` (4 cases,
  including a redaction case with a runtime-assembled `SYNTH` token).
- The existing `test/e2e-stdio.test.ts` assertion on the old generic fix text was updated.
- Partly in another file: the exit code and signal are not in the snapshot. See integrator notes.

### A10-07 SRV-003 connect failure carries SSE metadata
- `src/rules/server.ts` SRV-003: the connect-failure findings now carry their own `docs`: the Streamable HTTP
  transport page and the lifecycle page for HTTP, the 2025-11-25 transports page and the lifecycle page for stdio. They
  no longer link the directory-policy page. The SSE finding keeps the rule's sources.
- The rule rationale, which `explain`, `--list-rules --verbose`, SARIF and markdown "Why these rules" show, now adds:
  "When no transport works at all (the server could not be reached, did not start or did not complete a handshake),
  this rule reports that as a spec error, because nothing else could be checked."
- I did not add a separate rule ID (such as SRV-000), because a patch never adds a rule.
- Tests: `A10-07: the connect-failure finding of SRV-003 carries transport docs, not the directory-policy page` (2
  cases).
- Partly in another file: `gate.notGated` on a connect-failed run. See integrator notes.

## Not fixed

None. Integrator notes 1 and 2 (the A10-06 and A10-07 parts outside P4's files) were done in the review fixes below.

## Review fixes

The review found that A10-07 was only partly fixed and A10-06 only partly fixed. Both remaining parts are done now.
They touch files outside P4's list, so the integrator should check them: `src/report/index.ts`, `src/explain.ts`,
`src/rules/types.ts` and `src/connect.ts`.

### A10-07: `gate.notGated` and `explain` on a connect-failed run
- `src/report/index.ts` `buildReport`: when `snap.fatal` is set, `summary.gate.notGated` is `null`. The run already
  fails with exit 3, so "add --fail-on-spec to fail on spec findings" was wrong advice. The text Result line already
  read `FAIL (could not connect)` and did not change. `gate()` in `score.ts` is unchanged, because it does not know
  about `fatal`.
- `src/rules/types.ts`: `RuleMeta` has a new optional field, `severityNote`. SRV-003 sets it to "spec=error when no
  transport works (connect failure, exit 3); the directory verdicts then read INCOMPLETE." `explain SRV-003` prints it
  on the line after `Severity`. `--list-rules --format json` now shows the field for SRV-003. The new field only adds
  data and no existing field changed.
- Repro after the fix: `node dist/cli.js http://127.0.0.1:59999/mcp --format json | jq .summary.gate` gives
  `{"platforms":["claude","chatgpt"],"reason":null,"notGated":null}`, with exit 3 and `summary.failed` true.
- Tests: `A10-07: a connect-failed run gives no --fail-on-spec advice, and explain names the spec-error case` (3 cases).
  One case checks that a run that connected still gets the not-gated note.

### A10-06: exit code or signal of a stdio server that ended before initialize
- `src/connect.ts` `connectStdio`: keeps the spawned child, because the transport forgets `_process` on close. On a
  failed handshake it reads `exitCode` and `signalCode` before `client.close()`. If the process ended, it adds
  ` (the server process exited with code N before answering initialize)` (or `with signal S`) to the error. That text
  then reaches `snap.fatal`, the SRV-003 message and the "Could not connect" line. The new `exitNote()` builds the
  text. There is no note in these cases: a process that is still running (a timeout), and a spawn that failed (ENOENT
  leaves a negative errno in `exitCode`). The note has only a number or a signal name, so it holds nothing that needs
  redaction.
- `stdioStartFix` needed no change: the "Connection closed" match still applies.
- Checked by hand: `--stdio 'node -e "process.exit(7)"'` gives "... Connection closed (the server process exited with
  code 7 before answering initialize)". A self-SIGTERM gives "with signal SIGTERM". `nonexistent-zz` still reads
  `spawn nonexistent-zz ENOENT` with no note.
- Tests: `A10-06: a stdio server that ended before initialize reports its exit code or signal` (unit, 5 cases), plus
  one assertion in `test/e2e-stdio.test.ts` (`exited with code 1`).

## Integrator notes

1. A10-06 (`src/connect.ts`, about line 714, `buildStdio` catch): add the child's exit code and signal when the process
   ended before the handshake, for example `the server process exited with code N (signal S) before answering
   initialize`. The snapshot has no field for it today. `GroupStdioTransport` / `_process` has `exitCode` and
   `signalCode`. Once that text is in `snap.fatal`, `stdioStartFix` needs no change.
2. A10-07 (`src/report/score.ts:73`): do not build `gate.notGated` ("add --fail-on-spec ...") when `snap.fatal` is set.
   The run already fails with exit 3. `explain SRV-003` (`src/explain.ts`) could also print a line saying a connect
   failure is reported as a spec error. The rationale now says this, so it is optional.
3. A10-05 (`src/report/junit.ts`): SRV-003 still shows as a passed testcase in the claude and chatgpt suites on a
   connect-failed run, because its finding is spec-only. Consider emitting it as skipped (or omitting it) in the
   directory suites when `snap.fatal` is set. The run-level error testcase is already there.
4. `RULES.md` / `docs/design/spec.md`: SRV-003's row lists only the directory-policy link. If the catalog doc lists
   rationale or docs, add the connect-failure sentence. No doc test failed.

## Proposed CHANGELOG lines (1.0.1)

### Fixed
- SPEC-022 no longer repeats SRV-013's finding for a missing or malformed `_meta["io.modelcontextprotocol/serverInfo"]`
  on the server/discover result. SRV-013 reports it once, at its existing level (review A04-01).
- After a `--max-duration` stop or an exhausted snapshot budget, SPEC-024 and SRV-018 are skipped instead of passed
  when they saw no notifications or stdout output, because those are collected over the whole run (review A04-02).
- AUTH-021 no longer reports "did not parse a form-encoded body" for a token endpoint that answered with an RFC 6749
  error that needs the parsed form (`invalid_client`, `invalid_grant`, `unauthorized_client`, `invalid_scope`), even
  when its description mentions `grant_type` (review A04-03).
- When the server could not be reached or the stdio server did not start, rules that need the server's answers are
  skipped as "could not connect" instead of counted as run and shown as passed in JUnit. Only the URL and DNS rules
  (SRV-001, SRV-004, SRV-005, SRV-017, AUTH-001) and SRV-003 still run (review A10-05).

### Changed
- AUTH-021's body-text match ("unsupported content type", "could not parse", "missing grant_type") is a heuristic and
  is now a warning. A 415 answer stays an error (review A04-03).
- SRV-003's fix for a stdio server that did not start names the cause: a command not found on PATH (ENOENT), not
  executable (EACCES), or a process that closed stdout before initialize. It points to stderr only when the server wrote
  to stderr (review A10-06).
- SRV-003's connect-failure finding links the transport and lifecycle pages instead of the directory policy. The
  rule's rationale (shown by `explain`) now covers the connect-failure case (review A10-07).

### Review fixes (additional CHANGELOG lines)
- A stdio server that exits before it answers initialize is reported with its exit code or signal ("the server process
  exited with code 1 before answering initialize") (review A10-06).
- On a run that could not connect, JSON `summary.gate.notGated` is `null` instead of advising `--fail-on-spec`, because
  the run already exits 3. `explain SRV-003` says that a connect failure is reported as a spec error (review A10-07).

## Proposed spec paragraphs (docs/design/spec.md)

- Engine, skip rules: "In a run without a working transport (`fatal`, `coverage.toolLevel` connect-failed), a rule
  that finds nothing is skipped with the reason `could not connect`. The exceptions are the rules that judge only the
  entered URL or its DNS (SRV-001, SRV-004, SRV-005, SRV-017, AUTH-001) and SRV-003, which reports the failure.
  Findings are never dropped."
- Engine, run-wide data: "`transport.notifications` and `transport.stdio` grow over the whole run, like
  `observedErrors` and `modernResults`. After a stop, a rule that reads them and finds nothing is skipped, not passed."
- SPEC-022: "The server/discover result is SRV-013's. SPEC-022 checks the other 2026-07-28 results."
- Report, gate: "`summary.gate.notGated` is null when the run could not connect (`fatal`): that run exits 3 anyway."
- Connect, stdio: "When the stdio server exits before it answers initialize, the connect error names its exit code or
  signal."

## Tests run

- `npm run typecheck`: OK. `npm run build`: OK.
- Final run of the new test and the rule, engine, docs and catalog test files: 16 files, 312 tests passed
  (`test/r3-p4-protocol-engine.test.ts` has 17 tests: A04-02 3, A10-05 3, A04-03 2, A04-01 3, A10-06 4, A10-07 2).
- Earlier runs on the same changes, each green:
  - engine and report files: 17 files, 228 tests (engine, incomplete, w6g, w6d, w4a-exit-codes, sarif, report,
    root-causes, cta, aggregate-captures, w5c, wp9, w4c, wp2, redact, p6-listing, auth-probe).
  - `max-duration`, `w5a-junit`, `registry-scripts`: 3 files, 48 tests. One `e2e-stdio` case hit a 60 s timeout under
    load average 75 and passed when run alone.
  - e2e and CLI: 8 files, 134 tests (e2e-stdio, e2e-http, w4a-exit-codes, real-servers, output-modes, ci-output,
    w3c-cli, wp1-cli). 133 passed; the 1 failure asserted the old generic stdio fix text. That test was updated
    (`test/e2e-stdio.test.ts` "exit 3 when the stdio server cannot start": its regex changed from `/stdin\/stdout/` to
    the diagnosed text) and both cannot-start cases pass.
- I did not run the whole vitest suite, per the task rules.
