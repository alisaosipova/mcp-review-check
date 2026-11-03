# P5A-proxy report (release 0.5.0)

## Done
- `src/proxy.ts`: reads HTTPS_PROXY / HTTP_PROXY / NO_PROXY (either case; a value without a scheme is read as http://). `installProxy()` runs only when a proxy variable is set: it installs undici `EnvHttpProxyAgent` as the global dispatcher and replaces `globalThis.fetch` with undici's own fetch bound to that dispatcher. The replacement is needed: Node 26's bundled fetch ignores a dispatcher from the undici 6 dependency (verified: direct DNS lookup instead of the proxy). `proxyForUrl` / `bypassesProxy` implement NO_PROXY matching (`*`, `host`, `.domain`, `*.domain`, `host:port`).
- `src/cli.ts`: one import and one `installProxy()` call at the top of the `isMain` block (stdio targets unaffected).
- `src/redact.ts`: `buildRedactor` always adds the credentials of the proxy URLs in the environment (password, user, and the `Basic base64(user:pass)` form).
- `src/probe/network.ts`: `tlsCheckWithRetry` returns an inconclusive result (`transient`, reason in `code`, proxy shown without credentials) when a proxy applies to the host; NO_PROXY hosts are still checked.
- `src/diagnose.ts`: `networkCause` walks the cause chain (undici nests the tunnel error one level deeper); `describeCause` names the redacted proxy for ECONNREFUSED/ENOTFOUND/timeouts/resets when a proxy applies, and for a 407 ("Proxy response (407) !== 200") gives a Proxy Authentication Required diagnosis; `describeHttpFailure` does the same for a 407 status.
- Dependency: `undici ^6.29.1` (Node 22 bundles undici 6); `package.json` / `package-lock.json`.

## Findings
- undici 6 `ProxyAgent` always tunnels with CONNECT, even for http: targets. A proxy that only supports plain forwarding will not work.
- undici emits `[UNDICI-EHPA] ExperimentalWarning` on stderr when the agent is created (only when a proxy is set). Not suppressed.

## Deferred
- Suppressing the experimental warning; SOCKS proxies; proxy-authorization other than URL credentials.

## Files
src/proxy.ts, src/cli.ts, src/redact.ts, src/probe/network.ts, src/diagnose.ts, test/p5a-proxy.test.ts, package.json, package-lock.json.

## Tests run
`npm run typecheck`, `npm run build` clean. `npx vitest run test/p5a-*.test.ts test/diagnostics.test.ts test/e2e-http.test.ts test/redact.test.ts`: 4 files, 90 tests passed (12 new in p5a-proxy: env parsing, NO_PROXY matching, through-proxy run, NO_PROXY bypass, 407 diagnosis with redaction, dead proxy, TLS inconclusive, redactor).

## Proposed CHANGELOG (0.5.0)
### Added
- Corporate proxy support: HTTPS_PROXY, HTTP_PROXY and NO_PROXY (and lowercase) apply to every HTTP request; the raw TLS handshake check is reported as inconclusive for hosts behind a proxy.
- A proxy that refuses the connection or answers 407 Proxy Authentication Required is named as the cause (credentials redacted).
### Changed
- New runtime dependency: undici 6.

## README / --help text (not placed)
- Troubleshooting: "Behind a corporate proxy set HTTPS_PROXY=http://user:pass@host:3128 (and NO_PROXY=host1,.internal). The proxy must allow CONNECT. The TLS certificate check of the MCP host is skipped (inconclusive) when it goes through a proxy."
- Help footer: "Environment: HTTPS_PROXY, HTTP_PROXY, NO_PROXY, NODE_EXTRA_CA_CERTS."

## Spec paragraph
When HTTPS_PROXY/HTTP_PROXY is set, all HTTP requests go through it via CONNECT, except hosts matched by NO_PROXY. The direct TLS handshake check cannot traverse an HTTP proxy and is reported inconclusive (info) for proxied hosts. Proxy URL credentials are always redacted.

## Review fixes
- Fixed (medium): HTTP_PROXY alone also proxied https: requests while diagnostics/TLS check assumed direct. proxyConfig() now falls back httpsProxy to httpProxy, mirroring undici's EnvHttpProxyAgent, so proxyForUrl, describeCause (proxy-hop and 407 hints) and tlsCheckWithRetry (inconclusive) all treat the request as proxied. Test added in test/p5a-proxy.test.ts.
- Spec/README note: HTTPS_PROXY falls back to HTTP_PROXY.
