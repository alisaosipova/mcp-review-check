# W3A-connect remediation report (wave 3)

Branch `worktree-wf_a7e88476-bcc-1`. Owned files: `src/connect.ts`, `src/limits.ts`, `src/snapshot.ts`, `src/protocol/recording.ts`, `src/protocol/trace.ts`, `src/catalog.ts` and `src/diagnose.ts`. Regression tests are in `test/remediation-w3a-connect.test.ts` (10 tests).

Checks run: `npm run typecheck`, `npm run build`, and `npx vitest run` on `test/remediation-w3a-connect.test.ts`, `test/remediation-wp{2-connect,3-probe,4-protocol}.test.ts` and `test/{auth-probe,e2e-http,e2e-stdio,e2e-redaction,sarif,redact,redaction-tiers,cli-rules,diagnostics,max-duration,lifecycle,limits,docs,catalog,catalog-stale,report}.test.ts`. All passed except one test that already failed before this package (see "Found along the way"). The full suite was not run (D1).

## Done

| ID | Commit | What changed |
|---|---|---|
| F003 | 8442189 | `buildHttp` removes `user:pass@` from the URL before any request, because fetch refuses a URL that carries credentials. The credentials are sent as `Authorization: Basic <base64(user:pass)>` instead, percent-decoded as RFC 7617 expects. `--bearer` or an `Authorization` `--header` takes precedence over them. `redactorFor` adds the Basic value to the redactor, so the base64 credential, the decoded `user:pass` and the password are all masked. `snap.target.urlAsEntered` keeps the URL as the user typed it, for the rules. A 401 now counts as "supplied credentials rejected" (`token-rejected`), and `options.authenticated` is true. The function is exported as `urlBasicAuth()`. |
| F019 (rest) | ed1ac1b | `buildHttp` calls `sameHostRedirect(url, pf)` right after the preflight. `server/discover` (and the modern client behind it, including the modern fresh-connection re-list) and `runAuthProbe` (PRM well-known paths and the invalid-token probe) now use the redirect target. When the preflight was redirected, the check sends one more unauthenticated initialize to the target. That request decides the auth trigger and serves as the challenge exchange, so a 401 behind `/mcp` -> `/mcp/` still starts the auth probe even when `--bearer` is accepted. `snap.transport.preflight` stays the 3xx, so SRV-006 still reports the redirect. A dual-era server behind the redirect is now detected as `dual` instead of `legacy`. |
| F031 (rest) | 5073b72 | Both `tlsCheckWithRetry` calls (the MCP host and each authorization-server host) now get `{ timeoutMs: connectTimeout, signal: progress.abort.signal }`. The AS-host loop also runs a `checkpoint` (phase `auth probe`) before each host. A hanging handshake now ends at the `--max-duration` deadline without retries. |
| F137 (rawPages cap) | b699acf (test only) | `capSnapshot` already cut every string in `listMeta[*].rawPages` to TEXT_CAP. That was done by e5a36bd from wave 1, which was merged after the WP4 report deferred this item. The new regression test pins it for a padding key that no rule reads. No code changed. |
| R008 (legacy SSE) | 89f14f0 | `RecordingTransport` stores the send time of each request id and records `latencies[method]` (time from `send(id)` to the result with that id; errors are not sampled). Its clock is the tracer's `now`. For a legacy HTTP+SSE connection, `httpTimings()` in connect.ts adds these samples to `snap.transport.timings`, both at the end of the run and in the `--max-duration` stopped snapshot (via `progress.collect`). For Streamable HTTP the tracer's own samples are kept unchanged, so nothing is counted twice. |
| catalog-date | cae2189 | `CATALOG_DATE` is now `2026-11-01`. `npm run build && npm run readme:rules` regenerated the dated spans and example headers in `README.md`, `docs/RULES.md` and `docs/design/spec.md`. |

## Deferred

| ID | Reason |
|---|---|
| F024 / R010 (SPEC-016 part) | needs `src/rules/spec.ts`: SPEC-016 checks `code` on every `ObservedError` and reports "error code undefined is not an integer" when it is missing. If `collectErrors` added an entry for a successful modern response with a mismatched id (`ModernResponse.idMismatch`, or a string id for a numeric request), SPEC-016 would report that false error for every such entry. The rule must first skip the code checks for a result entry, for example on a new `ObservedError.result: true` flag set by `collectErrors`. Until then a mismatched value still fails the listing (SPEC-020), and an id that only differs in type is accepted, as the SDK accepts it. |

## Existing tests changed

- `test/e2e-redaction.test.ts`, "a token as the URL username, alone and in user:pass@, is redacted in the connect error". Before F003, the connect error held the URL with its userinfo (fetch's TypeError) and was checked against a closed port. Now the credentials go in an `Authorization: Basic` header, so the URL never reaches an error message. The test uses a server that echoes the decoded Basic credentials in an HTML error page, so the redaction is still checked on a real echo. It now expects `denied «redacted»` instead of `«redacted»@127.0.0.1`.
- `test/report.test.ts`: the expected header and `tool.catalogDate` come from `CATALOG_DATE` instead of the hard-coded `2026-10-22`.

## Found along the way (not in this package's files)

- **SRV-010 still uses time-to-headers on HTTP** (`src/rules/server.ts`, `latencySamples`). F059 (WP7, 01a01c1) made it use `exchange.durationMs` of the `sdk`, `modern` and `discover` exchanges, and it falls back to `transport.timings` only when no such exchange exists. But `durationMs` is the time until the headers arrive. WP4 (R008, 140924b) and this package changed `transport.timings` to measure the time until the result. As a result, an SSE-answered Streamable HTTP call still reads as about 1 ms. A legacy SSE `sdk <method>` POST answered with 202 is a 2xx and also reads as about 1 ms, so the legacy SSE samples added here do not reach SRV-010 yet. Fix in `server.ts`: use `transport.timings` first (it is already filtered to 2xx answers that carry a result), or `exchange.bodyMs` for exchanges that hold a result. Skip the exchanges of a legacy SSE connection that only got a 202.
- **AUTH-003 behind a redirect.** AUTH-003 reads `snap.transport.preflight`, and that stays the 3xx. A 403 or a 200 with `WWW-Authenticate` on the redirect target is therefore not seen. The target's unauthenticated initialize is recorded as a second `preflight` exchange in `transport.exchanges`. A `Snapshot.transport` field for it (for example `preflightTarget`) would need `snapshot.ts` and `rules/auth.ts`, so it was left for the maintainer.
- **Hand-written dates in `docs/design/spec.md`.** Line 17 ("Rule catalog date 2026-10-22") and line 1402 ("as of 2026-10-22") are outside the generator markers, so they still say 2026-10-22. They can be wrapped in `<!-- CATALOG_DATE -->` markers or edited by hand. CONTRIBUTING step 6 still says to move the date only for newer documentation; this move follows the integrator's decision for wave 3.
- **`test/e2e-stdio.test.ts` "an 80 000-character description is truncated and reported".** This test fails, but not because of this package: the markdown report escapes `_` (`tool run\_sql`), while the test expects `tool run_sql`. The escaping lives in `src/report/*`.

## CHANGELOG lines (for the integrator)

- Fixed: An HTTP URL with `user:pass@` now works. The credentials are sent as an `Authorization: Basic` header and redacted, and `--bearer` or an `Authorization` `--header` takes precedence. Before, every request failed with "Request cannot be constructed from a URL that includes credentials" (F003).
- Fixed: `server/discover`, the auth-probe trigger and the auth probe now follow a same-host redirect of the preflight (`/mcp` -> `/mcp/`). A dual-era or modern server behind such a redirect is no longer marked legacy, and a 401 behind the redirect starts the auth probe (F019).
- Fixed: TLS certificate checks on the MCP host and on the authorization-server hosts now obey `--timeout` (capped at 10 s) and stop at the `--max-duration` deadline without retrying (F031).
- Fixed: on legacy HTTP+SSE servers, `transport.timings` now holds the time from each request to its result, which arrives on the GET stream (R008).
- Changed: the rule catalog date is now 2026-11-01, because this release changes rule severities.
