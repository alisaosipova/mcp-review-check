# WP2-connect remediation report

Package: `src/connect.ts`, `src/limits.ts`, `src/snapshot.ts`, `src/protocol/recording.ts`, `src/diagnose.ts`.
Branch: `worktree-wf_365c0c99-4d0-2`. New tests: `test/remediation-wp2-connect.test.ts` (29 tests) with the fixture `test/fixtures/wp2-stdio-server.mjs`.

Verification: `npm run typecheck`, `npm run build`, `npx vitest run test/remediation-wp2-connect.test.ts`, and the existing subsystem files `test/e2e-stdio`, `e2e-http`, `max-duration`, `limits`, `diagnostics`, `auth-probe`, `incomplete`, `e2e-redaction`, `redaction-tiers`, `stderr-flush`, `process-tree`, `windows`, `lifecycle`, `client-caps`, `ci-output`, `report`, `root-causes`, `live` and `test/rules/*`. All green. The full suite was not run (D1).

## Done

| ID | Commit | What changed |
|---|---|---|
| R046 | d65a388 | `RecordingTransport` keeps the first 20 transport error messages plus a count, not every `Error` with its stack: 1 M non-JSON stdout lines no longer exhaust the heap. |
| F141 | d65a388 | The stdout tap keeps the first 50 non-JSON-RPC lines (masked, then cut to 1 KB) plus `nonJsonTotal`; a long line keeps only its head; chunks are joined once per line (no quadratic `Buffer.concat`). |
| F012 | d65a388 | A line that does not start with `{` or `[` is foreign output without `JSON.parse`; `nonJson` is bounded (see F141). |
| F033 | d65a388 | `pending` drops a request when its response arrives; `transportErrors` is bounded and now read (R047 overflow). |
| C003 | d65a388 | Any stdout line that is not a JSON-RPC 2.0 message (or batch) counts for SRV-018, so pino/winston/bunyan JSON logs are reported. |
| R002 | 0243162 | The main stdio connection publishes its stderr and stdout before the handshake; a `--max-duration` stop during connect puts the stderr summary (and first stdout line) into the fatal, and `--verbose` prints `[stdio stderr]`. |
| R048 | 0243162 | A failed stdio handshake keeps the stdout lines in `transport.stdio` (SRV-018 runs) and the fatal names the first non-JSON-RPC stdout line. |
| C-imp-1 | 0243162 | Same fix; when stdout announces `listening on http://…`, the fatal suggests checking that URL over HTTP instead of `--stdio`. |
| R007 | b6cc225 | A failed HTTP+SSE fallback keeps its own status and error: a 401 on `GET /sse` sets `auth-required` and runs the auth probe; an SSE handshake error (endpoint on another origin) is the diagnosis instead of "not an MCP endpoint, try /mcp"; `transport.kind` is `sse`. |
| F006 | a22ccb4 | A 401 to credentials sent with `--header` (Authorization, API key, token, cookie headers) gives `token-rejected` / "supplied credentials rejected (401)" instead of "server requires OAuth". |
| R044 | a22ccb4 | The auth probe parses the preflight only when it started the probe (401, or 403 with `WWW-Authenticate`); otherwise the latest 401 with a challenge, so PRM from the header is found. |
| R045 | a22ccb4 | A 401 on `tools/list` after a public initialize/discover is an auth requirement: coverage `auth-required`/`token-rejected`, auth probe run, listing cleared, wire probes skipped. |
| C-imp-2 | ed451a4 | A 403 handshake failure names a Cloudflare challenge / WAF block (Cloudflare, Akamai, AWS WAF, Imperva) or an HTML page title, with an allowlist hint. |
| C001 | 5805c2f | A transport failure on `tools/list` (Connection closed, Not connected, timeout, network) marks coverage `list-failed` even without a declared tools capability: no more 100/100 PASS for a server that dies after initialize. |
| R047 | 8ed91a3 (and d65a388) | stdio accepts messages up to 64 MB (`maxBufferSize` = `FULL_READ_CAP`, as HTTP); an overflow is named on the listings, UI reads and coverage reason that fail with "Connection closed"; stdout is not re-parsed after the overflow. |
| F017 | 8ed91a3 | `GroupStdioTransport` checks the SDK's private stdio state (`sdkStdioShape`) and falls back to the SDK's own `start()` if it changed; a test pins the shape for SDK bumps. |
| R001 | b458379 | `active tool calls` is a phase only with `--active`; after the last check the phase is `closing`, and a deadline there returns the finished snapshot (not INCOMPLETE). Same for the HTTP close. |
| R003 | b458379 | Partial: a stopped snapshot now keeps `observedErrors` and `modernResults` collected so far (SPEC-016, SPEC-012/013 no longer run on empty data). The rest is deferred (see below). |
| R012 | b458379 | Every SDK Streamable HTTP connection (main, fresh, text-only, clientInfo variants) ends its session with `DELETE` before closing; these DELETEs stay in the trace but out of `snap.transport.exchanges`. |
| R024 | b64bc62 | `pattern`, `$ref`, `$id`, `$schema`, `format` and other schema syntax are capped at `ID_CAP` (1 MB), not 16 KB: a long valid pattern no longer gets TOOL-017 "does not compile". |
| R025 | b64bc62 | `name`, `uri`, `uriTemplate` are capped at `ID_CAP`: no false TOOL-003 duplicates, TOOL-001/002 report the real length. |
| R026 | b64bc62 | `resourceUri` / `outputTemplate` / `uri` stay intact (and `resourceReads` keys are cut the same way over `ID_CAP`); `toolsWithoutUi` is capped by the same rules, so APPS-001/003/007/019 match. |
| R028 | b64bc62 | Object keys over `ID_CAP` (property names, `patternProperties` regexes) are cut (collision-safe) and reported. |
| F013 | b64bc62 | `listMeta[*].rawPages`, `toolsWithoutUi`, `active.calls[].result` and `transport.modernResults` are capped too. |
| F139 | b64bc62 | At most 50 UI resources are read per run; the rest is reported in `limits.truncated` as a count (`unit: 'items'`, "80 items, cap 50"). |

## Deferred

| ID | Reason |
|---|---|
| R027 | needs src/rules/apps.ts: APPS-014 must not say "never calls connect()" when `snap.limits.truncated` lists that UI resource (the cap itself is correct). |
| F146 | feature: one byte budget for the whole snapshot enforced while reading (readBody, listAll, the SDK reader) with an early stop; needs src/protocol/trace.ts, src/protocol/legacy.ts. Partly covered by F013 and F139. |
| R003 (rest) | needs src/probe/active.ts, src/probe/wire.ts: `runActive` / `runWireProbes` must publish their partial results (an accumulator from `Progress`) so a stop keeps finished tool calls and probes; and src/rules/engine.ts: rules whose data come from the phase that was stopped must be skipped as "stopped by --max-duration". |
| C-imp-2 (rest) | needs src/rules/server.ts: SRV-009 should report one finding per exchange instead of three for one Cloudflare page. |
| R012 (rest) | needs src/probe/network.ts, src/probe/wire.ts: the raw `initialize` preflight and origin probes also open sessions; they should send `DELETE` with the `Mcp-Session-Id` they got. |
| C003 (follow-up) | needs src/rules/server.ts: SRV-018 should count `transport.stdio.nonJsonTotal` (the stored lines are now capped at 50) and say "non-JSON-RPC line(s)", since JSON log lines now count too. |

## Existing tests changed

None. All existing expectations still hold.

## Notes for the merge

- `snapshot.ts`: `transport.stdio.nonJsonTotal?: number` and `Limits.truncated[].unit?: 'items'` are new optional fields; JSON reports carry `limits` as is.
- `connect.ts` exports `isJsonRpcLine`, `stdoutTap`, `startupOutput`, `sdkStdioShape`, `NON_JSON_KEPT`, `NON_JSON_LINE_CAP`, `STDIO_MAX_MESSAGE` and the `NonJsonStdout` type (used by the tests).
- `limits.ts` exports `ID_CAP` and `UI_READS_CAP`.

## CHANGELOG lines (for `## [Unreleased]`)

### Fixed

- A stdio server that writes a flood of lines to stdout no longer crashes the check with a JavaScript heap out-of-memory error: only the first transport errors and the first 50 stray stdout lines are kept, with their counts.
- SRV-018 reports JSON log lines (pino, winston, bunyan) on stdout, not only lines that are not JSON at all.
- A stdio server whose handshake fails or is stopped by `--max-duration` now has its stderr and stdout shown: the fatal message names the first stray stdout line, SRV-018 reports it, and `--verbose` prints the stderr.
- A legacy HTTP+SSE server that requires auth only on `GET /sse` gets the auth probe and "requires auth" coverage instead of "not an MCP endpoint, try /mcp", and an SSE handshake error (an endpoint on another origin) is reported as such.
- A 401 to credentials passed with `--header` is reported as rejected credentials, not as "server requires OAuth".
- The auth probe reads the challenge from the 401 the credentials got when the unauthenticated request got a 403 without `WWW-Authenticate`, so false AUTH-002/004/013 errors no longer appear and PRM from the header is found.
- A server whose initialize is public but whose `tools/list` answers 401 gets the auth probe and "requires auth" coverage instead of SPEC-008/014/020 errors.
- A server that exits right after initialize no longer passes with a score of 100: the check is marked partial (`list-failed`).
- stdio messages up to 64 MB are accepted (the SDK default was 10 MB), and a larger one is named as the cause of the "Connection closed" errors that follow.
- A `--max-duration` deadline that falls while connections close after the last check no longer turns a finished run into INCOMPLETE "during active tool calls".
- A run stopped by `--max-duration` keeps the JSON-RPC errors and 2026-07-28 results it had observed.
- The input caps no longer cut names, URIs, regex patterns and other schema syntax at 16 KB, which caused false TOOL-003 duplicates and TOOL-017 "does not compile" errors, a false APPS-019 and skipped APPS checks for long UI URIs.

### Changed

- A 403 handshake failure names a Cloudflare bot challenge or WAF block (Cloudflare, Akamai, AWS WAF, Imperva) or the HTML page title, with a hint to allow the endpoint.
- A stdio server that announces an HTTP URL on stdout (an HTTP server started with `--stdio`) gets a pointer to check that URL instead.
- The check ends each Streamable HTTP session it opens with `DELETE`, so repeated runs leave no sessions behind on stateful servers.
- The input caps also cover raw list pages, the text-only tools/list, tool call results and 2026-07-28 results, and object keys; at most 50 UI resources are read per run, and the report says when more were listed.
