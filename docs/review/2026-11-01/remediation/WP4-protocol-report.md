# WP4-protocol: remediation report

Package: `src/protocol/{trace,modern,legacy,stdioArgs,clientCaps}.ts`, 15 items (9 fixes, 6 improvements).
Branch `worktree-wf_365c0c99-4d0-4`, based on `8b0f41e`. Regression tests: `test/remediation-wp4-protocol.test.ts` (27 tests).

## Done

| Id | Commit | What changed |
|---|---|---|
| F119 | 779e9fc | `scrub` replaces all secrets in one regex pass (longest first), so a secret inside the marker (`redact`) no longer breaks a marker already put in. Values shorter than 8 characters are masked only as whole tokens (not next to a letter, digit, `_` or `-`): `--header 'X-Api-Key: test'` no longer turns `run_tests` into `run_«redacted»s` or `attestation` into `at«redacted»ation`. |
| F028 | 65e4154 | `parseSseMessages` and the SSE response watcher accept CRLF, LF and lone-CR line ends. The watcher also searches only new text for an event end, instead of re-splitting the whole buffer on every chunk. |
| F024 | 65e4154 | A response id that is the numeric request id written as a string (the SDK accepts it too, via `Number(id)`) ends an open SSE read at once instead of at the timeout. `idMatches` is exported for reuse. |
| R010 | 65e4154 | `ModernClient.request` no longer takes a result whose id answers another request (single JSON, batch, or the SSE `msgs[0]` fallback). It sets `idMismatch`, and `listAll` fails with `response id 999 does not match request id 1`, so SPEC-020 reports it. An error with `id: null` still counts as an answer. |
| F021 | 140924b | Latency samples (`tracer.timings`, read by SRV-010) are taken only for 2xx responses that hold a JSON-RPC result for the request id. Probe answers with an error status, a JSON-RPC error or a redirect no longer drag the median down. |
| R008 | 140924b | A sample measures the time until the result arrives, not until the headers. This matters for SSE answers (the SDK's default) and for JSON bodies too. On the SDK path the trace copy is read past its 256 KB cap (bytes are counted, not kept) to see when the response ends. A real SDK call still unanswered after the copy's 10 s read counts with the time waited. |
| F138 | ccbde37 | `sdkFetch` hands the SDK a response whose body errors past 64 MiB, counted per event on SSE streams so a long-lived GET stream keeps working. `url` and `redirected` are kept for the SSE client. The legacy, dual and SSE paths can no longer be made to buffer and parse an unbounded answer. `capBody` is exported. |
| F136 | e593f9c | Listing entries are added one by one, not by spreading into `push()`, so a page with 200k entries no longer throws `RangeError` (which ended the run as `fatal:` with exit 3). |
| F032 | e593f9c | Both eras share one `paginate()` (in `legacy.ts`). Non-object entries are dropped and reported the same way in both eras (`2 tools entries are not objects`), where legacy used to wrap them as `{ name: x }` and modern dropped them silently. |
| R011 | e593f9c | `nextCursor` that is `undefined`, `null` or `""` ends the listing. Any other non-string value fails it with `nextCursor is not a string (got number)`, instead of silently truncating the listing after the first page. |
| F137 | e593f9c | A listing stops with `listing exceeded 67108864 bytes` once its pages pass `LIST_BYTE_BUDGET` (64 MiB) and keeps the pages read before. Modern pages are counted by body bytes (`tracer.request` now returns `bodyBytes`, and `ModernResponse.bytes` carries them); SDK pages are counted by their JSON length. |
| F036 | 735bf37 | `snippetOf` scrubs only a prefix of the body for the 4 KB snippet, not the whole body of up to 64 MiB. A margin of 3 × the longest secret + 13 characters, doubling the prefix when long secrets shrink it, keeps a secret cut at the prefix's end out of the snippet. A randomized test checks that the result equals scrubbing the whole body. |
| F035 | 6b34d49 | `redactUrl` = `scrub(displayUrl(scrub(raw)))`. Exchange URLs are now masked like displayed ones: known-format tokens in any query value, path segment or fragment, plus userinfo. Known secret values are scrubbed before the URL is re-serialised, so a re-encoded value (`!` → `%21`) can no longer slip past. |
| F034 | a00b07c | `linkAbort` (a Node 18 workaround) replaced by `AbortSignal.any([ctrl.signal, stop])`. The request timeout still aborts with an `AbortError`, which the timeout checks in `obs.ts` and `diagnose.ts` expect, so `AbortSignal.timeout` is deliberately not used. |
| F025 (option) | b35b970 | `ModernRequestOptions.fullBody` (default `true`). With `false`, a request reads under the probes' 256 KB / 10 s cap. Passing it from the wire probes is deferred, see below. |

## Deferred

| Id | Reason |
|---|---|
| F025 (wiring) | needs src/probe/wire.ts: pass `fullBody: false` to the five `modern.request` probes (badVersion/unknownMethod/resourceMissing/headerMismatch/unknownTool). The option exists in `ModernClient` (b35b970). |
| R008 (legacy SSE part) | needs src/protocol/recording.ts: on legacy HTTP+SSE the POST returns 202 and the result arrives on the GET stream. That latency has to be measured in `RecordingTransport` (from `send(id)` to `record(id)`) and pushed into `timings`. The tracer no longer records the 202 as a sample, so SRV-010 stays silent instead of reporting ~1 ms. |
| F024 / R010 (SPEC-016 part) | needs src/connect.ts: to let SPEC-016 report it, `collectErrors` would need to add an observation for a successful modern response whose id has the wrong type or value (`ModernResponse.idMismatch`, or a type check on `exchange.json`). Today a wrong id fails the listing (SPEC-020); a string-for-number id is accepted as the SDK accepts it. |
| F137 (rawPages cap) | needs src/limits.ts: `capSnapshot` still does not cut strings inside `listMeta[*].rawPages`. Memory is now bounded by the 64 MiB listing budget, but the regex-cost caps do not reach raw pages. |
| F036 (json retention) | feature: each exchange still keeps its parsed `json`, which `collectErrors` and the probe rules read. Returning the parsed body to the caller and keeping only the snippet in the exchange changes the snapshot model across connect/probe/rules. |
| F034 (spec text) | needs docs/design/spec.md: §4.4 still describes Node 18 compatibility as mandatory. WP10 owns the file. |
| F138 (docs) | needs README.md / SECURITY.md: document the 64 MiB response cap that now applies on the SDK path too, and the 64 MiB listing budget (WP10). |

## Existing tests changed

- `test/redact.test.ts`, "redactDeep keeps the field names …": the server-data keys that showed in-key masking used the short secret `error` glued into identifiers (`x-error-hint`, `error_code`). After F119 a short secret is masked only as a whole token, so the keys became `x.error.hint` and `error.code`. The test still checks that keys inside server data are masked.

## Tests run

- `npm run typecheck`, `npm run build`: green.
- `npx vitest run test/remediation-wp4-protocol.test.ts`: 27 passed.
- Existing tests for the subsystem: `test/redact.test.ts`, `test/redaction-tiers.test.ts`, `test/e2e-redaction.test.ts`, `test/e2e-http.test.ts`, `test/e2e-stdio.test.ts`, `test/lifecycle.test.ts`, `test/max-duration.test.ts`, `test/auth-probe.test.ts`, `test/diagnostics.test.ts`, `test/client-caps.test.ts`, `test/util.test.ts`, `test/report.test.ts`, `test/rules/server.test.ts`, `test/rules/spec.test.ts`: all green.

## CHANGELOG lines

### Fixed

- A `--header`, `--bearer` or `--env` secret shorter than 8 characters is masked only as a whole word, so a short key such as `test` no longer rewrites tool names and descriptions (`run_tests`, `latest`) or causes false TOOL-001 findings. A secret that is part of the `«redacted»` marker no longer breaks markers.
- SRV-010 measures latency until the JSON-RPC result arrives, not until the response headers. Slow servers answering over SSE (the SDK default) are now reported.
- SRV-010 counts only calls answered with a result. Probes rejected with a fast 4xx, a JSON-RPC error or a redirect no longer hide a slow handshake or listing.
- SSE responses whose lines end in a lone CR are parsed.
- A 2026-07-28 response that echoes the request id as a string no longer makes every request wait for the full `--timeout`.
- A 2026-07-28 result that answers another request id is no longer taken as the answer. The listing fails and SPEC-020 reports the mismatch.
- A list page with hundreds of thousands of entries no longer crashes the run with `fatal: RangeError` (exit 3).
- A non-string `nextCursor` fails the listing (SPEC-020) instead of silently stopping after the first page.
- List entries that are not objects are reported as a listing error in both eras. Before, legacy servers had them wrapped as tools named after the value, and 2026-07-28 servers had them dropped silently.
- Recorded HTTP exchange URLs mask known-format tokens in query values, path segments and fragments under any parameter name, as displayed URLs already did.

### Changed

- Response bodies read by the MCP SDK (legacy Streamable HTTP and HTTP+SSE) are capped at 64 MiB (per event on SSE streams), as the 2026-07-28 client already was. Each listing is limited to 64 MiB over all its pages, so a hostile server can no longer exhaust the linter's memory.
