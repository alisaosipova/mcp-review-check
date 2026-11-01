# WP3-probe remediation report

Branch `worktree-wf_365c0c99-4d0-3`, owned files `src/probe/{active,auth,network,wire}.ts`. Regression tests: `test/remediation-wp3-probe.test.ts` (20 tests).

Checks run: `npm run typecheck`, `npm run build`, `npx vitest run` on `test/remediation-wp3-probe.test.ts`, `test/rules/{runtime,server,spec,auth}.test.ts`, `test/{auth-probe,util,e2e-http,e2e-stdio,diagnostics,max-duration,limits,local-mode,e2e-redaction}.test.ts` (414 tests, all green). The full suite was not run (D1).

## Done

| ID | Commit | What changed |
|---|---|---|
| F019 | 1af41e0 | `sameHostRedirect()` (network.ts) gives the target of a same-host redirect of the preflight (no other host, no https→http downgrade). The GET, bad-version, DELETE and Origin wire probes go to that URL, as the SDK client does. A `/mcp` → `/mcp/` redirect no longer yields false SPEC-005/SPEC-007 or hides SRV-008. SRV-006 still reports the redirect from the preflight. The discover, era and auth-probe part is deferred, see below. |
| F018 | 1f3de10 | When the SDK client already opened its standalone GET stream in the session and got an answer, the `get` probe reuses that exchange instead of sending a second GET. The TypeScript SDK server answers a second GET with 409, which raised a false SPEC-005. Without such an exchange the probe is sent as before. |
| F023 | f39463a | `wrongTypeValue` picks a value whose JSON type is outside every type the property allows. It returns `undefined` when the property has no `type` (missing schema, `{}`, anyOf/oneOf-only, `$ref`-only) or allows every type, and `runActive` then skips the `invalid-type` call. This removes the false RT-002 on union and untyped parameters. |
| R009 | c7a6477 | On legacy HTTP+SSE the Origin probes open the event stream (GET, `Accept: text/event-stream`, cut after the headers) with no Origin, claude.ai, chatgpt.com and a foreign Origin. SRV-008 now reports a local SSE server that accepts a foreign Origin. `originProbes` takes a mode (`initialize` / `discover` / `sse`) instead of the `modernOnly` flag. |
| C002 | 68a29a9 | `callableTools()` groups tools by name. A name is called only when every tools/list entry with that name passes `isSafeToCall`, and only once. |
| F144 | 68a29a9 | `--tool-args` is read by own key (`hasOwnProperty`), so tools named `constructor`, `toString` or `__proto__` get synthesized arguments and are not marked `valid`. |
| F029 | d049e15 | Argument synthesis keeps the documented order (default → examples[0] → enum[0] → const), then builds a type placeholder that follows the schema: sample values for string formats (uri, email, date-time, date, time, uuid, hostname, ipv4/6, …), minLength/maxLength, minimum/exclusiveMinimum/maximum/multipleOf, array minItems, the required properties of nested objects, the first non-null anyOf/oneOf/allOf branch, local `$ref` (`#/$defs/...`, depth-limited) and the first non-null member of a type union. `pattern` is not synthesized. |
| F030 | 5391b0f | `closeProbeSession()` sends one best-effort DELETE (no retries, timeout ≤ 5 s) when a raw initialize probe got a 2xx with `Mcp-Session-Id`. It runs after the preflight, the initialize-mode Origin probes and the auth invalid-token probe. A redacted or malformed id is not sent. |
| F031 | 7e28e4a | `Deps.tlsCheck` and `tlsCheckWithRetry` take `{ timeoutMs, signal }`. The handshake timeout is `min(timeoutMs, 10 s)`, `defaultTlsCheck` aborts on the signal, and once the signal aborts there are no more retries. The result is then `transient` (inconclusive), not a failed certificate. The connect.ts wiring is deferred, see below. |
| F037 | 4cf1df2 | `prmCandidates` drops a well-known URL already named by the `resource_metadata` header. Each auth metadata GET (and its timing samples) waits at most `min(--timeout, 10 s)`. All metadata GETs of one auth probe share a budget of 6 retries; after it runs out each URL gets one attempt. |

## Deferred

| ID | Reason |
|---|---|
| F019 (rest) | needs `src/connect.ts`: the preflight's same-host redirect should also be applied before `server/discover` (era detection: a dual/modern server behind a redirect is marked legacy), to the auth-probe trigger (a 401 behind the redirect is not seen) and to the `runAuthProbe` URL. Use `sameHostRedirect(url, pf)` from `src/probe/network.ts` right after `preflight()` in `buildHttp`. The wire probes already use it. |
| F031 (rest) | needs `src/connect.ts`: pass `{ timeoutMs: connectTimeout, signal: progress?.abort.signal }` to both `tlsCheckWithRetry` calls in `buildHttp` (MCP host and the AS-host loop), and add a `checkpoint` between AS-host checks. Until then the defaults stay as before (10 s, no abort). |

## Existing tests changed

None.

## Notes for WP10 (docs)

- `docs/design/spec.md` §2.9 describes the type placeholder as `"mcp-review-check"`, `1`, `false`, `[]`, `{}`. It should mention that the placeholder now follows format, length, bounds, minItems, nested required properties, anyOf/oneOf and local `$ref`, and that the wrong-type call is skipped when the property has no type (F029, F023). It should also note that a duplicated name is called only when every entry with it is safe (C002).
- §4.3 (default wire probes) should list the DELETE that closes a session minted by a raw initialize probe (F030), the GET-based Origin probes on legacy HTTP+SSE (R009), reuse of the SDK session GET (F018) and probing the same-host redirect target (F019).

## CHANGELOG lines

### Fixed

- A same-host redirect of the entered URL (such as `/mcp` → `/mcp/`) no longer produces false SPEC-005 and SPEC-007 findings or hides SRV-008: the GET, version and Origin probes follow it as the SDK client does, and SRV-006 still reports the redirect.
- SPEC-005 no longer reports `GET returned 409` on servers that allow one SSE stream per session (such as the TypeScript SDK with sessions): the GET observation comes from the stream the client already opened.
- RT-002 no longer reports "wrong-type argument returned a success result" for parameters with a type union, no type, or only anyOf/oneOf/`$ref`: the wrong-type value is taken from outside every allowed type, and the call is skipped when no such value exists.
- SRV-008 now checks local legacy HTTP+SSE servers: the Origin probes open the event stream, so a server that accepts a foreign Origin (DNS rebinding risk) is reported instead of passing silently.
- `--active` calls a tool name only when every `tools/list` entry with that name is read-only and non-destructive, and calls it once, so a duplicate destructive entry is never reached.
- `--tool-args` no longer matches tools named `constructor`, `toString`, `__proto__` or other `Object.prototype` members.

### Changed

- `--active` synthesizes arguments that pass common validation: sample values for string formats (uri, email, date-time, uuid, …), string lengths, numeric bounds and `multipleOf`, `minItems`, required properties of nested objects, the first anyOf/oneOf branch and local `$ref`.
- The raw `initialize` probes (preflight, Origin, invalid token) close the session a stateful server mints for them with one best-effort DELETE.
- The auth probe requests a metadata URL named by `resource_metadata` only once, waits at most 10 s per metadata request, and shares one budget of six retries across all of them.
- The TLS handshake check accepts a timeout (capped at 10 s) and the `--max-duration` deadline; a check cut off by the deadline is reported as inconclusive.
