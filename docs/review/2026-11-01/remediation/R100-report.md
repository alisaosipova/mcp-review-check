# R100 report (release 1.0.0 preparation)

Base: origin/main a19c972. No version bump, CHANGELOG.md untouched.

## Done
1. Plain forwarding: undici upgraded 6 -> 7.30.1 (Node >=20.18.1, compatible with our >=22.12; undici 8 needs Node >=22.19 and was not used). `EnvHttpProxyAgent` is created with `proxyTunnel: false`: `http:` targets go to an HTTP proxy as absolute-URI requests, `https:` targets still use CONNECT. Tested with a forward-only proxy that answers 405 to CONNECT (GET and POST seen as `http://...`, no CONNECT).
2. SOCKS: undici 7 has `Socks5ProxyAgent` (used by `ProxyAgent` for `socks5:`/`socks:`). `src/proxy.ts` accepts `socks5://`, `socks5h://` (mapped to `socks5:`; undici always sends the host name, so remote DNS) and `ALL_PROXY` (fallback for HTTP_PROXY/HTTPS_PROXY). SOCKS4/4a and other schemes throw `ProxyConfigError` naming the variable (credentials removed), which the CLI turns into exit 2. Tested with an in-process SOCKS5 server (checks the target arrives as a domain name).
3. Warning: `suppressProxyWarning()` wraps `process.emitWarning` and drops only `ExperimentalWarning` whose message starts with `[UNDICI-EHPA]` or `SOCKS5 proxy support is experimental`. undici 7 no longer warns for HTTP proxies; the SOCKS5 agent does. Tested: those two are dropped, another ExperimentalWarning and a plain warning still reach `process.on('warning')` and stderr.
4. Docker CI: the `build` job (the `push` job `needs` it) now runs `--version`, a listing-only run on `test/fixtures/listing/plugin-valid` (read-only mount, verified locally exit 0), and `--entrypoint id -u != 0`, before anything is pushed. Pinned SHAs unchanged; YAML validated with PyYAML. Static test in `test/p5b-docs.test.ts`. Not run in real Docker (not available here): CI verifies.
5. Docs: README "Stability policy" rewritten for 1.x (semver, what is not covered, `@1.0` pin); CONTRIBUTING stability and release sections updated; troubleshooting "Corporate proxy" updated (forward-only proxy, SOCKS5, ALL_PROXY, warning); CLI `--help` environment line updated.

## Deferred
- Version bump to 1.0.0, CHANGELOG.md, `@0.7` -> `@1.0` pins, `action.yml` default (release step per CONTRIBUTING).
- SOCKS4/4a; local-DNS `socks5://` (curl semantics); proxy-authorization other than URL credentials.
- The raw TLS check stays inconclusive behind any proxy (also SOCKS); its message still says "HTTP proxy".
- SOCKS5 in undici is experimental upstream: the Docker image smoke test and a real SOCKS5 server were not exercised beyond the in-process test.
- A bad proxy variable now fails every run, also `--stdio` ones (exit 2).

## Proposed CHANGELOG
### Added
- SOCKS5 proxies (`socks5://`, `socks5h://`) in HTTPS_PROXY, HTTP_PROXY and the new ALL_PROXY fallback; SOCKS4 and unknown schemes are a usage error (exit 2) naming the variable.
- The Docker image is smoke-tested in CI (version, listing-only run, non-root) before it is pushed.
- Stability policy for 1.x (semantic versioning) in the README and CONTRIBUTING.md.
### Changed
- `http://` targets go through an HTTP proxy as plain forwarded requests, so forward-only proxies work; `https://` still uses CONNECT.
- undici 6 -> 7.
### Fixed
- The `ExperimentalWarning` about proxy support is no longer printed (other warnings are).

## Tests run
`npm ci --ignore-scripts`, `npm run typecheck`, `npm run build` clean. Vitest (p5a-proxy, p5b-docs, workflows, docs, compat, diagnostics, e2e-http, redact): 8 files, 135 tests passed (6 new in p5a-proxy, 1 in p5b-docs).

## Review fixes
- Invalid proxy variable no longer blocks `--help`, `--version`, `--list-rules` and `explain` (they never use the network); other runs still exit 2. Test in p5a-proxy.
