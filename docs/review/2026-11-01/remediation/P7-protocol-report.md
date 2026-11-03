# P7-protocol report (release 0.7.0)

## Done

1. **tasks/get probe.** When the initialize or server/discover capabilities declare `io.modelcontextprotocol/tasks`, the modern client sends `tasks/get` with `taskId = mcp-review-check-<uuid>` (cannot exist, no side effects), declaring the tasks extension in the request's client capabilities (the extension spec makes a server answer a non-declaring client with -32021). Stored as wire probe `tasksGet`. SPEC-023 now reports: -32601 (or 404 without JSON-RPC error) -> **error** "declared but tasks/get is not implemented" (spec: "Invalid or nonexistent taskId: -32602 ... Servers MUST return this error for tasks/get"); a result for the random id -> warning; any other code (for example -32021) -> info, not verified; -32602 -> verified, and the "not probed" info then lists only `tasks/update, tasks/cancel` (their wording is only SHOULD, so they stay unprobed).
2. **SPEC-005 / subscriptions/listen.** Verified: 2026-07-28 removed the GET stream; `subscriptions/listen` is a **POST** request whose response is an SSE stream (it "replaces the HTTP GET endpoint"); a modern-only server's GET is "SHOULD 405" (already SPEC-015). So a GET is not "valid as subscriptions/listen"; GET handling is unchanged. New probe `subscriptionsListen`: POST with filter `{toolsListChanged: true}`, only when capabilities declare `listChanged` or `resources.subscribe`; headers only (`abortAfterHeaders`), 5 s timeout, closed at once. SPEC-005 adds a warning when it gets 2xx with a content type other than `text/event-stream`. The acknowledgment (first event) is not read (headers only, per the task).
3. **Logging notifications.** The tracer tallies notifications (messages with `method` and no `id`) in every SSE/JSON body it reads: `snap.transport.notifications = { methods: {name: count}, otherMethods?, message?: {total, unrequested, invalidLevel} }`. Cap 20 distinct names, names cut at 100 characters and passed through the redactor; no params are stored. New rule **SPEC-024** (spec, error): `notifications/message` on a 2026-07-28 request without `io.modelcontextprotocol/logLevel` (error: "MUST NOT"; the tool never sends a logLevel, so any message qualifies); message seen but no `logging` capability (error: "MUST declare"); message without a valid RFC 5424 level (warning, the schema marks it required but there is no MUST sentence). HTTP only; stdio/SDK-client notifications are not recorded.

Sources: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http, .../basic/patterns/subscriptions, .../server/utilities/logging, https://github.com/modelcontextprotocol/ext-tasks/blob/main/specification/2026-07-28/tasks.md

## Files

`src/probe/wire.ts`, `src/protocol/modern.ts` (request options `abortAfterHeaders`, `capabilities`), `src/protocol/trace.ts` (notification tally, `Tracer.notifications`), `src/snapshot.ts` (probe names, `NotificationLog`), `src/connect.ts` (copies the tally into the snapshot, also on a --max-duration/budget stop), `src/rules/spec.ts` (SPEC-005, SPEC-023, SPEC-024), `test/fixtures/modern-server.ts` (options `tasks`, `listen`, `logging`; defaults unchanged), `test/p7-protocol.test.ts` (10 tests), `test/rules/spec.test.ts` (SPEC-024 case), `test/catalog.test.ts` (SPEC range 23 -> 24), `docs/RULES.md` (regenerated).

## Tests run

- `npm run typecheck`, `npm run build`: pass.
- `npx vitest run test/p7-*.test.ts test/remediation-w6c-*.test.ts test/e2e-http.test.ts test/rules/ test/real-servers.test.ts test/max-duration.test.ts test/catalog.test.ts`: 15 files, all pass (434 tests).
- `test/docs.test.ts` fails until the integrator runs `npm run readme:rules` (README.md and docs/design/spec.md carry the generated rule count, 176 -> 177; I did not touch them).

## Deferred

- Notifications over stdio / the SDK client (SDK GET stream is not read).
- Reading the first event of the listen stream (`notifications/subscriptions/acknowledged`, a MUST) needs a short body read; the probe is headers-only for now.
- `tasks/update`, `tasks/cancel` stay "not probed": they mutate task state and the spec wording is SHOULD for unknown ids.
- Bump `CATALOG_DATE` (src/catalog.ts, not owned).

## What the tool sends (README text)

New requests, all to the MCP endpoint of a 2026-07-28 (modern or dual) server, none changing state: `tasks/get` for a random non-existent task id, only if the server declares the tasks extension; `subscriptions/listen` (toolsListChanged filter), only if it declares `listChanged` or resource subscriptions, closed as soon as the response headers arrive. Server notifications seen in responses are counted by method name only (no payloads kept). Both probes honour `--max-duration` and the snapshot budget through the shared tracer.

## Proposed CHANGELOG lines

```
### Added
- Read-only `tasks/get` probe (random non-existent taskId) when the server declares `io.modelcontextprotocol/tasks`; SPEC-023 now reports a declared but unimplemented `tasks/get` as an error.
- `subscriptions/listen` probe (headers only, closed at once); SPEC-005 warns when it is answered with something other than an SSE stream.
- SPEC-024 (spec error): `notifications/message` sent without `io.modelcontextprotocol/logLevel`, without a declared `logging` capability, or without a valid level.
- Snapshot records the server notifications seen (method names and counts).
```

## Proposed spec paragraphs (docs/design/spec.md section 2.2)

**SPEC-024 Logging notifications valid.** spec=error. Detect (HTTP, from `transport.notifications.message`): messages on a 2026-07-28 request without `_meta["io.modelcontextprotocol/logLevel"]` (error, MUST NOT); messages while no capability source declares `logging` (error, MUST); messages with a missing or unknown `level` (warning). Source: https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/logging

**SPEC-005 addition.** If the `subscriptionsListen` probe got 2xx and the content type is not `text/event-stream`: warning. Source: .../basic/patterns/subscriptions

**SPEC-023 addition.** `tasksGet` probe: -32601 -> error; result -> warning; other -> info; -32602 -> verified.

## Review fixes

- SPEC-005 listen check no longer warns when subscriptions/listen answered with a JSON-RPC error (e.g. -32601 over HTTP 200); it is skipped when the probe has an error. Test added in test/p7-protocol.test.ts with a `listen: 'rpcerror'` fixture mode.
- To see the error body, src/protocol/trace.ts now reads (capped) application/json answers even with abortAfterHeaders; streams are still cut after the headers. Probe passes keepJson. Tests run: p7-protocol, e2e-http (43 tests pass); typecheck and build pass.
