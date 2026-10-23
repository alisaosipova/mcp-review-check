# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: [open a security advisory](https://github.com/OWNER/mcp-review-check/security/advisories/new). Do not open a public issue for a vulnerability.

Include the version (`mcp-review-check --version`), the command you ran (with tokens removed) and what happened. We will acknowledge the report, agree a disclosure date with you, and ship the fix in a patch release.

Only the latest published minor version receives security fixes while the project is 0.x.

## What the tool sends

`mcp-review-check` is a client that talks to the server you point it at. Knowing exactly what it sends helps you decide where to run it.

**By default** (no `--active` flags), against an HTTP target, about 20 requests, none of which is meant to change state:

- an `initialize` without credentials, `server/discover`, the SDK handshake and the list calls (`tools/list`, `resources/list`, `prompts/list` and so on), with your `--header` and `--bearer` values. Every connection declares the MCP Apps client capability (`io.modelcontextprotocol/ui`); when a tool links a UI, one extra connection without it lists the tools a text-only host sees;
- protocol probes: an unsupported protocol version, an unknown method, a `tools/call` for a tool named `mcp_review_check_nonexistent_tool`, a read of `mcp-review-check://does-not-exist`, a GET on the endpoint (aborted after the headers), a second `tools/list` and one fresh connection;
- **Origin probes**: `initialize` with `Origin: https://claude.ai`, `Origin: https://chatgpt.com` and a spoofed `Origin: https://evil.mcp-review-check.invalid`, to check DNS-rebinding protection;
- `GET /.well-known/openai-apps-challenge` on the server's origin;
- DNS lookups and a TLS handshake for the server host.

The preflight, Origin, challenge, OAuth metadata and invalid-token requests and the TLS handshakes are retried on timeouts, connection resets, 5xx and 429 (at most 3 attempts, a timeout only once, `Retry-After` honoured up to 5 s). `--active-auth` requests are never retried.

**When the server answers 401**, the OAuth probe also:

- fetches Protected Resource Metadata and authorization server metadata, **following the URLs the server advertises** (`resource_metadata` in `WWW-Authenticate`, `authorization_servers` in the metadata, up to 3 authorization servers);
- sends one `initialize` with the **invalid token** `Bearer mcp-review-check-invalid-token`, to check that the server rejects it;
- resolves and opens TLS connections to the advertised authorization server hosts.

Your `--bearer` token is sent only to the MCP server URL you entered, never to the authorization server or other advertised URLs.

**With `--active`**, the tool calls tools annotated `readOnlyHint: true` (at most 3 calls per tool) with arguments from `--tool-args` or synthesized from the input schema. Each call is cut off at `--timeout`, and never later than 241 s (just past Claude's documented 240 s tool call timeout). A server that mislabels a write tool as read-only will have that tool executed.

**With `--active-auth`**, the tool **registers a client through Dynamic Client Registration** (`client_name: mcp-review-check`, redirect URIs for claude.ai and localhost), then sends `/authorize` requests and a `/token` request with a bogus authorization code. The registered client stays on your authorization server; delete it afterwards if your server does not expire unused clients.

**With `--stdio`**, the tool starts the command you give it as a local process with your user's permissions (no shell is involved). Only run commands you would run yourself.

## Threat model and safe use

- **Do not run the tool against servers you do not trust from a privileged network.** The OAuth probe follows URLs chosen by the server. A malicious server can point those URLs at internal addresses (for example cloud metadata endpoints or admin panels reachable only from your network), and the tool will request them. Responses are parsed as JSON and summarized in the report. Run checks of unknown servers from an unprivileged machine or CI runner.
- **Treat reports as sensitive until reviewed.** One redactor scrubs the whole report in every format, and the `--verbose` output: `--header`, `--bearer` and `--env` values, secret-looking URL query parameters (decoded and as written) and `user:pass@` passwords, and stdio arguments after secret-looking flags (`--api-key X`, `--accessToken X`, `--clientSecret X`, `--token=X`, `API_KEY=X`, `Authorization: Bearer X`), also where the server echoes them on stdout or stderr. A flag, `KEY=` or query parameter name is secret-looking when any of its kebab-case, snake_case or camelCase segments is a secret sign (key, token, secret, password, auth, credential, api-key, bearer, cookie, session and similar): `--auth-header`, `--api-key-value`, `?client_secret=`, `?access-token=`; so is a name that ends in token, secret, password, credential or a key sign glued to the word before it (`--authtoken`, `--apitoken`, `--secretkey`, `GITHUBTOKEN`), and a stdio `Name: value` argument with such a header name (`X-Auth: …`). Names that point to a secret rather than hold it are not: they end in `-file`, `-path`, `-dir`, `-id`, `-name`, `-url`, `-type`, `-mode`, `-max`, `-limit`, `-timeout` and the like (`--token-file`, `--key-id`, `--auth-url`). The markdown `rerun:` line masks `--bearer`, `--header` and `--env` values and the URL credentials at any length. Usage errors never repeat option values. Reports still quote the stdio command line and server output (tool descriptions, error messages, stdio stderr), which can contain secrets the tool does not recognize. Known gaps:
  - a token passed as a bare positional argument, with no secret-looking flag before it, is not recognized;
  - the value right after a secret-looking flag is not recognized when it starts with `--` (`--token --abc...` is read as two flags); pass such a value as `--token=--abc...`.

  Review a report before attaching it to a public issue, PR comment or SARIF upload.
- **Prefer environment variables for tokens.** `--bearer` on the command line is visible in your shell history and to other local users via `ps`; `MCP_REVIEW_CHECK_TOKEN` is not.
- **No telemetry.** The tool sends nothing anywhere except to the server under test and the hosts that server advertises.

## Scope

In scope: the `mcp-review-check` CLI and its npm package, for example a secret that escapes redaction, a request the documentation does not list, or a crafted server response that makes the tool execute code or write files other than `--output` (and `$GITHUB_STEP_SUMMARY`, which it appends to when `GITHUB_ACTIONS=true`).

Out of scope: findings about third-party MCP servers (report those to their owners), and false positives or missed rejections (use the issue templates).
