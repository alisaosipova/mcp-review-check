# Troubleshooting

Start with `--verbose`: it prints a redacted trace of the HTTP requests on stderr. Exit codes are listed in the [README](../../README.md#exit-codes) and in full under [Exit codes](options-and-config.md#exit-codes).

## Could not connect (exit 3)

`Result: FAIL (could not connect)` means no handshake completed. The report names the cause instead of `fetch failed`:

| Cause in the report | What to check |
|---|---|
| The hostname does not resolve | Typo in the URL, a private DNS name that only your VPN resolves, a missing public DNS record. Try `nslookup <host>` from the same machine. |
| Connection refused or timed out | The server is not listening on that port, a firewall drops the traffic, or you need a proxy ([Corporate proxy](#corporate-proxy)). |
| `the server accepted the connection on host:port but did not answer POST initialize within N ms` (JSON kind `no-answer`, since 1.2.0) | Something accepts TCP on that port but never answers: another process holds the port, a debugger has paused the server, or a cold start takes longer than the connect wait. After the first unanswered request the run waits only 2 s for `server/discover` and the handshake, so it fails in about one connect wait (`min(--timeout, 15000)` ms) instead of four. |
| `initialize got no answer within N ms` (kind `timeout`) | The server answered the first requests but not the handshake. HTTP connect waits `min(--timeout, 15000)` ms whatever `--timeout` is; a cold-starting server may need a warm-up request first. |
| Certificate not trusted (`CERT_*`, self-signed) | See [Self-signed and corporate CA certificates](#self-signed-and-corporate-ca-certificates). |
| 404, 405, 501 or an HTML page | The URL is not the MCP endpoint (501 is what a static file server answers to a POST). The report suggests one, usually `<url>/mcp`. |
| 401 | Not an error: the auth checks run and the tool checks need a token ([Authentication](auth.md)). |

A local server is reachable only from where the tool runs: inside Docker, `localhost` is the container ([CI and automation](ci.md#docker)).

## DNS and TLS errors

The tool uses the configured resolver (the resolv.conf servers, which SRV-004 messages name) and Node's TLS stack, not your browser's. If a browser opens the URL but the tool does not, the usual causes are an extra root certificate that only the OS or the browser trusts (below), a proxy configured only in the browser, or an IPv6-only or split-horizon DNS name. Rules `SRV-*` report public-internet properties (public IPv4, HTTPS); on `localhost` or a name without a dot they are info only ([local mode](options-and-config.md#local-mode)).

## Self-signed and corporate CA certificates

Node does not read the operating system's certificate store. Give it the CA file (PEM) that signed your server or that your company's TLS inspection uses:

```bash
NODE_EXTRA_CA_CERTS=/path/to/company-ca.pem npx mcp-review-check https://mcp.internal.example/mcp
```

On Windows PowerShell: `$env:NODE_EXTRA_CA_CERTS = 'C:\certs\company-ca.pem'`. The variable adds the file to Node's built-in roots; it must be set before the process starts. Do not turn certificate checking off: a self-signed certificate on a server you submit to a directory is itself a finding.

## Corporate proxy

From 0.5.0 mcp-review-check honours the standard proxy variables for HTTP and HTTPS requests to the server and to the authorization servers:

```bash
export HTTPS_PROXY=http://proxy.corp.example:3128
export NO_PROXY=localhost,127.0.0.1,.corp.example
npx mcp-review-check https://mcp.example.com/mcp
```

- `HTTPS_PROXY` applies to `https://` targets and `HTTP_PROXY` to `http://` ones; when only `HTTP_PROXY` is set it is used for `https://` too, and `ALL_PROXY` is the fallback for both (lower-case names work as well). `NO_PROXY` is a comma-separated list of hosts and domain suffixes that connect directly.
- `http://` targets are sent to an `http://` proxy as ordinary forwarded requests (absolute-URI), so a proxy that only forwards plain HTTP works for them. `https://` targets, and every target behind an `https://` proxy URL, need `CONNECT` tunnelling, which all common corporate proxies support; a forward-only proxy cannot carry them. A SOCKS5 proxy uses neither: every request goes through its own SOCKS connect. `--verbose` prints the route (proxy, variable and method, credentials removed) on a `proxy:` line.
- SOCKS5 proxies work: `socks5://host:1080` and `socks5h://host:1080` (user:pass in the URL is used for username/password authentication). The target host name is always sent to the proxy, so it resolves the name (what curl calls `socks5h`); `socks5://` and `socks5h://` behave the same. SOCKS4 and SOCKS4a are not supported: such a value stops the run with a usage error (exit 2) that names the variable (`HTTPS_PROXY: unsupported proxy scheme "socks4://" ...`), without credentials. SOCKS5 support in the HTTP client is marked experimental upstream.
- Credentials in the proxy URL (`http://user:pass@proxy:3128`) are accepted and redacted in every output. Set the variable in the environment, not in a script that gets logged.
- A refused or unreachable proxy, or a `407 Proxy Authentication Required` answer, is named as the cause of the failure (credentials removed), with the kind of proxy and the variable that set it (`HTTPS_PROXY`, `HTTP_PROXY` or `ALL_PROXY`). The hint mentions `CONNECT` only where the request is tunnelled.
- SOCKS5 failures are named as the proxy's (since 1.2.0): rejected credentials (`UND_ERR_SOCKS5_AUTH_FAILED`) or a proxy that requires them (`UND_ERR_SOCKS5_AUTH_REJECTED`), and the proxy's reply when it could not reach the server: refused (`UND_ERR_SOCKS5_REPLY_5`), host or network unreachable (`_4`, `_3`), not allowed by its rules (`_2`).
- A proxy that inspects TLS presents its own certificate: add its CA with `NODE_EXTRA_CA_CERTS` as above.
- **The raw TLS check is inconclusive behind a proxy.** The tool opens its own TLS connection to measure the protocol version and the certificate chain (see [What the tool sends](privacy-and-requests.md)); that socket cannot go through an HTTP proxy, so for a proxied host the check is reported as inconclusive (info) with the reason instead of failing. Hosts listed in `NO_PROXY` are still checked. Re-run from a machine with direct access (a public CI runner) to get the TLS result.
- The client library's `ExperimentalWarning` about its proxy support is not printed; every other warning still is.
- Before 0.5.0 the proxy variables are ignored and the tool fails to connect (`connection refused` or `timed out`) on a network that only allows traffic through a proxy.

## WAF, Cloudflare and 403

A `403`, a challenge page ("Just a moment...", "Attention required") or a CAPTCHA in answer to the tool's requests is reported by the SRV rules as a WAF challenge. Claude's and ChatGPT's own clients would be blocked the same way if the rule matches them, so this is a real finding, not noise. Allow-list the traffic of the directory you target (the vendors publish their client IP ranges and user agents) or exempt the MCP path from bot protection. To check your own rules from a trusted network, add the header your WAF accepts: `--header "X-Allow: <value>"` (header values are redacted in the report).

## Timeouts and --max-duration

`--timeout <ms>` is per request (default 30000). `--max-duration <ms>` is the deadline for the whole run: when it runs out the report covers what ran and says in which phase it stopped. Exit 3 means it stopped before the handshake (an unreachable or very slow server), exit 4 after it (a slow server that did answer). In CI, `|| [ $? -eq 4 ]` lets a slow run pass while still failing on everything else ([CI and automation](ci.md)). A first request to a serverless server can take many seconds because of a cold start: warm it up with one request, or raise `--timeout`. The HTTP connect requests wait at most 15 s whatever `--timeout` is: a handshake that gets no answer in that time reads `initialize got no answer within <ms> ms`, and a server that answers nothing at all is reported as `no-answer` with its host and port.

## Exit 3 versus exit 4

| Exit | Meaning | Next step |
|---|---|---|
| 3 | No handshake: cannot reach the server, `--max-duration` ran out before the handshake, or (with `--fail-on-incomplete`) the check was partial, or the tool itself failed (`fatal:` on stderr) | Fix connectivity, the token or the URL |
| 4 | The handshake worked, then `--max-duration` stopped the run | Raise `--max-duration`, or find the slow tool or request in the report |

## Token rejected

`Server rejected the token (401)` means the token reached the server and was refused. Check, in this order: expiry, audience (the token must be issued for this server, the `resource` parameter), scopes, and that the token belongs to the environment you check (a staging token against production). With `--fail-on-incomplete` a rejected token exits 3 so CI does not stay green. See [Authentication](auth.md).

## A stdio server prints to stdout

On stdio the protocol uses the server's stdout. Anything else printed there (a banner, `console.log`, a framework's start message) corrupts the stream, and the check fails to start or reports parse errors. Write logs to **stderr** (`console.error`, `logging` to `sys.stderr`). The tool shows the server's stderr, redacted, when the start fails. If the server prints a banner you cannot remove, wrap it in a script that filters it, or fix the server: a directory reviewer's client has the same problem.

## Windows: quoting and paths

- Prefer the form with `--`: `--stdio -- node dist\server.js`. Nothing is split or re-quoted, and the arguments reach the server as written.
- The string form `--stdio "node dist/server.js"` splits on whitespace and honours single and double quotes. Backslashes are literal, so `--stdio "node C:\Users\me\server.js"` works; paths with spaces need quotes: `--stdio "node \"C:\My Tools\server.js\""` in cmd.exe, `--stdio 'node "C:\My Tools\server.js"'` in PowerShell.
- A `.cmd` or `.bat` launcher works, and its whole process tree is ended when the check ends.
- Environment variables for the server go through `--env K=V`; the server inherits only a short list of variables from your shell ([Options](options-and-config.md#options)).
- Write JSON for `--tool-args` with UTF-8; Windows PowerShell 5.1's UTF-16LE with a BOM is also read.

## Large servers and the snapshot budget

The tool caps what it reads so a hostile or huge server cannot exhaust memory: at most 100 pages of a listing, metadata strings over 16 KB and UI resources over 2 MB are truncated, and a run that has read 64 MiB of server data stops. What was cut is listed in the JSON report under `limits.truncated`. If your server has hundreds of tools, the report is long: use `--quiet` for the summary, `--format json` and filter with `jq`, `--target` to narrow the platforms, and a baseline ([CI and automation](ci.md)) so only changes show.

## How to report a false positive

1. `mcp-review-check explain <RULE-ID>`: the rationale and the sources. Many "wrong" findings are the documented criterion.
2. If the rule is a heuristic (a word list or a regex) and your server is fine, open an issue at <https://github.com/alisaosipova/mcp-review-check/issues> with the rule ID, the **redacted** line from the report and what the server really does. Do not paste tokens or private tool descriptions; the report is redacted but check it before you attach it.
3. Meanwhile `--ignore <RULE-ID>` drops it from the exit code and the score (it stays visible in the JSON under `ignored`), or put it in the baseline. Scores of runs with different `--ignore` lists are not comparable.

A security problem in the tool itself goes to the contact in [SECURITY.md](../../SECURITY.md), not into a public issue.
