# P2 (transport and proxy): remediation report for 1.0.1

Scope: src/proxy.ts, src/redact.ts, src/diagnose.ts, src/connect.ts, src/protocol/**. New tests are all in
test/r3-p2-transport.test.ts. No existing test was changed.

Patch-release check (README "Stability policy"): no fix adds a finding or raises a severity on a server that passed
before. A02-02, A02-04 and A02-05 change only diagnosis text and the proxy route assumed by diagnostics. A02-03 removes
a false SPEC-020 / list-failed. A10-02 turns some listings and probes into short waits: a listing that gets no answer
in the short wait is left out (so the rules that need it are skipped, not failed), and a probe without an answer
yields no finding (the spec rules skip a probe with transportError). A02-01/A07-01 and A04-04 are hardening.

## Fixed

| id | what changed | test (test/r3-p2-transport.test.ts) |
|---|---|---|
| A02-01, A07-01 (same defect) | src/proxy.ts exports `PROXY_URL_VARS` (HTTPS_PROXY, HTTP_PROXY, ALL_PROXY) and `proxyEnvUrls()`, which reads each name in upper and lower case. src/redact.ts builds its proxy list from `proxyEnvUrls()`. So ALL_PROXY/all_proxy credentials (user, password and the `Basic <b64>` value, any scheme, socks5 included) are redacted like the HTTP(S)_PROXY ones. | `A02-01 / A07-01: ALL_PROXY credentials are redacted like HTTP(S)_PROXY ones` (shared list; ALL_PROXY/all_proxy x http/socks5; an e2e run through an echoing proxy set in ALL_PROXY) |
| A02-02 | `bypassesProxy` now decides exactly as undici's EnvHttpProxyAgent does. `*` bypasses only when it is the whole value. An entry's port is the digits after its last `:`. An IPv6 host is compared in brackets. `installProxy` always passes `noProxy` (`""` when unset), so undici never rereads the environment. | `A02-02: bypassesProxy decides NO_PROXY as undici does` (a table run against a real EnvHttpProxyAgent: 13 NO_PROXY values x 3 targets, IPv4, IPv6 and localhost; plus unit cases) |
| A02-03 | When an SSE or batch body holds several messages, parseBody (trace.ts) and ModernClient.request (modern.ts) now pick the response first: the message with `result` or `error` for the id. Before, a server-to-client request with the same id could be taken instead. A 2xx without any response now says `HTTP 200 without a JSON-RPC response to <method>` instead of a bare `HTTP 200`. | `A02-03: an SSE body yields the response, not a server request with the same id` (2 tests) |
| A02-04 | describeHttpFailure: any 5xx is kind `http`, no longer `not-mcp`. A 502/503/504 names the hop in front of the server: the HTTP proxy, redacted label, when proxyForUrl says one is used, otherwise "the gateway or proxy in front of the server". The hint says the URL path is not the cause. A trailing `: ` left in the SDK message by an empty body is dropped. 404/405/410 and 2xx-4xx HTML pages are unchanged. | `A02-04: a 5xx gateway page is not "not an MCP endpoint"` (3 tests, including the unchanged 404) |
| A02-05 | describeCause: a TLS code with a proxy in use now says `TLS certificate presented for <host> through the proxy <label> is not trusted`. The hint names a TLS-inspecting proxy and NODE_EXTRA_CA_CERTS. Without a proxy the text is unchanged. | `A02-05: a TLS failure behind a proxy names the proxy and NODE_EXTRA_CA_CERTS` (2 tests) |
| A02-06 | GroupStdioTransport.close runs the whole sequence once for the group (Windows: the tree): stdin EOF, up to 2 s; SIGTERM, up to 2 s; SIGKILL. The SDK's close then finds the process gone. That is about 4 s instead of about 6 s per connection for a server that ignores both. The class is now exported for the test. | `A02-06: a stdio server that ignores stdin EOF and SIGTERM is closed with one wait per step` (POSIX only) |
| A04-04 | The notification tally (trace.ts) is a null-prototype object, and the cap check uses `Object.hasOwn`. `constructor`, `toString` and `__proto__` are now counted as numbers. | `A04-04: the notification tally keeps server method names as plain keys` |
| A10-02 | When tools/list times out after a successful initialize (the SDK's -32001 Request timed out), each later listing waits at most `STALLED_TIMEOUT_MS` (2000 ms, never more than --timeout), and so do the stdio wire probes. A listing that gets no answer in that wait is not recorded as failed: the short wait is ours, so no SPEC-020 is reported that the full wait would not have given. coverage.reason names the unanswered methods. A new `BuildOptions.onStall(message)` callback fires once (its text holds no server data). UI resource reads keep the full timeout: a read cut short could fail a UI rule. With the defaults this takes the silent wait from about 7 x 30 s down to about 30 s plus a few 2 s waits. | `A10-02: a server that answers only initialize` (uses test/fixtures/hang-server.mjs) |

Improvement "Share the proxy variable list between proxy.ts and redact.ts": done with A02-01/A07-01 (`PROXY_URL_VARS`
and `proxyEnvUrls()` in src/proxy.ts, used by src/redact.ts).

## Not fixed

None. One part of A10-02 is outside P2's files: printing the stall line on stderr (see "Integrator notes").

## Integrator notes

- A10-02 (stderr line): src/cli.ts is not P2's file. In runCli, before `await buildSnapshot(opts)` (around line 496),
  set `opts.onStall = (m) => { process.stderr.write(\`mcp-review-check: ${m}\n\`); }`. Write it straight to
  process.stderr: the `stderr` string runCli returns is printed only at the end, which is the problem the item
  describes. The message holds no server data and no secret: it is built only from the --timeout value.
  Optionally add a test asserting it appears once.
- A TTY phase line (`connecting…`, `tools/list…`) is the reviewer's optional extra. It is not done; it would also
  belong in cli.ts.

## Proposed CHANGELOG lines (1.0.1)

### Security
- Credentials in `ALL_PROXY`/`all_proxy` (any scheme, socks5 included) are now redacted in every output, like those in `HTTP(S)_PROXY`. Routing and redaction read one shared list of proxy variables. (review A02-01, A07-01)

### Fixed
- `NO_PROXY` is decided exactly as undici does (`*` only as the whole value, bracketed IPv6 entries), so diagnostics and the TLS check assume the route fetch really takes. (review A02-02)
- A response on an SSE or batch body is no longer lost to a server request with the same id (no false SPEC-020 / list-failed). A 2xx with no response says so instead of a bare "HTTP 200". (review A02-03)
- A 502/503/504 gateway page is diagnosed as the gateway or proxy failing to reach the server, not as "not an MCP endpoint" with a path suggestion. The trailing ": " of an empty body is gone. (review A02-04)
- A TLS failure behind a proxy names the proxy and `NODE_EXTRA_CA_CERTS`. (review A02-05)
- A stdio server that ignores stdin EOF and SIGTERM is closed in about 4 s, not about 6 s, per connection (one EOF, SIGTERM, SIGKILL sequence). (review A02-06)
- Notification method names such as `constructor`, `toString` or `__proto__` no longer corrupt the notification tally. (review A04-04)

### Changed
- A server that answers initialize but not tools/list: later listings and stdio wire probes wait at most 2 s instead of the full `--timeout`. A listing without an answer in that wait is skipped, not reported as failed. (review A10-02)

## Proposed spec paragraphs (docs/design/spec.md)

- Proxy: "The proxy variables are HTTPS_PROXY, HTTP_PROXY and ALL_PROXY, each in either case (`PROXY_URL_VARS` in src/proxy.ts). Routing and redaction read the same list. NO_PROXY follows undici's EnvHttpProxyAgent: comma or whitespace separated entries; `*` bypasses only as the whole value; `.example.com` and `*.example.com` match the domain and its subdomains; `host:port` limits the entry to that port; IPv6 entries are written in brackets."
- Stalled server: "When tools/list gets no answer within --timeout after a successful initialize, later listings and wire probes wait at most 2000 ms (never more than --timeout). A listing that gets no answer in that wait is not recorded, so the rules that need it are skipped. coverage.reason names those methods. UI resource reads keep the full wait."
- Diagnosis: "A 5xx handshake answer is kind `http`. 502/503/504 name the proxy (when one is used) or the gateway in front of the server. Only 404/405/410, or an HTML page with a status below 500, is `not-mcp`. A TLS error with a proxy in use names the proxy and NODE_EXTRA_CA_CERTS."

## Verification

- `npm run typecheck`: clean. `npm run build`: clean.
- `npx vitest run test/r3-p2-transport.test.ts`: 1 file, 18 tests, 18 passed.
- Existing test files that import the changed modules (25 files: auth-probe, e2e-redaction, client-caps, incomplete, lifecycle, remediation-wp4-protocol, unit-legacy, diagnostics, redaction-tiers, p5a-proxy, remediation-w4c-connect, redact, remediation-w3a-connect, remediation-w6c-spec-rules, remediation-w6d-core, remediation-w3b-probe-rules, remediation-w5c-connect, unit-wire, remediation-w6g-core-followup, remediation-w6h-review-fixes, remediation-wp2-connect, remediation-wp3-probe, remediation-wp9-report-redact, util, windows): 455 tests, 454 passed. The one failure was `remediation-wp2-connect > a message over the stdio buffer names the overflow on the failed read`: its 170 s request timeout ran out (194 s) while the 25 files ran in parallel. Run alone it passed (1 passed, 28 skipped). It is a load-sensitive 70 MB read test, and it does not use the paths these fixes changed (UI resource reads keep the full timeout).
- "Fails before" was not rerun file by file in this session: the new test file imports exports these commits add (`PROXY_URL_VARS`, `proxyEnvUrls`, `STALLED_TIMEOUT_MS`, the exported `GroupStdioTransport`), so against the old code it does not compile. Each assertion targets the behaviour the reviewers reproduced at 1f24aba.

## Review fixes

Second review round on this branch: one medium finding (A10-02 only partly fixed) and one low one.

| finding | what changed | test (test/r3-p2-transport.test.ts) |
|---|---|---|
| A10-02 follow-up (medium): HTTP wire probes still waited the full --timeout after a stall; modern-era HTTP got no short wait | buildHttp now builds the stall plan for both eras. Legacy HTTP uses the SDK lister at the short wait. 2026-07-28 HTTP uses `ModernClient.listAll(..., timeoutMs)` (new optional argument). `stalled()` also recognises the 2026-07-28 client's timeout (`This operation was aborted`, or `response body not complete after N ms`), so `onStall` fires there too. After a stall the wire probes get `STALLED_TIMEOUT_MS`: the SDK probes, the legacy HTTP probes (badVersion, Origin, challenge) and the 2026-07-28 probes (the `ModernClient.timeoutMs` default, now public, is lowered for the probe phase and restored after it). An HTTP probe that the short wait cut off is removed from `transport.probes`. Cut off means no status (the fetch timed out), or a status but no JSON-RPC response when the body read reached the short wait. Its rule is then skipped. SPEC-002/008/014 would otherwise report "got no status" for a probe that the full wait might have seen answered. Probes made before the probe phase (the discover probe) are kept. The SDK probes keep their `transportError`, which their rules already skip. | `A10-02 (follow-up): an HTTP server that answers only initialize or server/discover` (2 tests: legacy and 2026-07-28 against an in-test HTTP stall server at --timeout 4000. They check one onStall call, unrecorded later listings, the coverage reason, the short probe durations, the dropped cut-off probes, the kept answered Origin and discover probes, and a time bound for the 2026-07-28 run) |
| Low: a 502/503/504 with a plain-text body lost the body text | describeHttpFailure keeps the body text of a non-HTML gateway answer. The text comes from the SDK message after `Error POSTing to endpoint[ (HTTP n)]:`. It is folded to one line, capped at 200 characters and appended as ` (it answered: <text>)`. An empty body and an HTML page are unchanged. | `a plain-text 503 body stays in the diagnosis, on one line and capped`; `a plain-text 502 body that echoes the token is redacted in the report` (e2e through runCli with a SYNTH bearer that the 502 body echoes: the text reaches the report, the token does not) |

Patch policy: neither change adds a finding or raises a severity. The listings and probes the short wait skips are left
out of the snapshot (their rules skip), and the gateway text only lengthens the connect diagnosis.

Measured with the new tests (--timeout 4000, the server answers only initialize or server/discover): the legacy run took
27.6 s and the 2026-07-28 run 29.0 s. Most of what remains is 2 s waits: tools/list at --timeout, three listings,
3 to 6 RPC probes, badVersion or DELETE, and the challenge probe with its single timeout retry in src/probe/network.ts.
At the default --timeout 30000 that comes to about 30 s plus about 26 s of short waits. Before the change it was about
30 s plus 5 to 7 full waits.

Still not fixed in P2's files: `BuildOptions.onStall` is not yet wired in src/cli.ts, which is not P2's file. The patch
in "Integrator notes" above still applies as written. Until it is applied, the CLI prints nothing during the wait.

### Proposed CHANGELOG lines (replacing the A10-02 "Changed" line above)
- A server that answers initialize (or server/discover) but not tools/list: later listings and every wire probe, over stdio and HTTP in both protocol eras, wait at most 2 s instead of the full `--timeout`. A listing or HTTP probe without an answer in that wait is skipped, not reported as failed. (review A10-02)
- A 502/503/504 handshake answer with a plain-text body keeps that text in the diagnosis (one line, at most 200 characters, redacted). (review A02-04)

### Proposed spec paragraph (replacing the "Stalled server" one above)
- Stalled server: "When tools/list gets no answer within --timeout after a successful initialize (or server/discover), later listings and all wire probes wait at most 2000 ms (never more than --timeout). A listing that gets no answer in that wait is not recorded, so the rules that need it are skipped. coverage.reason names those methods. An HTTP wire probe that the short wait cut off (no status, or no JSON-RPC response when the body read reached the wait) is left out of the snapshot, so its rule is skipped. UI resource reads keep the full wait."

### Verification (review fixes)
- `npm run typecheck`: clean. `npm run build`: clean.
- `npx vitest run` on 18 files: r3-p2-transport, auth-probe, remediation-w3b-probe-rules, incomplete, diagnostics, remediation-w4c-connect, remediation-w6d-core, remediation-wp3-probe, remediation-wp4-protocol, remediation-w6h-review-fixes, remediation-w5c-connect, unit-wire, remediation-w3a-connect, client-caps, unit-legacy, lifecycle, e2e-redaction and remediation-w6c-spec-rules. Result: 320 passed. `remediation-wp2-connect` on its own: 29 passed.
