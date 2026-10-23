# mcp-review-check: Implementation SPEC

Spec version 0.1. Rule catalog date 2026-10-22. Status: ready for implementation.

`mcp-review-check` is a CLI that connects to an MCP server, takes a snapshot of what the server exposes, and checks it against the public review criteria of the Claude connector directory, the ChatGPT plugin directory, and the MCP specification. It runs on Node 18, sends no telemetry, and links every rule to a public source. Checks that cannot be automated are printed as a manual checklist.

Non-goals for v1:
- Full JSON-schema conformance of every wire message. That is the job of `@modelcontextprotocol/conformance`, and the report may suggest running it.
- Linting listing or plugin manifests. Those items appear as manual checklist entries in v1.
- Rendering MCP Apps in a real host.
- Any call that could change state, unless the user opts in with `--active` or `--active-auth`.

---

## 1. Conventions

### 1.1 Platforms and targets
- Platform keys: `claude` (Anthropic connector directory), `chatgpt` (OpenAI plugin directory), `spec` (MCP spec, RFCs, and cross-host best practice).
- `--target claude` makes {claude, spec} active. `--target chatgpt` makes {chatgpt, spec} active. `--target all` (the default) makes all three active. `spec` rules always run.

### 1.2 Severity
- Levels: `error` > `warning` > `info`.
- **error**: the source gives a MUST, an explicit rejection criterion, or a portal error, **and** detection is deterministic.
- **warning**: a SHOULD, or any heuristic (regex or word-list) detection, even when the underlying policy is a MUST. This rule exists to avoid false positives.
- **info**: advice, a deprecation notice, or an observation.
- The catalog writes severity per platform, for example `claude=error, chatgpt=warning, spec=info`. A rule's platforms are the keys of that map.
- How the engine computes a finding:
  - `finding.platforms = (finding.platforms ?? rule.platforms) ∩ active`. If the intersection is empty, the finding is dropped.
  - `finding.severityByPlatform[p] = finding.severity ?? rule.severity[p]` for each p in `finding.platforms`, and `finding.severity = max(severityByPlatform)` (used for sorting, score and the exit code).
  - Per-platform verdicts count each finding at `severityByPlatform[platform]`, so a rule with `spec=error, chatgpt=warning` does not make ChatGPT `BLOCKED`. Reports annotate lower platforms, e.g. `[spec, chatgpt: warning]`.
  - A rule can emit findings for a subset of its platforms, or with a lower severity. Each such case is documented in the rule's "Detect" line.

### 1.3 Needs tags
Each rule declares the data it needs. When the snapshot lacks that data, the engine records the rule as **skipped** with a reason. Skipped rules are listed in the report coverage section, never as passed.

| Tag | Meaning |
|---|---|
| `tools` | tools/list succeeded |
| `resources`, `prompts` | the matching list succeeded |
| `ui` | at least one tool links a UI resource, or a `ui://` resource exists |
| `http` | HTTP target (not stdio) |
| `stdio` | stdio target |
| `auth` | the auth probe ran because an unauthenticated request got 401 or another auth signal |
| `legacy` / `modern` | detected protocol era (§4.4) |
| `active` | `--active` was given (calls read-only tools) |
| `active-auth` | `--active-auth` was given (DCR registration, /authorize and /token probes) |

### 1.4 Local mode
The snapshot sets `localMode = true` when the HTTP host is `localhost`, `*.localhost`, `127.0.0.0/8`, or `::1`, and for every stdio target. In local mode:
- SRV-001, SRV-004 and SRV-005 are downgraded to `info`, with the prefix "Deploy-time check:".
- The report header says "Local target: deploy-time checks are informational."

This lets developers lint before deploying without getting a wall of errors.

### 1.5 Shared helpers
These live in `src/rules/util/*` and are used by many rules. Each is defined once.
- **`tokenize(name)`**: split on `[_\-.\s/:]` and on camelCase or digit boundaries, then lowercase.
- **`firstVerb(name)`**: the first token that appears in `READ_VERBS ∪ WRITE_VERBS`.
- **Lexicon** (`lexicon.ts`): the union of the vocabularies from all researched sources.
  - `READ_VERBS` = get, list, search, find, read, fetch, query, lookup, describe, show, view, count, check, browse, retrieve, export, download, summarize, resolve, inspect, preview.
  - `WRITE_VERBS` = create, add, insert, update, edit, modify, set, patch, put, post, publish, send, upload, write, save, submit, book, reserve, order, pay, purchase, transfer, enqueue, queue, schedule, start, run, trigger, execute, invite, share, move, rename, import, sync, reset, archive, cancel, revoke, delete, remove, drop, destroy, purge, wipe, overwrite, replace, disable, deactivate, unsubscribe, refund, close, terminate, erase, truncate, merge, approve, reject, assign.
  - `HARD_DESTRUCTIVE` = delete, remove, drop, destroy, purge, wipe, overwrite, erase, truncate.
  - `IRREVERSIBLE` = HARD_DESTRUCTIVE ∪ {replace, cancel, revoke, disable, deactivate, unsubscribe, send, pay, transfer, refund, close, terminate, reset}.
- **`corpus(snap)`**: a list of `{text, where, tool?, path?}` entries. `where` is one of `tool.name`, `tool.title`, `tool.annotations.title`, `tool.description`, `param.description` (with a JSON pointer), `instructions`, `prompt.description`, `prompt.argument.description`, `resource.description`, or `resourceTemplate.description`. Hidden-character scans run on the raw text. Regex scans run on the NFKC-normalized text.
- **`walkSchema(schema, visit)`**: recursive walk through `properties`, `items`, `prefixItems`, `additionalProperties` (when it is an object), `anyOf/oneOf/allOf/not/if/then/else`, `$defs/definitions`, and local `$ref` targets (`#/...`). It yields `{path, name, node}` with cycle protection and a depth cap of 64. Property names are normalized to lowercase snake_case for name matching.
- **`extractOrigins(html)`**: regex-based, no DOM dependency.
  - Returns `{kind: 'resource'|'connect'|'frame'|'base'|'navigate', origin, evidence, confidence: 'tag'|'js'}`.
  - `tag` confidence (the URL sits in a tag attribute):
    - `<script src>`, `<link href rel=stylesheet|preload|icon|modulepreload>`, `<img src/srcset>`, `<source src>`, `<video|audio src>`, `@import`, CSS `url()`, `@font-face src` → resource
    - `<iframe src>` → frame
    - `<base href>` → base
  - `js` confidence (literal https/wss URL as the first argument):
    - `fetch(`, `new WebSocket(`, `new EventSource(`, `.open('GET', ...)`, `axios.*(` / `ky(` → connect
    - `openExternal(` and `ui/open-link` → navigate
  - `data:`, `blob:` and relative URLs are ignored.
- **`originMatches(origin, entry)`**: exact match on scheme, host and port, plus `https://*.example.com` wildcard subdomains.
- **`net.ts`**:
  - `isNonPublicIPv4/6`: covers 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4, ::1, fc00::/7, fe80::/10, and IPv4-mapped addresses.
  - `registrableDomain(host)`: last two labels, or three when the suffix is in a built-in multi-label list (co.uk, com.au, co.jp, com.br, co.nz, ...) or in `SHARED_HOST_SUFFIXES` (vercel.app, netlify.app, workers.dev, pages.dev, herokuapp.com, onrender.com, fly.dev, azurewebsites.net, run.app, github.io, railway.app, replit.app, ngrok.app, ngrok-free.app, ngrok.io, trycloudflare.com, loca.lt, devtunnels.ms).
  - This is not the full Public Suffix List. Only `info` and `warning` rules depend on it, which keeps the dependency count low.
- **`parseWwwAuthenticate(header)`**: RFC 9110 challenge-list parser. Returns `[{scheme, params}]` with case-insensitive scheme and param names and support for quoted strings. We write our own because the SDK's `extractWWWAuthenticateParams` returns only some params.
- **`isGenericError(text)`**: `/^(error|internal (server )?error|bad request|an? (unknown|unexpected) error( occurred)?|something went wrong|invalid (input|request|params|arguments)|failed|request failed|500|400|undefined|null|\[object Object\])\.?$/i`, or empty. Short but specific messages ("month required") are not generic.
- **`toolKind(tool)`**: the shared read/write classifier. `readOnlyHint: true` → read; `readOnlyHint: false` or `destructiveHint: true` → write; otherwise the first verb of the name (READ_VERBS → read, WRITE_VERBS → write), else unknown. TOOL-008, TOOL-015, TOOL-027 and TOOL-028 use it.
- **`displayUrl(url)`**: the entered URL for reports, with secret query values redacted and `user:pass@` removed. Every output format and every message that shows the target URL uses it.

Thresholds marked *(linter-defined)* in the catalog are our own choices. No source documents them.

---

## 2. Rule catalog

Each entry has: ID, title, severity per platform (the keys are the platforms it applies to), Needs, Detect, Why, Fix, and Source. IDs are stable and are never reused after removal. Categories:
- **SRV**: endpoint and deployment
- **SPEC**: protocol and wire conformance
- **TOOL**: tool metadata and schemas
- **INJ**: prompt injection and model manipulation
- **DATA**: data collection
- **POL**: unsupported use cases and commercial content
- **APPS**: MCP Apps and widgets
- **AUTH**: OAuth and authorization
- **RT**: runtime checks (opt-in)
- **MAN**: manual checklist

### 2.1 SRV: endpoint and deployment

**SRV-001 Remote server served over HTTPS.** Severity: claude=error, chatgpt=error. Needs: http.
- Detect: `new URL(urlAsEntered).protocol !== 'https:'` → error. In local mode it is info (§1.4).
- Why: both directories accept only `https://` URLs.
- Fix: deploy behind TLS with a publicly trusted certificate.
- Source: https://claude.com/docs/connectors/building/submission, https://developers.openai.com/plugins/build/mcp-server

**SRV-002 Local stdio server cannot be submitted as a remote connector.** Severity: claude=info, chatgpt=info. Needs: stdio.
- Detect: the target is `--stdio`.
- Message for claude: "Directory no longer accepts local MCPB servers; distribute via a plugin."
- Message for chatgpt: "Requires a public HTTPS Streamable HTTP endpoint."
- Why: local servers go through a different channel. This is info, not error, because linting locally before deploy is a valid workflow.
- Fix: deploy remotely, or package the server as a Claude plugin.
- Source: https://claude.com/docs/connectors/building/submission

**SRV-003 Streamable HTTP transport available.** Severity: claude=warning, chatgpt=warning, spec=warning. Needs: http.
- Detect:
  - SSE-only (legacy HTTP+SSE fallback succeeded, Streamable HTTP POST got 400/404/405 with no modern JSON-RPC error body) → warning "legacy HTTP+SSE only".
  - Neither transport works → **error**, emitted by the connector as a fatal finding (exit code 3).
  - A stdio server that does not start → **error** for `spec` only, with a stdio-specific fix (a local launch failure is not a directory blocker). The connect message keeps the first error-looking stderr line plus the last line; HTML bodies in HTTP connect errors are stripped and the HTTP status is shown.
  - A 401 on POST counts as a pass for transport.
- Why: SSE has been deprecated since 2025-03-26, and both directories expect Streamable HTTP.
- Fix: serve Streamable HTTP at the registered URL.
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy, https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http

**SRV-004 Hostname resolves to public IPv4.** Severity: claude=error, chatgpt=error. Needs: http.
- Detect: run `dns.promises.resolve4` and `resolve6` on the MCP host, and on the authorization server host when the auth probe ran.
  - No A record → claude error ("Connectors are IPv4-only"). For chatgpt this case is info.
  - Any A or AAAA record in a non-public range (§1.5) → error for both. Mixed public and private also fails.
  - In local mode this is info.
  - The message notes that the result comes from the system resolver.
- Why: Claude reaches connectors over IPv4 only. Private addresses are unreachable from both hosts.
- Fix: publish public A records.
- Source: https://claude.com/docs/connectors/building/troubleshooting

**SRV-005 Temporary tunnel or shared hosting domain.** Severity: chatgpt=error, claude=warning.
- Detect:
  - Host under a tunnel suffix (ngrok.io, ngrok.app, ngrok-free.app, trycloudflare.com, loca.lt, localtunnel.me, serveo.net, *.devtunnels.ms) → chatgpt error, claude warning.
  - Host under a shared platform suffix (vercel.app, netlify.app, workers.dev, herokuapp.com, onrender.com, fly.dev, azurewebsites.net, run.app) → claude info only: "MCP server domain should match your service".
  - In local mode this is info.
- Why: ChatGPT forbids tunnels for public submission. Claude expects the server domain to match the service domain.
- Fix: serve the endpoint from your own domain.
- Source: https://developers.openai.com/plugins/build/mcp-server, https://claude.com/docs/connectors/building/review-criteria

**SRV-006 No cross-host redirect at the registered URL.** Severity: claude=error. Needs: http.
- Detect: run preflight POST initialize and GET with `redirect: 'manual'`.
  - Status in {301, 302, 307, 308} and `new URL(location, url).host !== url.host` → error.
  - Same-host redirect, for example a trailing slash → claude warning: "register the final URL".
- Why: Claude drops the Authorization header on a cross-host redirect.
- Fix: register the final URL, or serve MCP directly at the entered URL.
- Source: https://claude.com/docs/connectors/building/troubleshooting

**SRV-007 Host-header (DNS-rebinding) protection rejects the public hostname.** Severity: claude=error, chatgpt=error. Needs: http.
- Detect: any probe gets 403 with a body matching `/Invalid Host/i`.
- Why: the SDK's `createMcpExpressApp` default `allowedHosts` permits only localhost, so every request from the host fails.
- Fix: add the public hostname to `allowedHosts`.
- Source: https://claude.com/docs/connectors/building/testing

**SRV-008 Origin header handling.** Severity: claude=warning, chatgpt=warning, spec=error. Needs: http.
- Detect, part (a): POST initialize with `Origin: https://claude.ai` and with `Origin: https://chatgpt.com`.
  - 403 while the same request without Origin succeeds → warning for that platform: "overly strict Origin validation".
- Detect, part (b): POST with `Origin: https://evil.mcp-review-check.invalid`.
  - Accepted (2xx) on a loopback target → spec **error** (DNS rebinding).
  - Accepted on a public target → spec **info** only, because a public server may treat all origins as valid.
- Why: the spec requires a 403 for an invalid Origin, but hosts send their own Origin values.
- Fix: validate Origin against an allowlist that includes the host origins.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http

**SRV-009 Bot challenge or WAF signature in responses.** Severity: claude=warning, chatgpt=warning. Needs: http.
- Detect: any exchange matching one of:
  - header `cf-mitigated: challenge`
  - HTML body containing "Just a moment..."
  - 403 or 429 with `server: cloudflare|akamai*` and a non-JSON body
  - 403 `text/plain` with no `WWW-Authenticate` on every endpoint, including well-known ones
- Why: directory crawlers and hosts cannot pass bot challenges.
- Fix: allowlist host egress. Anthropic's egress range is `160.79.104.0/21`. A manual reminder covers this as well.
- Source: https://claude.com/docs/connectors/building/authentication

**SRV-010 Handshake and listing latency.** Severity: chatgpt=info. Needs: http.
- Detect: timings of initialize (or server/discover), tools/list, and UI resources/read.
  - Median over 500 ms → info.
  - Any single call over 5 s → **warning** (finding-level override).
- Why: OpenAI notes that components feel sluggish above a few hundred milliseconds.
- Fix: cache metadata and keep list handlers cheap.
- Source: https://developers.openai.com/plugins/deploy/troubleshooting

**SRV-011 Server name ends with "MCP", "MCP Server" or "Plugin".** Severity: chatgpt=warning.
- Detect: `serverInfo.title` matches `/(\b|[\s_-])(mcp([\s_-]?server)?|plugin)\s*$/i` → warning. The same match on `serverInfo.name` only → info, because package-style names like `acme-mcp` are common and are not the listing name.
- Do **not** apply this to tool names. No source forbids "mcp" inside tool names.
- Fix: use the bare product name.
- Source: https://developers.openai.com/plugins/plugin-guidelines

**SRV-012 Overly generic single-word name.** Severity: chatgpt=info.
- Detect: `serverInfo.title ?? name` is a single token in {search, travel, notes, chess, weather, calendar, tasks, assistant, helper, tools, files, docs, mail, chat}, compared case-insensitively.
- Fix: tie the name to your brand.
- Source: https://developers.openai.com/plugins/plugin-guidelines

**SRV-013 serverInfo present with name and version.** Severity: spec=error.
- Detect:
  - Legacy era: `initialize.serverInfo` is missing → error. `name` or `version` is not a non-empty string → error.
  - Modern era: `_meta['io.modelcontextprotocol/serverInfo']` is missing on server/discover → **warning**. Present but malformed → error.
- Source: https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle

**SRV-014 Server instructions quality.** Severity: chatgpt=warning, spec=info.
- Detect:
  - `instructions.length > 512` → chatgpt **info**: key guidance belongs in the first 512 characters.
  - 3 or more tool descriptions longer than 40 characters appear verbatim inside the instructions → chatgpt warning, spec info.
  - `instructions === ''` → spec info.
- The instructions are also part of the INJ, POL and DATA corpus.
- Source: https://developers.openai.com/plugins/build/mcp-server

**SRV-015 Server depends on features Claude does not support.** Severity: claude=info.
- Detect any of:
  - `capabilities.resources.subscribe === true`
  - `capabilities.experimental` is non-empty
  - `capabilities.tasks` is present
  - the corpus mentions `sampling/createMessage` or "sampling"
- Source: https://claude.com/docs/connectors/building

**SRV-016 ChatGPT domain-verification file format.** Severity: chatgpt=info. Needs: http.
- Detect: GET `https://<host>/.well-known/openai-apps-challenge`. Report only if it returns 200 and has one of these problems: JSON Content-Type, multiple lines, or internal whitespace. A 404 produces no finding.
- Fix: return only the exact token as text/plain.
- Source: https://developers.openai.com/plugins/deploy/submission

**SRV-017 Canonical server URL form.** Severity: spec=warning, claude=info. Needs: http.
- Detect:
  - URL has a fragment → spec **error**.
  - Uppercase scheme or host, an explicit default port, a query component, or a trailing slash on a non-root path → spec warning.
  - The entered URL differs from its canonical form → claude info: "Tokens should accept the canonical `aud`; PRM `resource` and `ui.domain` hash use the URL exactly as entered." The canonical form of a bare origin has no `/` path, and a root `/` alone is not reported.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#canonical-server-uri, https://claude.com/docs/connectors/building/troubleshooting

**SRV-018 stdio server writes non-MCP output to stdout.** Severity: spec=error. Needs: stdio.
- Detect: the SDK `StdioClientTransport` raises a parse error through `transport.onerror` / `client.onerror` (its ReadBuffer fails on non-JSON). Capture these errors and report the first three offending lines, truncated to 120 characters.
- Fix: log to stderr.
- Source: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports

**SRV-019 tools/list stable across calls and connections.** Severity: spec=warning.
- Detect:
  - List all pages twice on the same connection. Same set in a different order → **info** (deterministic order is a SHOULD). A failed second list (for example rate limiting) is not compared.
  - List once more on a fresh connection with the same credentials. Different name sets → warning.
  - This is a warning, not an error, because feature flags or time-based changes can cause legitimate differences.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/server/tools#capabilities

**SRV-020 Protocol era report.** Severity: spec=info. Always emitted for HTTP targets.
- Message: `era: modern|legacy|dual|sse-legacy`, plus the negotiated version.
  - Legacy-only: "2026-07-28 clients fall back to initialize. Not a defect."
  - Dual-era where `server/discover.supportedVersions` omits the legacy versions it still accepts: add a note.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle

### 2.2 SPEC: protocol and wire conformance
These rules are evaluated over recorded HTTP exchanges (§4.3). Era tags decide which rules apply.

**SPEC-001 initialize result shape.** Severity: spec=error. Needs: legacy.
- Detect any of:
  - `protocolVersion` is not a string, `capabilities` is not an object, or `serverInfo` is missing
  - the server answered with a different version even though it supports the requested `2025-11-25` (it lists that version in its error data or elsewhere)
  - `instructions` is present but not a string
- Source: https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle

**SPEC-002 Capabilities declared for served primitives.** Severity: spec=error.
- Detect:
  - tools/list (also tried when the capability is absent) returns ≥1 tool while `capabilities.tools` is absent → error. The same applies to resources and prompts.
  - `listChanged` is present but not a boolean → **warning**.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/server/tools#capabilities

**SPEC-003 Request responses use application/json or text/event-stream.** Severity: spec=error. Needs: http.
- Detect: any 2xx response to a POSTed JSON-RPC request whose media type (lowercased, parameters stripped) is neither of the two. This includes the SDK's `StreamableHTTPError` code -1.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http

**SPEC-004 Notification POST returns 202 with no body.** Severity: spec=error. Needs: http, legacy.
- Detect: inspect the exchange for `notifications/initialized`, which the SDK sends and the trace captures.
  - Pass: status 202 with an empty body.
  - Fail: any other 2xx, or 202 with a body.
  - A 4xx with a JSON-RPC error is accepted.
- Source: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports

**SPEC-005 GET on the MCP endpoint.** Severity: spec=warning. Needs: http.
- Detect: GET with `Accept: text/event-stream`, plus session headers when they exist. Abort after the headers arrive (5 s cap).
  - Legacy: pass on 200 `text/event-stream` or 405. A 400 without a session is accepted. Anything else → warning.
  - Modern-only: pass on 405 only.
- Source: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports

**SPEC-006 Mcp-Session-Id format.** Severity: spec=error. Needs: http.
- Detect:
  - Value does not match `/^[\x21-\x7E]+$/` → error.
  - Length under 16 → **info** *(linter-defined)*.
  - A modern-only server mints or echoes a session id → **warning** (see SPEC-015).
- Source: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports

**SPEC-007 Unsupported protocol version rejected.** Severity: spec=error. Needs: http.
- Legacy: tools/list with `MCP-Protocol-Version: 1900-01-01` and the valid session id. Expect status 400; otherwise **warning**.
- Modern: server/discover with header and `_meta` version `1900-01-01`. Expect 400 with `error.code === -32022` and `error.data.supported` as a string[]; otherwise error.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http

**SPEC-008 Unknown method → -32601.** Severity: spec=error. Needs: http or stdio.
- Detect: send method `mcp-review-check/nonexistent`.
  - Modern: expect HTTP 404 with `error.code === -32601`; otherwise error.
  - Legacy and stdio: `error.code !== -32601` → **info**, a JSON-RPC deviation. Example: DeepWiki returns -32602.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http, https://www.jsonrpc.org/specification

**SPEC-009 Unknown tool → JSON-RPC protocol error.** Severity: spec=warning. Needs: tools.
- Detect: `tools/call` with name `mcp_review_check_nonexistent_tool`. A result, with or without `isError`, → warning. Calling a non-existent tool has no side effects. A -32020/-32021/-32022 header rejection of the probe is not a result and is not reported.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/server/tools#error-handling

**SPEC-010 Resource not found → error, never empty contents.** Severity: spec=error. Needs: resources.
- Detect: `resources/read` of `mcp-review-check://does-not-exist`.
  - A result with `contents: []` → error.
  - Modern: the code must be -32602. A -32020/-32021/-32022 answer rejects the probe's headers, not the missing resource, and is inconclusive (no finding).
  - Legacy: -32002 or -32602 is accepted. Any other code → **info**.
  - 2026-07-28 requests carry `Mcp-Name` (params.name for tools/call and prompts/get, params.uri for resources/read, subscribe and unsubscribe) in addition to `Mcp-Method`.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/server/resources#error-handling

**SPEC-011 server/discover result.** Severity: spec=error. Needs: modern.
- Detect: `supportedVersions` is not a non-empty string[], `capabilities` is not an object, or `instructions` is present but not a string.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/server/discover

**SPEC-012 resultType on every result.** Severity: spec=error. Needs: modern.
- Detect: any modern success result where `resultType` is not a string → error. A value other than `complete` or `input_required` → **warning**.
- Source: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts

**SPEC-013 Caching hints on cacheable results.** Severity: spec=error. Needs: modern.
- Applies to results with `resultType: complete` from server/discover, tools/list, prompts/list, resources/list, resources/templates/list, and resources/read.
- Detect:
  - `ttlMs` is not a finite number ≥ 0 → error.
  - `cacheScope` is not in {public, private} → error.
  - `cacheScope` differs between pages of the same list → error.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching

**SPEC-014 Header/body mismatch rejected with -32020.** Severity: spec=error. Needs: modern.
- Detect: tools/list without the `Mcp-Method` header, then again with `Mcp-Method: prompts/list`. Each must get 400 with `error.code === -32020`.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#server-validation

**SPEC-015 No sessions in modern-only servers.** Severity: spec=warning. Needs: modern (only when not dual-era).
- Detect: the response echoes or mints `Mcp-Session-Id`, or GET or DELETE returns something other than 405.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#earlier-streamable-http-revisions

**SPEC-016 JSON-RPC error codes and ids valid.** Severity: spec=error.
- Detect, over every observed error:
  - `code` is not an integer → error.
  - Only for responses to 2026-07-28 requests (`observedError.modern`, or era `modern` when unknown): code in [-32099, -32020] but not one of -32020/-32021/-32022 → error, and -32002 or -32042 → error ("removed in 2026-07-28"). 2025-11-25 defines -32042 (URL elicitation required) and predates the range policy, so legacy responses get only the integer and id checks.
  - Response `id` differs from the request id and is not `null` → **warning**. Example: DeepWiki returns `"server-error"`.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic#error-codes, https://www.jsonrpc.org/specification

**SPEC-017 Icons well-formed.** Severity: spec=warning.
- Applies to `icons` on serverInfo, tools, resources and prompts.
- Detect:
  - `src` is neither an HTTP(S) URL nor a `data:image/...;base64,` URI → warning. An `http:` src → **info** (valid per the schema; hosts may not load it).
  - `mimeType` outside png, jpeg, jpg, svg+xml or webp: another `image/*` type → **info** (the schema lists these only as examples); a non-image type → warning.
  - A `sizes` entry does not match `/^(\d+x\d+|any)$/`.
  - `theme` is not `light` or `dark`.
- Source: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts

**SPEC-018 `_meta` key syntax and reserved prefixes.** Severity: spec=warning.
- Applies to every `_meta` object on tools, resources, prompts and results.
- Detect:
  - The prefix's second label is `modelcontextprotocol` or `mcp`, and the key is not on the allowlist (`io.modelcontextprotocol/serverInfo`, `io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientInfo`, `io.modelcontextprotocol/clientCapabilities`, `io.modelcontextprotocol/subscriptionId`, `io.modelcontextprotocol/ui`, `io.modelcontextprotocol/related-task`, `io.modelcontextprotocol/logLevel`). An unknown `io.modelcontextprotocol/*` key → **info** (official extensions add keys there); other prefixes with a reserved second label stay warnings.
  - The name violates `/^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/`.
  - A prefix label violates `/^[A-Za-z]([A-Za-z0-9-]*[A-Za-z0-9])?$/`.
  - The keys `ui`, `openai/*` and `mcp/www_authenticate` are valid.
- Source: same as SPEC-017.

**SPEC-019 SSE responses disable proxy buffering.** Severity: spec=info. Needs: http.
- Detect: a `text/event-stream` response without `X-Accel-Buffering: no`.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http

**SPEC-020 List methods for declared capabilities succeed.** Severity: spec=error, claude=error, chatgpt=error.
- Detect: `tools/list`, `resources/list` or `prompts/list` failed (JSON-RPC error, crash, timeout, repeated cursor, more than 100 pages) while the matching capability is declared (for tools, also when the era is `modern`) → error. `resources/templates/list` is not checked: many servers with the resources capability do not implement it.
- When `tools/list` failed, `coverage.toolLevel` is `list-failed`, the skip reason names the error, and the report prints a notice that tool checks could not run.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/server/tools#listing-tools, https://modelcontextprotocol.io/specification/2026-07-28/server/resources#listing-resources

### 2.3 TOOL: tool metadata and schemas
All TOOL rules need `tools`. The message names `tool.name`.

**TOOL-001 Tool name characters and length.** Severity: spec=warning.
- Detect: the name does not match `/^[A-Za-z0-9_.-]{1,128}$/`. List the offending characters. A non-string name → **error**.
- Fix: rename using only letters, digits, `_`, `-` and `.`.
- Source: https://modelcontextprotocol.io/specification/2025-11-25/server/tools

**TOOL-002 Tool name at most 64 characters.** Severity: claude=error.
- Detect: `[...name].length > 64`.
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy

**TOOL-003 Tool names unique.** Severity: chatgpt=error, spec=warning.
- Detect: exact duplicates across all pages → finding. Names that are equal only when compared case-insensitively → **info**.
- Source: https://developers.openai.com/plugins/plugin-guidelines, https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool-names

**TOOL-004 Promotional or comparative tool name.** Severity: chatgpt=warning.
- Detect, over the tokens of name and title:
  - a token in {best, top, official, ultimate, premium, recommended, preferred, number1, no1, greatest, perfect, superior, leading}
  - a name matching `/(use_?me|pick_?me|choose_?me)/i`
- Source: https://developers.openai.com/plugins/plugin-guidelines

**TOOL-005 Opaque tool name.** Severity: chatgpt=info.
- Detect any of:
  - `/^(tool|fn|func|op|action|cmd|handler|endpoint)[_-]?\d+$/i`
  - a hex run `/[0-9a-f]{8,}/i` or a UUID
  - a single token shorter than 3 characters
  - no token from `READ_VERBS ∪ WRITE_VERBS ∪ {render, open, calculate, convert, generate, analyze, compare, translate}`
- Source: https://developers.openai.com/plugins/plugin-guidelines

**TOOL-006 Tool has a title.** Severity: claude=error, spec=info.
- Detect: `t = tool.title ?? tool.annotations?.title`. Not a non-empty trimmed string → finding. Both set and different → spec **info** ("title wins").
- Fix: add `title` (top level, or in `annotations.title`).
- Source: https://claude.com/docs/connectors/building/review-criteria

**TOOL-007 Tool has a description.** Severity: chatgpt=error, claude=warning, spec=info.
- Detect: `description` is missing, not a string, or empty after trimming.
- Source: https://developers.openai.com/plugins/plugin-guidelines, https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy

**TOOL-008 Description too thin, generic or overloaded.** Severity: claude=warning, chatgpt=warning.
- Detect (all checks are skipped when TOOL-007 already fired):
  - fewer than 6 words **and** fewer than 40 characters → chatgpt finding
  - fewer than 20 characters → claude finding
  - equals the name
  - its words are a subset of the name tokens plus {a, an, the, this, tool, to, for}
  - matches `/^(makes? a request|calls? the api|does stuff|utility|helper|tool)\.?$/i`
  - longer than 1024 characters → claude **info** (it may be mixing purposes)
  - a tool that `toolKind` (§1.5) does not classify as read, whose description matches none of `/(creat|updat|delet|send|modif|chang|writ|sav|cancel|remov|post|upload)/i` → chatgpt **info** ("mention side effects"). The message says "write tool" only when `readOnlyHint: false` or `destructiveHint: true`, otherwise "tool without readOnlyHint".
- Source: https://developers.openai.com/plugins/plan/tools, https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy

**TOOL-009 Every input parameter has a description.** Severity: chatgpt=info, claude=info.
- Detect: `walkSchema` finds a property (nested ones included) with no non-empty `description`. Emit one finding per tool listing up to 10 paths.
- *(linter-defined)* best practice: no directory requires parameter descriptions, so this is info only.
- Source: https://developers.openai.com/plugins/plan/tools

**TOOL-010 Annotation field types.** Severity: spec=error.
- Detect any of:
  - `annotations` present but not an object
  - `title` present but not a string
  - any of the four hints present but not a boolean (for example the string `"true"`)
- Source: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts

**TOOL-011 Claude: readOnlyHint or destructiveHint declared.** Severity: claude=error.
- Detect:
  - Neither `readOnlyHint` nor `destructiveHint` is a boolean → error.
  - `readOnlyHint === false` and `destructiveHint` is absent → **warning** ("make it explicit").
- Fix: read-only tools get `readOnlyHint: true`. Tools that modify or delete data get `destructiveHint: true`.
- Source: https://claude.com/docs/connectors/building/submission

**TOOL-012 ChatGPT: readOnlyHint, destructiveHint and openWorldHint all explicit booleans.** Severity: chatgpt=error.
- Detect: each of the three keys missing or not a boolean gets its own finding (portal error `annotations_required`). Spec defaults do **not** count as values. `idempotentHint` is optional.
- Source: https://developers.openai.com/plugins/plugin-guidelines

**TOOL-013 Contradictory annotations.** Severity: chatgpt=error, claude=warning, spec=warning.
- Detect:
  - `readOnlyHint === true && destructiveHint === true` → finding.
  - `readOnlyHint === true && idempotentHint !== undefined` → spec **info** (the hint is meaningless there).
- Source: https://developers.openai.com/plugins/plugin-guidelines, https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts

**TOOL-014 Annotations likely do not match behavior (heuristic).** Severity: claude=warning, chatgpt=warning, spec=warning.
- Detect, using `v = firstVerb(name)`:
  - (a) `readOnlyHint === true` and (v ∈ WRITE_VERBS, or the description matches `/\b(creates?|updates?|deletes?|removes?|sends?|posts?|uploads?|writes?|saves?|submits?|schedules?|triggers?|enqueues?|persists?|modif(y|ies)|overwrites?|permanently)\b/i`).
  - (b) v ∈ HARD_DESTRUCTIVE and `destructiveHint !== true`.
  - (c) v ∈ READ_VERBS and `destructiveHint === true`.
  - (d) chatgpt only: `readOnlyHint === false && destructiveHint === false` and (some token ∈ IRREVERSIBLE, or the description matches `/\b(irreversibl|permanent|cannot be undone|overwrite|send(s)? (an? )?(email|message|sms))/i`). "undo", "restore" or "trash" wording does not suppress this.
  - (e) spec only: v ∈ READ_VERBS and `readOnlyHint` is absent ("treated as destructive and open-world by default").
- Why: hints decide auto-permissions. Reviewers check that they are accurate.
- Fix: correct the hints, or rename the tool.
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy, https://developers.openai.com/plugins/plugin-guidelines

**TOOL-015 openWorldHint false on an open-ended tool (heuristic).** Severity: chatgpt=warning.
- Detect: `openWorldHint === false` and one of:
  - some name token ∈ {web, browse, crawl, scrape, url}
  - a write tool (`toolKind`) with a name token ∈ {tweet, publish, email, sms, webhook, message, mail, notify}. Reading the user's own mailbox is a bounded private account.
  - a string property named `/^(url|uri|href|link|endpoint|webhook(_url)?|host|hostname)$/i`, or with `format: 'uri'`, that has no enum or pattern
  - on such a sending tool only: a recipient property `/^(to|recipients?|email_to|cc|bcc|phone(_number)?)$/i` or `format: 'email'`
  - properties with `format` date, date-time, time or duration are skipped (a `from`/`to` date range is not a target).
- Using a hosted SaaS backend alone is not a trigger: a tool confined to a bounded private account may use `false`.
- Source: https://developers.openai.com/plugins/plugin-guidelines

**TOOL-016 inputSchema present with root type "object".** Severity: spec=error.
- Detect: `inputSchema` is missing, null, not a plain object, or `type !== 'object'`. `['object', 'null']` also fails.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool

**TOOL-017 Schemas valid for their dialect.** Severity: spec=error.
- Detect: validate `inputSchema` and `outputSchema` against the meta-schema with one cached Ajv2020 instance (`strict: false`, `addUsedSchema: false`); use cached draft-07 or 2019 instances when `$schema` names those dialects. A meta-schema error → error. An invalid `pattern` or `patternProperties` regex (compiled with the `u` flag, as Ajv does) → error "does not compile". Full code generation is not run (it cost ~30 ms per large schema). An unknown `$schema` dialect → **warning**.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic#json-schema-usage

**TOOL-018 Parameterless tool should set additionalProperties:false.** Severity: spec=info.
- Detect: no properties, no composition keywords, and `additionalProperties !== false`.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool

**TOOL-019 No network $ref.** Severity: spec=warning.
- Detect: a `$ref` or `$dynamicRef` that resolves (against `$id`) to an absolute URI outside the document.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic#ref-resolution

**TOOL-020 Schema complexity bounded.** Severity: spec=info.
- Detect: depth over 10 or more than 200 subschemas *(linter-defined)*.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic#composition-keyword-resource-use

**TOOL-021 x-mcp-header constraints.** Severity: spec=error.
- Detect, for every node with `x-mcp-header`:
  - (a) the value is not an RFC 9110 token `/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/`
  - (b) the value is duplicated within the tool (compared case-insensitively)
  - (c) the property type is not string, integer or boolean
  - (d) the path from the root is not a pure `properties/<name>` chain (it goes through items, combinators, `$defs` or `$ref`)
- Message: "Streamable HTTP clients will drop this tool."
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#schema-extension

**TOOL-022 x-mcp-header on a sensitive parameter.** Severity: spec=warning.
- Detect: the property name or header value matches `/pass(word)?|secret|token|api[_-]?key|auth|credential|ssn|email|phone/i`, or `format` is `password` or `email`.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/server/tools#x-mcp-header

**TOOL-023 Catch-all HTTP tool mixing safe and unsafe methods.** Severity: claude=error.
- Detect: walk the properties. Find a property named `/^(method|http_?method|verb|request_?method)$/i`.
  - Its `enum`, or its `oneOf`/`anyOf` const values, includes one of GET/HEAD/OPTIONS **and** one of POST/PUT/PATCH/DELETE (case-insensitive) → error.
  - The property is a free string (no enum or pattern) and the tool name matches `/(api|http|rest|raw)_?(request|call|query)|^request$|^call_api$|^fetch_api$/i` → **warning**.
  - The name matches that pattern but there is no method property → **info**.
- Documenting which methods are safe in the description does not satisfy the rule.
- Fix: split into a read-only tool plus write tools (create/update/delete).
- Source: https://claude.com/docs/connectors/building/review-criteria

**TOOL-024 Operation enum mixing read and write, or many modes.** Severity: claude=warning, chatgpt=warning.
- Detect: find a property named `/^(action|operation|op|mode|command)$/i` whose enum values (tokenized) are verbs. `type` is not checked: it usually names a data type (Redis `list`, `set`).
  - Values include a READ verb **and** a WRITE verb → warning (word-list detection, §1.2; TOOL-023 keeps the error for explicit HTTP-method enums). For `mode`, verbs that double as common nouns (list, set, order, post, share, schedule, queue, book, archive, export, import, view, count, check, preview, run, start) do not count.
  - Values span two or more of the groups {create, add, insert}, {update, edit, patch, set}, {delete, remove, destroy} → claude **info** ("split by action type").
  - Four or more verb values → chatgpt warning.
  - Enums with no verb values (for example entity types) are ignored. This guards against false positives.
- Source: https://claude.com/docs/connectors/building/review-criteria, https://developers.openai.com/plugins/plugin-guidelines

**TOOL-025 Generic executor or operation dispatcher.** Severity: chatgpt=error.
- Detect (error only when both the discovery tool and the free-form args object are present; name-only matches are warnings):
  - (b) The server exposes a discovery tool `/^(list|get|describe|search)_(operations|actions|endpoints|schemas?|apis|commands|tools)$/i` **and** a tool that takes an operation-id string plus a free-form args object (an object without properties, or `additionalProperties: true`) → error.
  - (a) The name matches `/^(execute|exec|run|invoke|call|dispatch|perform|proxy|request|http|api|graphql|sql|query)([_-]?(api|operation|action|endpoint|request|command|tool|method|query))?$/i` or contains `execute_operation|call_api|run_action|invoke_endpoint`, **and** it has a free string property `/^(operation(_?id)?|action|method|endpoint|path|url|command|tool(_name)?|function)$/i` with no enum → **warning**.
- Source: https://developers.openai.com/plugins/plugin-guidelines

**TOOL-026 Free-form query tool must name or link the target API.** Severity: claude=warning.
- Detect: the tool has a free-form string or object property (no enum or pattern) that is a raw request or query-language parameter: `/^(endpoint|query_?string|body|request_?body|payload|graphql|gql|sql|jql|soql|cql|kql|spl|promql|filter_expression)$/i`, or `/^(path|url|uri|route)$/i` next to a method/verb property. A natural-language `query` or a filesystem `path` alone is not checked. Pass if the description matches `/https?:\/\/\S+/` or `/\b[A-Z][\w.&-]*( [A-Z][\w.&-]*)*\s+(Web |REST |GraphQL |Admin )?API\b/`, or the tool name, title or description contains the product name (serverInfo name or title, or their first distinctive token).
- Source: https://claude.com/docs/connectors/building/review-criteria

**TOOL-027 Collection tools without pagination or limits.** Severity: claude=info.
- Detect: the tool is not a write tool (`toolKind`), the name or description implies a collection (tokens list, search, query, export, dump, find, all), and no property matches `/^(limit|max_?results|page|page_?size|per_?page|cursor|offset|next_?token|top|first)$/i` → info.
- If the description matches `/\b(all records|entire (database|table)|full dump|dump)\b/i` → **warning**.
- Source: https://claude.com/docs/connectors/building/review-criteria

**TOOL-028 No option to trim response size.** Severity: claude=info.
- Detect: `toolKind` is read, the first verb is in {list, search, get, find, query}, and no property matches `/^(fields|select|include_[a-z_]+|exclude_[a-z_]+|verbose|detail(_level)?|format|summary|compact|properties)$/i`.
- Emitted once per server, listing the tools, so it does not flood the report.
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy

**TOOL-029 openai/toolInvocation status strings.** Severity: chatgpt=error.
- Detect: `_meta["openai/toolInvocation/invoking"]` or `["…/invoked"]` is present and is not a string of at most 64 characters → error. A UI tool that omits both → **info**.
- Source: https://developers.openai.com/plugins/reference

**TOOL-030 openai/fileParams file-object schema.** Severity: chatgpt=error.
- Detect, when `_meta["openai/fileParams"]` is present:
  - it is not a string[]
  - a listed name is not a top-level property (array `items` and local `$ref` are resolved)
  - any of `download_url`, `file_id`, `mime_type`, `file_name` is missing, or is not `{type: 'string'}`
  - `required` does not contain both `download_url` and `file_id`
  - `required` contains `mime_type`, `file_name`, or any other property
- Source: https://developers.openai.com/plugins/reference

**TOOL-031 openai/profile marker contract.** Severity: chatgpt=error.
- Detect:
  - the marker is not a boolean
  - when it is `true`: `readOnlyHint !== true`; the input has required properties; `outputSchema` lacks a string `id` in both `properties` and `required`; more than one tool is marked
  - extra output properties beyond id, name, email and nickname, or `additionalProperties !== false` → **warning**
- Source: https://developers.openai.com/plugins/build/auth

**TOOL-032 Per-tool securitySchemes.** Severity: chatgpt=info.
- Detect:
  - The server uses OAuth (the auth probe found a PRM) and a tool has neither `securitySchemes` nor `_meta.securitySchemes` → info.
  - Present but not an array, or an entry type not in {noauth, oauth2}, or oauth2 `scopes` not a string[] → **error**.
  - An oauth2 scope that is not in PRM `scopes_supported` → **warning**.
- Source: https://developers.openai.com/plugins/build/auth

### 2.4 INJ: prompt injection and model manipulation
Scope: the `corpus(snap)` from §1.5. Every INJ finding quotes the matched snippet (up to 120 characters, with hidden characters escaped as `\u{...}`) and its location.

**INJ-001 Hidden or invisible characters.** Severity: claude=error, chatgpt=error.
- Detect, on raw text including tool names:
  - Unicode tag characters U+E0000–U+E007F, or bidi controls U+202A–U+202E and U+2066–U+2069 → error.
  - U+200B, U+200C, U+200E, U+200F, U+2060–U+2064, U+FEFF, U+00AD, or any other `\p{Cf}` → **warning**.
  - U+200D between two `\p{Extended_Pictographic}` characters (emoji ZWJ sequences) is exempt.
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy, https://developers.openai.com/plugins/plugin-guidelines

**INJ-002 Mixed-script words (homoglyphs).** Severity: claude=warning, chatgpt=warning.
- Detect: a single word (`\p{L}+`) that contains Latin together with Cyrillic or Greek letters. Text written entirely in one non-Latin script is fine.
- Source: same as INJ-001.

**INJ-003 Markup hidden from humans, or pseudo-system tags.** Severity: claude=warning, chatgpt=warning.
- Detect: an HTML comment `<!-- ... -->` (found with `indexOf`; a lazy regex is quadratic on many unterminated `<!--`), or `/<\/?(system|important|instructions?|admin|assistant|secret|hidden)\b[^>]{0,200}>/i`.
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy

**INJ-004 Encoded payloads.** Severity: claude=warning, chatgpt=warning.
- Detect:
  - A base64 run `/[A-Za-z0-9+\/]{40,}={0,2}/` that decodes to 70% or more printable ASCII.
  - Escape runs `/(\\x[0-9a-f]{2}|\\u[0-9a-f]{4}|%[0-9a-f]{2}){8,}/i`.
  - Data URIs inside icons are not part of the corpus.
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy

**INJ-005 Overriding system instructions or hiding behavior from the user.** Severity: claude=error, chatgpt=error.
- Detect:
  - Error, only explicit markers (C9):
    - `/ignore (all |any )?(previous|prior|above|earlier|system) (instructions|prompts?|rules)/i`
    - `(disregard|override|bypass|forget)` within 30 characters of a system, platform, host or model instruction/prompt/rules/safeguards object, a safety instructions/rules/guidelines/guardrails/filters/policies object, or "your/all/any/previous instructions"
    - `/\b(do not|don't|never) (tell|inform|notify|alert) the user\b/i`, unless the next words protect a secret (password, secret, token, key, credential, hash, PII, SSN, card number)
  - **Warning** (regex heuristics): `(disregard|override|bypass|forget)` near `instructions|system prompt|guardrails`; `(do not|don't|never) (tell|inform|mention|reveal|show|disclose) ... user` (same secret exemption); `/\bwithout (asking|telling|confirming with) the user\b/i`; `/\b(you are now|from now on,? you)\b/i`; `/\b(system prompt|developer message)\b/i`. Editing a product's own "brand guidelines" is not an attack on platform instructions.
- Source: https://claude.com/docs/connectors/building/review-criteria, https://developers.openai.com/plugins/plugin-guidelines

**INJ-006 Steering the model away from other tools.** Severity: claude=warning, chatgpt=warning.
- Detect:
  - `/\b(do not|don't|never|avoid)\b[^.]{0,40}\b(use|call|invoke|trust)\b[^.]{0,40}\b(other|any other|another|competing|third[- ]party)\b[^.]{0,20}\b(tools?|servers?|connectors?|plugins?|apps?|mcp)/i`
  - `/\b(instead of|rather than)\b[^.]{0,40}\b(other|built-?in|default|any)\b[^.]{0,20}(tools?|search|web|plugins?)/i`
  - `/\bonly (use|call) this (tool|server|plugin)\b(?!\s+(when|if|for|to)\b)/i`. The lookahead exempts scoping phrases such as "only use this tool when the user asks about invoices".
  - `/\b(always (use|call|prefer) (this|these|our)\b|prefer (this|our) (tool|plugin|server)|better than|superior to|unlike (other|competitor))/i`
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy, https://developers.openai.com/plugins/plugin-guidelines

**INJ-007 Coercing calls to tools or software the user did not request.** Severity: claude=warning, chatgpt=warning.
- Detect:
  - `/\b(always|first|must|you should|be sure to)\b[^.]{0,60}\b(call|invoke|use|run)\b[^.]{0,40}\b(tool|function|server|mcp|connector|plugin)\b/i`
  - `/before (using|calling|answering)[^.]{0,40}\b(call|invoke|use)\b/i`
  - `/\b(use|call|invoke|ask) (the )?[\w\- ]{1,30} (connector|plugin|app|integration)\b/i`
  - `/(google drive|gmail|slack|notion|github|outlook) (tool|connector)/i`
- Extract the referenced identifiers: every quoted string (a multi-word title such as 'Query Documentation' is one reference) plus the unquoted word after call/use/invoke/run. If **every** reference is one of this server's own tool names, tool titles or `annotations.title` (case-insensitive), or a self reference (this, it, me, these), emit nothing. A workflow hint between a server's own tools is fine. RT-011 uses the same patterns and exemption.
- Source: https://claude.com/docs/connectors/building/review-criteria, https://developers.openai.com/plugins/plugin-guidelines

**INJ-008 Overly broad triggering.** Severity: chatgpt=warning, claude=info.
- Detect: `/(use|call|invoke|run) (this|me)( tool)? (for|on|with|whenever|before) (any|every|all)\b|for (every|any|all) (request|message|query|question|prompt|conversation)|call (this|me) first|at the start of every/i`.
- Source: https://developers.openai.com/plugins/plugin-guidelines

**INJ-009 Pulling instructions from external sources.** Severity: claude=warning, chatgpt=warning.
- Detect:
  - `/\b(follow|obey|execute|apply|load)\b[^.]{0,40}\b(instructions?|rules|directives|system prompt)\b[^.]{0,40}\b(from|at|in|returned by)\b/i`
  - `/instructions? (in|from) the (response|result|output)/i`
  - `/\b(follow|do) what(ever)? the (response|result) says\b/i`
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy

**INJ-010 Safety-guardrail circumvention language.** Severity: claude=warning, chatgpt=warning.
- Detect: `/\b(jailbreak|circumvent|evade|bypass|disable)\b[^.]{0,40}\b(safety|guardrails?|content policy|sandbox|moderation)\b/i`, or `/\b(DAN mode|developer mode)\b/i`.
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy

### 2.5 DATA: data collection
Scope: `walkSchema` over every inputSchema (names and descriptions), plus the corpus.

**DATA-001 Requests conversation history, transcripts, memory or system prompt.** Severity: claude=error, chatgpt=error.
- Detect:
  - Strong names: `/^(conversation(_?(history|context|log|summary|memory))?|chat_?(history|log|transcript|memory|memories)|conversation_?memories|message_?history|previous_?messages|prior_?turns|all_?messages|transcript|full_?context|context_?window|system_?prompt|user_?prompt)$/i` → error. Bare `memory` is not strong: a VM or cache size parameter has that name.
  - An array whose items are objects with `role` and `content` properties → error.
  - A description matching `(entire|full|whole|complete) (conversation|chat|transcript)`, `(include|pass|send|provide) (the )?(user's )?(previous|prior|all) (chat |conversation )?messages`, or `contents of (your|the chat's|the conversation's) memory` → **warning** (regex detection, §1.2). A bare `history` ("full history of status changes") does not match.
  - Weak names `/^(messages|history|thread|context|background|user_context|additional_context|memory|memories)$/i` → **warning**, skipped for integer, number or boolean parameters. Those names are often legitimate, for example a Slack thread id.
  - Prompt captured for logging: a capture verb (log, record, store, send, collect), then within 30 characters and one sentence a user/conversation object (prompt, message, query, conversation), then within 30 characters `logging|analytics|telemetry|tracking` → **warning**. Querying an analytics product does not match.
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy, https://developers.openai.com/plugins/plugin-guidelines

**DATA-002 Reads Claude memory, chat history or user uploads.** Severity: claude=warning.
- Detect: a description matching `/\b(read|access|retrieve|search|export|sync)\b[^.]{0,30}\b(claude'?s )?(memory|chat history|conversation summar(y|ies)|past conversations|project knowledge)\b/i`.
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy

**DATA-003 Inputs solicit secrets or credentials.** Severity: chatgpt=error, claude=warning.
- Detect:
  - Names `/^(password|passwd|pwd|pass_?phrase|api_?key|apikey|secret|client_?secret|access_?token|refresh_?token|bearer|auth_?token|session_?token|otp|totp|mfa(_?code)?|2fa(_?code)?|verification_?code|private_?key|seed_?phrase|mnemonic)$/i` → finding.
  - The name `pin` → **warning** only (for example "pin a message").
  - Text matching `/(provide|enter|paste|include|send) (your|the user'?s) (password|api key|token|secret|otp|one-time code|system prompt)/i` → finding.
- Fix: use OAuth. Never route credentials through the model.
- Source: https://developers.openai.com/plugins/plugin-guidelines

**DATA-004 Inputs collect restricted data (PCI, PHI, government IDs).** Severity: chatgpt=error.
- Detect:
  - Strong names `/^(card_?number|credit_?card(_number)?|cc_?num(ber)?|cvv2?|cvc|card_?expir(y|ation)|ssn|social_?security(_number)?|national_?id|passport(_number)?|drivers?_?licen[cs]e(_number)?|medical_?record(_number)?|mrn|health_?insurance_?id|insurance_?member_?id)$/i` → error.
  - Weak names `/^(pan|tin|tax_?id|iban|diagnosis|exp(iry)?_date)$/i` → **warning**.
- Source: https://developers.openai.com/plugins/plugin-guidelines

**DATA-005 Inputs request precise user location.** Severity: chatgpt=warning.
- Detect:
  - Names `/^(lat|latitude|lng|lon|long|longitude|coords?|coordinates|gps|geo(location)?|street(_address)?|address)$/i` → warning.
  - Names `/^(postal_?code|zip(_?code)?)$/i` → **info**.
- Fix: use the coarse location the host provides in `_meta["openai/userLocation"]`.
- This is a heuristic (the coordinates may describe a place, not the user), so it stays a warning.
- Source: https://developers.openai.com/plugins/plugin-guidelines

### 2.6 POL: unsupported use cases and commercial content

**POL-001 Money or financial-asset transfer (heuristic).** Severity: claude=warning.
- Detect, when `readOnlyHint !== true` and both of these hold:
  - the name matches `/(send|transfer|wire|pay|payout|withdraw|deposit|remit|swap|bridge|stake|buy|sell|trade|place_?order|execute_?(trade|order|payment|transaction)|sign_?transaction|broadcast_?(tx|transaction))/i`
  - the name or description matches `/\b(money|funds?|payments?|ach|sepa|swift|iban|bank|crypto(currency)?|bitcoin|btc|eth(ereum)?|usdc|usdt|stablecoin|wallet|securities|stocks?|shares)\b/i`
- Read-only lookups such as `get_balance` are excluded.
- Message: unsupported unless Anthropic has expressly permitted it in writing.
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy

**POL-002 AI image, video or audio generation (heuristic).** Severity: claude=warning.
- Detect:
  - `/(generate|create|synthesi[sz]e|render|make|produce|edit)[_ -]?(an? )?(ai )?(image|images|photo|picture|art|artwork|illustration|avatar|video|clip|animation|audio|speech|voice|music|song|sound|podcast)/i`, or `/\b(text[- ]to[- ](image|video|speech|audio|music)|tts|txt2img|img2img|stable diffusion|dall-?e|midjourney|voice clon)/i`.
  - Downgrade to **info** when the text also matches `/\b(diagram|chart|graph|slide|presentation|mockup|wireframe|ui|logo|flowchart|design asset)\b/i`. This is the design-tool exemption.
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy

**POL-003 Advertising, sponsored content, pricing or promotions.** Severity: claude=warning, chatgpt=warning.
- Detect, over the corpus:
  - Promotional phrasing addressed to the user: sponsored content/by/listings/results, `advertisement:`, paid placement, promoted listings/products, affiliate links, `use (the|our|my) (promo|discount|coupon) code`, `(get|save|enjoy|take) N% off`, `N% off (your|all|today|now|everything|sitewide)`, `N% off!`, `start (your|a) free trial`, `try (it) free for N`, subscribe now, upgrade to pro/premium, sign up now/today. Bare nouns (coupon, discount code, free trial) are not matched: a store-admin tool that creates coupons is functionality.
  - `/\b(official (chatgpt|openai|claude|anthropic)|endorsed by (openai|anthropic)|(openai|anthropic)[- ]approved)\b/i`
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy, https://developers.openai.com/plugins/plugin-guidelines

**POL-004 Subscription upsell or checkout flow.** Severity: chatgpt=warning.
- Detect, over the corpus and widget HTML:
  - `/\b(buy (more )?credits|purchase (more )?tokens|pricing plans?|upgrade (now|your (plan|subscription|account))|subscribe (now|to (our|a|the) (plan|subscription|premium))|premium (plan|subscription))\b/i`. Bare `checkout` is not matched ("Checkout a branch").
  - links whose path matches `/(billing|upgrade|subscribe|subscription|pricing)/i` → warning; `/(checkout|cart)/i` → **info** (physical goods must use an external, merchant-hosted checkout; digital goods and subscriptions may not be sold)
- Source: https://developers.openai.com/plugins/plugin-guidelines

**POL-005 Unofficial wrapper, demo or test server.** Severity: chatgpt=info.
- Detect: serverInfo name, title or description matches `/\b(unofficial|demo|sample|example|playground|wrapper for)\b/i`.
- Source: https://developers.openai.com/plugins/plugin-guidelines

### 2.7 APPS: MCP Apps and widgets
UI tools are found through `uri = _meta.ui.resourceUri ?? _meta["ui/resourceUri"] ?? _meta["openai/outputTemplate"]`. For UI resources, `_meta` is read from the `resources/read` content item first, with the `resources/list` entry as a fallback. Define `RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app'` locally. Do **not** import `@modelcontextprotocol/ext-apps`, which needs Node ≥20.

**APPS-001 UI resourceUri uses ui:// and resolves.** Severity: spec=error. Needs: ui.
- Detect: the URI is not a string starting with `ui://`, or `resources/read(uri)` errors or returns no content item with a matching URI. The resource does not have to appear in resources/list.
- Source: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx

**APPS-002 Deprecated or duplicated UI link keys.** Severity: spec=warning, chatgpt=info.
- Detect:
  - flat `_meta["ui/resourceUri"]` without `_meta.ui.resourceUri` → spec warning
  - `openai/outputTemplate` without `ui.resourceUri` → chatgpt info
  - two of these keys present with different values → warning
- Source: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx, https://developers.openai.com/plugins/reference

**APPS-003 UI resource MIME type and payload.** Severity: spec=error, claude=error, chatgpt=error. Needs: ui.
- Detect:
  - `mimeType`, after lowercasing type and subtype and stripping whitespace around `;`, is not `text/html;profile=mcp-app`
  - the item has neither a `text` string nor a base64 `blob`
  - the `resources/list` entry has a different `mimeType` → **warning**
- Source: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx, https://claude.com/docs/connectors/building/mcp-apps/quickstart

**APPS-004 UI content looks like an HTML document.** Severity: spec=warning. Needs: ui.
- Detect: the decoded content has none of `<!doctype html`, `<html` or `<script`.
- Source: same as APPS-001.

**APPS-005 UI resource declares a CSP.** Severity: chatgpt=error, claude=info. Needs: ui.
- Detect: both `_meta.ui.csp` and the legacy `_meta["openai/widgetCSP"]` are absent.
  - Claude info: "host default blocks all external origins".
  - A declared CSP field that is not a string[] → **error** on all platforms.
- Source: https://developers.openai.com/plugins/deploy/app-review, https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx

**APPS-006 CSP entries narrow and well-formed.** Severity: chatgpt=warning, spec=warning. Needs: ui.
- Detect, for each entry:
  - it is `*`, `https:`, `http:` or `https://*`, or a wildcard on a public or shared suffix (`https://*.com`, `https://*.vercel.app`)
  - it uses `http://` on a non-localhost host
  - it has a path, query, fragment or trailing slash
  - it contains `'unsafe-*'`
  - it names localhost or a private IP
  - a wildcard appears outside `resourceDomains` → spec **info**
  - public CDNs (unpkg.com, cdn.jsdelivr.net) in `resourceDomains` → claude **info**: "serve from your own origin in production"
- Source: https://developers.openai.com/plugins/build/chatgpt-ui, https://claude.com/docs/connectors/building/mcp-apps/design-guidelines

**APPS-007 External origins used by the widget are declared in the CSP.** Severity: chatgpt=error, claude=warning, spec=warning. Needs: ui.
- Detect: run `extractOrigins(html)` and match each origin against the matching list (`resourceDomains`/`resource_domains`, `connectDomains`/`connect_domains`, `frameDomains`/`frame_domains`, `baseUriDomains`). Each undeclared origin is a finding.
- Findings with `js` confidence are capped at **warning**, because a regex cannot be sure a literal is fetched.
- Source: https://developers.openai.com/plugins/build/chatgpt-ui, https://claude.com/docs/connectors/building/mcp-apps/design-guidelines

**APPS-008 Nested frames declared.** Severity: claude=warning, chatgpt=warning. Needs: ui.
- Detect: `frameDomains` or `frame_domains` is non-empty.
  - Claude: "restricted pending security review".
  - ChatGPT: "justification required (`frame_domain_explanation_required`)". A frame origin whose registrable domain differs from the server's gets stronger wording ("third-party embeds get extra scrutiny").
- Source: https://claude.com/docs/connectors/building/mcp-apps/design-guidelines, https://developers.openai.com/plugins/plugin-guidelines

**APPS-009 csp or permissions placed on the tool instead of the resource.** Severity: spec=warning.
- Detect: `tool._meta.ui.csp` or `tool._meta.ui.permissions` is present. Hosts ignore both there.
- Source: https://github.com/modelcontextprotocol/ext-apps/blob/main/src/spec.types.ts

**APPS-010 Tool visibility.** Severity: spec=error, chatgpt=warning.
- Detect:
  - `_meta.ui.visibility` is present and is not a non-empty array of values from {model, app} → spec error.
  - `['app']` alone → spec **info**: "hidden from the model".
  - `_meta["openai/visibility"]` is present → chatgpt warning (deprecated 2026-07-21). A value other than public or private → **error**.
  - `_meta["openai/widgetAccessible"]` is present → chatgpt **info**.
- Source: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx, https://developers.openai.com/plugins/changelog

**APPS-011 Claude ui.domain equals the URL hash.** Severity: claude=error. Needs: ui, http.
- Detect: when `_meta.ui.domain` is set, compute `expected = sha256(urlAsEntered).hex.slice(0,32) + '.claudemcpcontent.com'`.
  - The value does not match `/^[0-9a-f]{32}\.claudemcpcontent\.com$/` → "invalid format". This is skipped when the value is clearly meant for another host (see APPS-012).
  - The value is well-formed but `!== expected` → "mismatch". The hint mentions trailing slash or path differences.
  - stdio target → **info**: "cannot verify".
- Source: https://claude.com/docs/connectors/building/mcp-apps/troubleshooting

**APPS-012 ChatGPT dedicated widget domain.** Severity: chatgpt=error. Needs: ui.
- Detect: `d = _meta["openai/widgetDomain"] ?? (ui.domain unless it ends with .claudemcpcontent.com)`.
  - Absent → error ("required when submitting a plugin with UI").
  - Not an absolute https origin without a path → error.
  - Equal to `https://web-sandbox.oaiusercontent.com` → **warning** ("not unique").
  - Uniqueness across plugins cannot be checked.
- See §2.11 C1 for the cross-host conflict.
- Source: https://developers.openai.com/plugins/reference

**APPS-013 openExternal targets need redirect_domains.** Severity: chatgpt=warning. Needs: ui.
- Detect: a `navigate` origin from `extractOrigins` that is not in `_meta["openai/widgetCSP"].redirect_domains`.
- Source: https://developers.openai.com/plugins/reference

**APPS-014 App connects to the host.** Severity: claude=warning. Needs: ui.
- Detect: the HTML references `@modelcontextprotocol/ext-apps` or `new App(` but contains neither `/\.connect\s*\(/` nor `/useApp\s*\(/`. A `sendSizeChanged` call with a literal `height: 0` → warning.
- Source: https://claude.com/docs/connectors/building/mcp-apps/troubleshooting

**APPS-015 Widget uses browser APIs the sandbox blocks.** Severity: chatgpt=warning. Needs: ui.
- Detect: `/(^|[^.\w])(window\.)?(alert|confirm|prompt)\s*\(/` (property calls such as `obj.prompt(` are excluded), or `/navigator\.clipboard/`.
- Source: https://developers.openai.com/plugins/guides/security-privacy

**APPS-016 Widget style and accessibility hints.** Severity: chatgpt=info. Needs: ui.
- Detect any of:
  - `localStorage` or `sessionStorage` is used ("avoid for core state")
  - custom fonts (`@font-face`, fonts.googleapis.com, fonts.gstatic.com, use.typekit.net)
  - `<img>` without `alt`
  - ad or tracker origins (doubleclick.net, googlesyndication.com, adservice.google.com, facebook.net). These are **warning**.
- Source: https://developers.openai.com/plugins/build/chatgpt-ui, https://developers.openai.com/plugins/concepts/ui-guidelines

**APPS-017 UI resource meta field types.** Severity: spec=error. Needs: ui.
- Detect any of:
  - `prefersBorder` present but not a boolean
  - a `permissions` key outside {camera, microphone, geolocation, clipboardWrite}, or a value that is not an object
  - `ui.domain` present but not a string → error
  - a missing `prefersBorder` → **info** ("explicit value recommended")
- Source: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx

**APPS-018 UI tools declare outputSchema.** Severity: chatgpt=warning.
- Detect: a UI-linked tool with no `outputSchema`.
- Source: https://developers.openai.com/plugins/reference

### 2.8 AUTH: OAuth and authorization
Needs: auth, unless noted. The probe flow is in §3.3. AS-level checks use `authorization_servers[0]`, the only entry Claude uses. ChatGPT checks repeat for up to 3 entries.

**AUTH-001 Token in the server URL query.** Severity: claude=error, chatgpt=error, spec=error. Needs: http (runs without auth).
- Detect: a query parameter name matching `/^(token|access_token|api_?key|apikey|key|secret|auth|password|bearer)$/i`. The value is always redacted in the output.
- Source: https://claude.com/docs/connectors/building/authentication

**AUTH-002 401 challenge format.** Severity: claude=error, chatgpt=error, spec=warning.
- Detect, on the unauthenticated 401:
  - `WWW-Authenticate` is missing, or the scheme is not Bearer (or DPoP), or `resource_metadata` is missing:
    - a well-known PRM still resolves → claude-only **warning** (the spec needs one discovery mechanism; Claude calls the header the reliable path)
    - no PRM, but legacy origin AS metadata exists (`authProbe.legacyDiscovery`) → chatgpt and spec error, claude **warning** (deprecated discovery that Claude still follows)
    - no discovery at all → error (see AUTH-004)
  - `resource_metadata` is not an absolute https URL → error.
  - Scheme `Basic` or `ApiKey` → chatgpt error, claude warning.
- Source: https://claude.com/docs/connectors/building/authentication, https://datatracker.ietf.org/doc/html/rfc9728#section-5.1

**AUTH-003 Wrong status for an unauthenticated request.** Severity: claude=error, chatgpt=error, spec=warning. Needs: http.
- Detect:
  - 200 with a `WWW-Authenticate` header → claude and chatgpt error: Claude ignores the header on a 200.
  - 403 to unauthenticated initialize → claude and chatgpt **warning**: only a 401 starts sign-in. The message mentions WAF blocks as an alternative cause (see SRV-009).
  - Any 403 from the MCP endpoint lacks `error="insufficient_scope"` → claude **info**. `insufficient_scope` without `scope=` → spec warning and claude **info** (Claude falls back to its discovery-time scope selection).
- Source: https://claude.com/docs/connectors/building/authentication, https://claude.com/docs/connectors/building/lazy-authentication, https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#runtime-insufficient-scope-errors

**AUTH-004 Protected Resource Metadata discoverable.** Severity: claude=error, chatgpt=error, spec=error.
- Detect: the PRM is tried from the header URL, then `{origin}/.well-known/oauth-protected-resource{path}{query}` with a terminating `/` removed from the path (RFC 9728 §3.1; skipped when both are empty), then `{origin}/.well-known/oauth-protected-resource`.
  - None returns 200 with a JSON object → error. When none is found, the probe also fetches `{origin}/.well-known/oauth-authorization-server` (2025-03-26 discovery, as the MCP SDK client does). If that answers, the AS rules run on it, the auth summary says "legacy discovery, no PRM", and this case is a claude **warning** (deprecated) while chatgpt and spec stay errors.
  - Wrong Content-Type on a 200 → warning.
  - Only the root form exists while the endpoint has a path → claude **info**.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery

**AUTH-005 PRM `resource` matches the MCP URL.** Severity: claude=error, spec=error, chatgpt=warning.
- Detect: `resource` is missing, not a string or not an absolute URL → error on all platforms. Otherwise both URLs are WHATWG-normalized (`new URL().href`, fragment removed), so `https://host` and `https://host/` are equal.
  - Equal → no finding.
  - Same origin and the resource path is a path-segment prefix of the server path (the MCP SDK's `checkResourceAllowed`, e.g. resource `https://mcp.asana.com` for `/sse`) → claude **info**, spec **warning** (RFC 9728 asks for identity).
  - Anything else → claude error, spec error, chatgpt warning, in one finding. When the values differ only by trailing slash or case, the hint says so explicitly.
- Source: https://claude.com/docs/connectors/building/authentication, https://datatracker.ietf.org/doc/html/rfc9728#section-3.3

**AUTH-006 PRM authorization_servers.** Severity: claude=error, chatgpt=error, spec=error.
- Detect:
  - missing, not an array, or empty
  - entry [0] is not https, or has a query or fragment
  - more than one entry → claude **warning**: "only the first is used, no fallback"
- Source: https://claude.com/docs/connectors/building/authentication, https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery

**AUTH-007 Authorization server metadata discoverable.** Severity: claude=error, chatgpt=error, spec=error.
- Detect: the issuer path is `P`. Try in order:
  - when `P` is non-empty: `/.well-known/oauth-authorization-server{P}`, then `/.well-known/openid-configuration{P}`, then `{P}/.well-known/openid-configuration`
  - when `P` is empty: the two root forms
  - The first 200 JSON response wins. If none succeeds → error.
  - Record which URL succeeded.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery

**AUTH-008 Issuer identical.** Severity: claude=error, spec=error, chatgpt=warning.
- Detect: `metadata.issuer !== authorization_servers[i]`, compared exactly. Origin-only issuers that differ only by the root `/` (`https://api.box.com` vs `https://api.box.com/`) → **info**; issuers with a path keep strict equality.
- Source: same as AUTH-007, plus https://developers.openai.com/plugins/build/auth

**AUTH-009 Required AS endpoints and response types.** Severity: claude=error, chatgpt=error, spec=error.
- Detect:
  - `authorization_endpoint` or `token_endpoint` missing → error.
  - `response_types_supported` present without `code` → error.
  - `response_types_supported` missing → **warning** (RFC 8414 REQUIRED, but many providers omit it).
- Source: https://datatracker.ietf.org/doc/html/rfc8414#section-2

**AUTH-010 AS endpoints over HTTPS with trusted certificates.** Severity: claude=error, chatgpt=error, spec=error.
- Detect:
  - issuer, authorization, token, registration, revocation, introspection or jwks endpoint is not `https:` → error. Exception: a loopback AS when the target is local.
  - `tls.connect(host:443, {servername, rejectUnauthorized: true})` fails (SELF_SIGNED_CERT_IN_CHAIN, DEPTH_ZERO_SELF_SIGNED_CERT, CERT_HAS_EXPIRED, ERR_TLS_CERT_ALTNAME_INVALID, UNABLE_TO_VERIFY_LEAF_SIGNATURE) for the MCP host or any distinct endpoint host → error.
  - When `NODE_EXTRA_CA_CERTS` is set, add an info note.
  - SRV-004 DNS rules also run on the AS host.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations, https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy

**AUTH-011 PKCE S256 advertised.** Severity: claude=error, chatgpt=error, spec=error.
- Detect: `code_challenge_methods_supported` is not an array that includes `'S256'`. Absent also fails, because clients refuse to proceed.
- Source: https://claude.com/docs/connectors/building/authentication, https://developers.openai.com/plugins/build/auth

**AUTH-012 Client registration path.** Severity: claude=warning, chatgpt=warning, spec=warning.
- Detect:
  - `cimdFlag = client_id_metadata_document_supported === true`
  - `noneAuth = token_endpoint_auth_methods_supported` includes `'none'`
  - `pkjwt` = includes `'private_key_jwt'`
  - `dcr = typeof registration_endpoint === 'string'`
- Per platform:
  - Claude: CIMD is used when `cimdFlag && noneAuth`. `cimdFlag && !noneAuth` → **warning**: "CIMD ignored, falls back to DCR". Neither CIMD nor DCR → **warning**: "Claude requires Anthropic-held credentials (contact mcp-review@anthropic.com) or connection-time credentials". Pre-registered clients are a supported path the linter cannot see.
  - ChatGPT: `cimdFlag` without none or pkjwt → warning. `cimdFlag` with the auth-methods field absent → warning (RFC 8414 default client_secret_basic). Neither CIMD nor DCR → warning: "predefined client required; secret goes in the portal, not the manifest".
  - Spec: neither → warning. DCR only → **info**: "DCR deprecated in 2026-07-28; add CIMD".
  - `client_id_metadata_document_supported` present but not a boolean → error.
- Source: https://claude.com/docs/connectors/building/authentication, https://developers.openai.com/plugins/build/auth, https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration

**AUTH-013 Authorization-code grant supported.** Severity: chatgpt=error, claude=warning.
- Detect: `grant_types_supported` exists and lacks `authorization_code`, for example only client_credentials or jwt-bearer.
- Also: the server returns 401/403 to unauthenticated requests but serves no PRM and no Bearer challenge → chatgpt error ("API-key or custom-header auth is unsupported"), claude **info** ("static headers are beta; directory expects OAuth").
- Source: https://developers.openai.com/plugins/build/auth, https://claude.com/docs/connectors/building/authentication

**AUTH-014 RFC 9207 iss parameter.** Severity: chatgpt=info, spec=info.
- Detect: `authorization_response_iss_parameter_supported !== true`.
  - ChatGPT note: the callback-specific redirect is used instead of the stable one.
  - Present but not a boolean → spec **error**.
- Source: https://developers.openai.com/plugins/build/auth, https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#authorization-response-validation

**AUTH-015 Scope guidance.** Severity: claude=info, spec=warning.
- Detect:
  - The 401 has no `scope=` → info. List what Claude will request: PRM `scopes_supported`, plus `offline_access` if the AS lists it.
  - That list has more than 10 scopes, or admin-like scopes (`/admin|write:all|\*|full_access/i`) → claude **warning**.
  - `offline_access` appears in the challenge scope or in PRM `scopes_supported` → spec warning.
  - AS `scopes_supported` contains openid, email or profile → chatgpt **info**: "requested by default; enable for the client". (AUTH-015 also has chatgpt as a platform for this case.)
- Source: https://claude.com/docs/connectors/building/authentication, https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#refresh-tokens

**AUTH-016 Invalid token gets 401.** Severity: spec=error, chatgpt=warning.
- Detect: a request with `Authorization: Bearer mcp-review-check-invalid-token` returns a status other than 401 → finding. A 401 without a `WWW-Authenticate` pointing to `resource_metadata` → **warning**.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#token-handling

**AUTH-017 OAuth endpoint latency.** Severity: claude=error.
- Detect, over the PRM, AS metadata and (with active-auth) registration and token timings, taking the maximum of up to 3 samples for GETs:
  - over 10000 ms → error
  - over 3000 ms → **warning**
- Source: https://claude.com/docs/connectors/building/authentication

**AUTH-018 Microsoft Entra ID notes.** Severity: claude=info.
- Detect: the issuer host is `login.microsoftonline.com` or `sts.windows.net` → remind the user to register the MCP URL as an Application ID URI. An MCP host ending in `.azurewebsites.net` → **warning**.
- Source: https://claude.com/docs/connectors/building/authentication

**AUTH-019 DCR accepts JSON registration.** Severity: claude=warning. Needs: active-auth.
- Detect: POST `registration_endpoint` with the body from research (client_name `mcp-review-check`, the three redirect URIs, `token_endpoint_auth_method: none`).
  - 415, or non-2xx with `invalid_redirect_uri` → **error**.
  - Over 10 s → warning.
  - Store the `client_id` for AUTH-020 and AUTH-021.
- Source: https://claude.com/docs/connectors/building/authentication

**AUTH-020 Redirect URIs accepted at /authorize.** Severity: claude=error. Needs: active-auth.
- Detect: GET `authorization_endpoint` with PKCE params and `resource` for each of `https://claude.ai/api/mcp/auth_callback`, `http://localhost:3118/callback` and `http://127.0.0.1:3118/callback`, using `redirect: manual`.
  - A 400, or an error body mentioning `redirect_uri` → error.
  - A login page that shows before validation → **info** ("verify manually").
- Source: https://claude.com/docs/connectors/building/authentication

**AUTH-021 Token endpoint form-encoding and error codes.** Severity: claude=error. Needs: active-auth.
- Detect:
  - POST a bogus authorization_code exchange as form-urlencoded. A 415, or an error suggesting the body was not parsed → error. A non-JSON error body → **warning**.
  - With a `client_id`, POST a bogus refresh_token. Anything other than 400 `invalid_grant` → **warning**.
- Source: https://claude.com/docs/connectors/building/authentication

### 2.9 RT: runtime checks (opt-in `--active`)
Safety contract:
- Call only tools with `annotations.readOnlyHint === true`, `destructiveHint !== true`, and no WRITE verb token in the name.
- At most 3 calls per tool and 50 tools, one at a time.
- Each call uses the `--timeout` value, capped at 240 s.
- Arguments come from `--tool-args <file.json>` (`{toolName: args}`) or are synthesized: `default` → `examples[0]` → `enum[0]` → `const` → type placeholder (`"mcp-review-check"`, `1`, `false`, `[]`, `{}`).
- Invalid-input variants: `{}` when required properties exist, and the first required property set to the wrong type.
- Success-path rules apply only to non-`isError` results.

**RT-001 Error messages are specific.** Severity: claude=error.
- Detect, on invalid-input calls that got an answer: the error text (`content[*].text` when `isError`, or the JSON-RPC `message` + `data`) matches `isGenericError` (generic phrases only, no length rule) → error. A stack trace (`/\n\s+at .+\(.+:\d+:\d+\)/` or `/Traceback \(most recent call last\)/`) → **warning**.
- Source: https://claude.com/docs/connectors/building/review-criteria

**RT-002 Invalid input silently accepted.** Severity: claude=warning, spec=warning.
- Detect: a wrong-type call returns a success result.
- Source: https://claude.com/docs/connectors/building/review-criteria

**RT-003 Input-validation errors reported with isError.** Severity: spec=warning.
- Detect: an invalid-argument call returns a JSON-RPC error instead of `isError: true`.
- Source: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts

**RT-004 Result size.** Severity: claude=error.
- Detect: `len` = the characters of text items + serialized non-text items + `JSON.stringify(structuredContent).length` unless a text item already mirrors it (equal string or equal parsed JSON). The message states the method.
  - over 150000 → error
  - over 100000 (about 25k tokens, Claude Code default) → **warning**
  - over 20000 on a call without filters → **info** *(linter-defined)*
- Source: https://claude.com/docs/connectors/building

**RT-005 Tool latency.** Severity: claude=error, chatgpt=warning.
- Detect:
  - over 240 s → claude error
  - over 60 s → claude **warning**
  - over 5 s → chatgpt warning
  - a call that got no answer (timeout or transport error; recorded as `transportError`, never as a JSON-RPC error) → **warning** for claude and chatgpt. Calls are cut off at `min(--timeout, 240 s)`, so the 60 s and 240 s thresholds need a larger `--timeout`. RT-001 to RT-004 and RT-006 to RT-011 ignore such calls.
- Source: https://claude.com/docs/connectors/building, https://developers.openai.com/plugins/deploy/troubleshooting

**RT-006 structuredContent conforms to outputSchema.** Severity: spec=error, chatgpt=error.
- Detect:
  - `outputSchema` is defined and `structuredContent` is missing or fails Ajv validation → error
  - `structuredContent` is returned with no `outputSchema` → chatgpt **warning** (OpenAI phrases it as guidance; the MCP spec makes outputSchema optional)
- Source: https://modelcontextprotocol.io/specification/2026-07-28/server/tools#output-schema, https://developers.openai.com/plugins/reference

**RT-007 structuredContent mirrored as text.** Severity: spec=warning.
- Detect: `structuredContent` is present and no `type: 'text'` item exists.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content

**RT-008 UI tools return meaningful content.** Severity: spec=warning.
- Detect: on a UI-linked tool, `content` is missing, empty, or only text shorter than 20 characters *(linter-defined)*.
- Source: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx

**RT-009 Auth failures surfaced at the transport level.** Severity: claude=warning, chatgpt=warning.
- Detect, when listing worked without credentials:
  - a call returns HTTP 200 with `isError` and text matching `/\b(sign ?in|log ?in|authenticat|unauthori[sz]ed|not authenticated|missing (access )?token|connect your account|oauth)\b/i` → claude warning ("Claude shows text instead of the Connect card; return 401")
  - chatgpt: the same, unless `_meta["mcp/www_authenticate"]` is present and every challenge in it has `error=` and `error_description=`
- Source: https://claude.com/docs/connectors/building/lazy-authentication, https://developers.openai.com/plugins/build/auth

**RT-010 Results leak internals or secrets.** Severity: chatgpt=warning.
- Detect: walk `structuredContent` and any JSON parsed from text.
  - Keys matching `/^(session_?id|trace_?id|request_?id|correlation_?id|span_?id|_?debug|stack(_?trace)?|logs?|internal_?(id|account_?id))$/i` → warning.
  - Values matching a JWT (`/eyJ[\w-]+\.[\w-]+\.[\w-]+/`), `sk-…`, `ghp_…` or `AKIA…` → **error**. Values are redacted in the output.
- Source: https://developers.openai.com/plugins/plugin-guidelines

**RT-011 Injection patterns in tool output.** Severity: claude=warning, chatgpt=warning.
- Detect: the INJ-005/006/007/009 regexes run over result text.
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy

**RT-012 Behavior gated on clientInfo.** Severity: claude=info.
- Detect: initialize three times with `clientInfo.name` set to `mcp-review-check`, `claude-ai` and `Anthropic`. Different tools/list name sets → info.
- Source: https://claude.com/docs/connectors/building/testing

### 2.10 MAN: manual checklist
These items are always printed as reminders under "Manual checklist". They are filtered by target, and by detected features where marked: [ui] when UI exists, [oauth] when the auth probe found OAuth. They never affect the score or the exit code.

| ID | Platform | Reminder | Source |
|---|---|---|---|
| MAN-001 | claude | Privacy policy URL (data collection, usage, retention) | https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy |
| MAN-002 | claude | Listing: name ≤100, one-liner ≤200, description ≤2000, 1–5 categories, docs URL, privacy URL, support contact, icon; slug is permanent | https://claude.com/docs/connectors/building/submission |
| MAN-003 | claude | ≥3 working example prompts; populated test account | https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy |
| MAN-004 | claude | Public documentation by publish date | https://claude.com/docs/connectors/building/review-criteria |
| MAN-005 | claude [ui] | Carousel screenshots: PNG, ≥1000 px wide, 3–5 images, cropped to the app response | https://claude.com/docs/connectors/building/submission |
| MAN-006 | claude [ui] | Allowed link URIs: https origins or owned custom schemes only | https://claude.com/docs/connectors/building/mcp-apps/external-links |
| MAN-007 | claude [oauth] | Rotate refresh tokens for public clients; return the new one in the same response | https://claude.com/docs/connectors/building/authentication |
| MAN-008 | claude [oauth] | Register `https://claude.ai/api/mcp/auth_callback` exactly; loopback callbacks port-agnostic | https://claude.com/docs/connectors/building/authentication |
| MAN-009 | claude | WAF/CDN allows Anthropic egress `160.79.104.0/21` | https://claude.com/docs/connectors/building/authentication |
| MAN-010 | claude | Server calls your own first-party APIs (or legitimately proxied ones) | https://claude.com/docs/connectors/building/review-criteria |
| MAN-011 | claude | Compliance acknowledgments: guidelines, first-party API, financial transactions, AI media generation, prompt injection, conversation data, public docs | https://claude.com/docs/connectors/building/submission |
| MAN-012 | claude | Tool descriptions accurately describe real behavior (reviewers test each tool in Verified review) | https://claude.com/docs/connectors/building/review-criteria |
| MAN-013 | spec [oauth] | Validate token audience (accept the canonical URI); never pass the client's token upstream | https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations |
| MAN-014 | spec [oauth] | Low-scope token → 403 `insufficient_scope` with `scope` and `resource_metadata` | https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#runtime-insufficient-scope-errors |
| MAN-015 | chatgpt | Listing (final submission limits): displayName ≤30, shortDescription ≤30, longDescription ≤4000, developerName ≤80, valid category, ≤20 capabilities of ≤120 chars | https://developers.openai.com/plugins/deploy/submission-errors |
| MAN-016 | chatgpt | websiteURL, supportURL, privacyPolicyURL, termsOfServiceURL: HTTPS, no credentials, ≤1024 chars, publicly accessible | https://developers.openai.com/plugins/deploy/submission |
| MAN-017 | chatgpt | Starter prompts: ≤3, ≤128 chars, single line, unique, no @mentions | https://developers.openai.com/plugins/deploy/submission-errors |
| MAN-018 | chatgpt | Brand colors `#RRGGBB`, ≥2:1 contrast vs white / vs #212121 (dark) | https://developers.openai.com/plugins/deploy/submission-errors |
| MAN-019 | chatgpt | Icons square, 48–4096 px, ≤5 MiB, PNG/JPEG/WebP/SVG | https://developers.openai.com/plugins/deploy/submission |
| MAN-020 | chatgpt | Exactly 5 positive and 3 negative test cases; tools_triggered exist; release notes | https://developers.openai.com/plugins/deploy/submission-errors |
| MAN-021 | chatgpt | Demo recording URL covering web, iOS and Android | https://developers.openai.com/plugins/deploy/submission-errors |
| MAN-022 | chatgpt | Works on desktop and mobile, including UI; light and dark themes; WCAG AA contrast | https://developers.openai.com/plugins/concepts/ui-guidelines, https://developers.openai.com/plugins/plugin-guidelines |
| MAN-023 | chatgpt | Package: no test_credentials/reviewer_instructions, no clientSecret, no non-empty server headers, no `.app.json`/apps/hooks | https://developers.openai.com/plugins/deploy/submission |
| MAN-024 | chatgpt [ui] | Screenshots only with UI: one per starter prompt, 706 px wide, 400–860 px tall (note: guidelines say they're no longer shown) | https://developers.openai.com/plugins/deploy/submission-errors |
| MAN-025 | chatgpt | Privacy policy discloses categories, purposes, recipients, retention, user controls; covers every user field tools return | https://developers.openai.com/plugins/plugin-guidelines |
| MAN-026 | chatgpt [oauth] | Reviewer test account: works externally, no MFA/SMS/magic link, doesn't expire, seeded data | https://developers.openai.com/plugins/deploy/submission, https://developers.openai.com/plugins/plugin-guidelines |
| MAN-027 | chatgpt | Be ready to justify each tool's three hints (`justification_required` may still appear) | https://developers.openai.com/plugins/deploy/submission-errors |
| MAN-028 | chatgpt [oauth] | Advertised OIDC scopes (openid/email/profile) enabled for the client | https://developers.openai.com/plugins/build/auth |
| MAN-029 | chatgpt | Not an unofficial third-party connector, demo or trial; EU data residency projects cannot submit | https://developers.openai.com/plugins/deploy/app-review, https://developers.openai.com/plugins/plugin-guidelines |
| MAN-030 | chatgpt | Physical goods only for commerce; no subscription upsell | https://developers.openai.com/plugins/plugin-guidelines |
| MAN-031 | spec | Consider running `npx @modelcontextprotocol/conformance server --url <url>` for full schema conformance | https://github.com/modelcontextprotocol/conformance |

### 2.11 Resolved conflicts between sources
- **C1, widget domain.**
  - Claude needs `_meta.ui.domain = {sha256(url)[0:32]}.claudemcpcontent.com`.
  - ChatGPT reads `openai/widgetDomain`, with `ui.domain` as an alias, and needs an https origin unique per plugin.
  - Decision: APPS-011 checks `ui.domain` only for Claude. APPS-012 prefers `openai/widgetDomain` and ignores a `ui.domain` that ends with `.claudemcpcontent.com`.
  - With `--target all`, when `ui.domain` is in Claude format and `openai/widgetDomain` is absent, APPS-012 adds a fix hint: "set `openai/widgetDomain` for ChatGPT, keep `ui.domain` for Claude".
  - Open question Q1 covers this.
- **C2, PRM `resource` comparison.** Claude and RFC 9728 require an exact match. ChatGPT tolerates a trailing slash. AUTH-005 emits per-platform findings. Token `aud` checks (MAN-013, SRV-017) use the canonical form instead.
- **C3, Origin validation.** The spec says to reject an invalid Origin. Claude warns against overly strict validation. SRV-008 splits these into two probes with different severities.
- **C4, client registration.** Claude errors when neither CIMD nor DCR exists. The spec deprecates DCR. ChatGPT allows predefined clients. AUTH-012 handles each platform separately.
- **C5, CIMD auth methods.** Claude needs `none`. ChatGPT accepts `none` or `private_key_jwt`.
- **C6, annotation justification and screenshots.** OpenAI documents conflict on both, so they are manual reminders only (MAN-027, MAN-024).
- **C7, listing limits.** OpenAI package-stage limits are looser than final-submission limits. The final ones are used (MAN-015).
- **C8, 403 on an unauthenticated request.** Claude treats it as an error, but WAF blocks of our probe look identical. AUTH-003 makes it a warning and cross-references SRV-009.
- **C9, prompt-injection and policy heuristics.** The research proposed `error` for many regex rules. Per §1.2, only deterministic markers are errors: tag and bidi characters, explicit "ignore previous instructions", "don't tell the user", strong conversation-history property names, and secret property names. Everything else is a warning.
- **C10, local servers.** Research proposed an error for stdio targets. SRV-002 makes it info, because linting locally before deploy is a supported workflow.

### 2.12 Dedupe map
- Name format came from three sources and became TOOL-001 + TOOL-002.
- Uniqueness came from three sources and became TOOL-003.
- Annotation presence: claude + chatgpt → TOOL-011, TOOL-012.
- Annotation consistency: claude + chatgpt + spec → TOOL-013, TOOL-014.
- Catch-all and dispatcher: claude + chatgpt → TOOL-023, TOOL-024, TOOL-025.
- Fair play and interference: claude + chatgpt → INJ-006.
- Conversation data: claude + chatgpt → DATA-001.
- Promotional and ads: claude + chatgpt (two rules each) → POL-003.
- ui:// and MIME rules: claude + chatgpt + spec → APPS-001, APPS-003.
- CSP origins: claude + chatgpt + spec → APPS-007.
- PRM, AS discovery, S256, HTTPS and issuer: claude + chatgpt + spec + mechanics → AUTH-004 to AUTH-011.
- Transport and SSE: claude + chatgpt + spec + mechanics → SRV-003.
- Unknown method: spec + mechanics ×2 → SPEC-008.
- Size and timeout: two claude rules → RT-004, RT-005.
- Rules that remain manual-only: listing, package, screenshots, test cases, privacy, refresh rotation, audience validation, insufficient-scope with a real token.

---

## 3. CLI design

### 3.1 Usage
```
npx mcp-review-check <url> [options]
npx mcp-review-check --stdio "<command> [args...]" [options]
```

| Option | Default | Notes |
|---|---|---|
| `--header "K: V"` | — | Repeatable. Split at the first `:`, trim both sides. Values containing CR or LF are rejected. Values are always redacted in output. |
| `--bearer <token>` | `$MCP_REVIEW_CHECK_TOKEN` | Sent as `Authorization: Bearer`. The env var avoids leaking the token into shell history. |
| `--target claude\|chatgpt\|all` | `all` | §1.1 |
| `--format text\|json\|markdown\|sarif` | `text` | |
| `--output <file>` | stdout | When given, the full report goes to the file and a one-line summary goes to stderr. If the file cannot be written, the report goes to stdout with an error message and exit 2. |
| `--timeout <ms>` | `30000` | Per request, at most 2^31−1−1000 ms (Node clamps larger timers to 1 ms). Connect uses `min(timeout, 15000)`, `--active` calls `min(timeout, 240000)`. 2026-07-28 JSON-RPC calls read the response body within the request's own timeout; probes cap the body at 256 KB and 10 s. The GET probe uses 5 s and the TLS check 10 s. |
| `--fail-on error\|warning\|never` | `error` | Controls exit code 1. |
| `--active` | off | Enables the RT rules, which call read-only tools. |
| `--active-auth` | off | Enables AUTH-019..021. **Creates a DCR client** on your authorization server. The CLI prints this notice. |
| `--tool-args <file>` | — | JSON `{toolName: argsObject}` for RT calls. |
| `--env K=V`, `--cwd <dir>` | — | stdio only. `--env` is repeatable and merged over `getDefaultEnvironment()`. |
| `--ignore <RULE-ID>` | — | Repeatable. Ignored findings are still counted in JSON under `ignored`. |
| `--list-rules` | — | Prints the catalog (ID, platforms, severity, title, source) and exits 0. |
| `--no-color`, `--verbose`, `--help`, `--version` | — | Color is also off when stdout is not a TTY or `NO_COLOR` is set. `--verbose` prints the HTTP trace (redacted) and stdio stderr tail. |

- Exactly one of `<url>` or `--stdio` is allowed. Otherwise exit 2.
- `--stdio` is split by a small shell-like tokenizer (single quotes, double quotes, backslash escapes) and spawned **without** a shell. An unbalanced quote is a usage error (exit 2).
- Arguments are parsed with `node:util` `parseArgs` (`allowPositionals: true`, `multiple: true` for the repeatable flags).

### 3.2 Exit codes
| Code | Meaning |
|---|---|
| 0 | Completed, below the `--fail-on` threshold |
| 1 | Completed, threshold reached |
| 2 | Usage or config error, or `--output` could not be written |
| 3 | Fatal: could not reach the server or complete any handshake. A report is still emitted, containing the SRV-003 error. |

A 401 without `--bearer` is **not** fatal. The auth probe runs and the exit code follows `--fail-on`.

### 3.3 Run flow (HTTP target)
1. **Validate the URL.** Store `urlAsEntered` byte-for-byte for the AUTH-005 and APPS-011 comparisons. Evaluate AUTH-001 from the query string.
2. **Network preflight** (`probe/network.ts`):
   - DNS A and AAAA records.
   - TLS handshake.
   - Unauthenticated `POST initialize` with protocol `2025-11-25`, `redirect: 'manual'`, and the standard Accept and Content-Type headers. This exchange feeds SRV-006, SRV-007, SRV-009, AUTH-003, and the 401 decision.
3. **Auth probe.** It runs when the preflight returns 401, when the preflight returns 403 with `WWW-Authenticate`, or when a `--bearer` is rejected. It runs **regardless of `--bearer`** (§3.4).
4. **Era detection.**
   - POST `server/discover` with modern headers and `_meta` (plus auth headers when given).
   - 200 with `supportedVersions` → modern.
   - 400 with error code -32020, -32021 or -32022 → modern.
   - Anything else → legacy.
   - Then try the legacy SDK connect. If both succeed → `dual`.
5. **Connect** with SDK 1.32.1 `Client`:
   - Use `StreamableHTTPClientTransport` with `requestInit.headers` (bearer plus `--header` values) and a tracing `fetch`.
   - On `StreamableHTTPError` with code 400, 404 or 405 **and** no modern JSON-RPC error body, build a **new** Client and fall back to `SSEClientTransport`.
   - Never fall back on 401, 403 or a network `TypeError`. A network `TypeError` is retried once.
   - Modern-only servers are listed with the manual modern client (`protocol/modern.ts`).
6. **Snapshot.**
   - Raw `client.request({method, params}, z.looseObject({}))` for tools/list, resources/list, resources/templates/list and prompts/list. Follow every `nextCursor`, cap at 100 pages, and detect repeated cursors.
   - Call each list when its capability is declared. Also try tools/list when the capability is absent, for SPEC-002.
   - Then `resources/read` every UI URI.
   - Do **not** use `client.listTools()`: it Ajv-compiles every `outputSchema` and throws on malformed tools, which would hide findings.
7. **Wire probes.** These are side-effect-free and on by default. See §4.3 for the list.
8. **Active probes**, only when `--active` or `--active-auth` is set.
9. **Close.** Run `client.close()`, then rules → report → exit code.

stdio flow: `StdioClientTransport({command, args, env, cwd, stderr: 'pipe'})`. Capture stderr (the last 4 KB) and `onerror` parse failures for SRV-018. After that, steps 6–9 apply. The auth and network rules are skipped with the reason "stdio target".

### 3.4 Auth probe and coverage messaging
- The probe sequence is the one in AUTH-002..016. All requests are GETs, plus one invalid-token POST. Nothing is created.
- When the server needs auth and no valid `--bearer` was given:
  - `coverage.toolLevel = 'auth-required'`.
  - Every rule that needs tools, resources, prompts, ui or active is listed as skipped.
  - The report shows a prominent notice: **"Server requires OAuth. Auth checks ran; tool, resource and UI checks need `--bearer <token>` (obtain a token via your OAuth flow or a test account)."**
- When `--bearer` is given but rejected (401): the same notice appears, worded as "token rejected".

---

## 4. Architecture

### 4.1 Layout
```
src/
  cli.ts               parseArgs, validation, orchestration, exit codes, --list-rules
  connect.ts           buildSnapshot(opts): preflight → auth probe → era → connect/fallback → listing → wire probes → active
  snapshot.ts          Snapshot and observation types (§4.2)
  protocol/
    trace.ts           tracing fetch wrapper (records HttpExchange, redacts secrets)
    modern.ts          manual 2026-07-28 JSON-RPC client (discover, lists, read; SSE body parsing)
    stdioArgs.ts       shell-like tokenizer
  probe/
    network.ts         DNS, TLS (tls.connect), redirect, origin/host probes, domain-challenge GET
    auth.ts            WWW-Authenticate parse, PRM discovery, AS discovery, invalid-token probe, timings; active-auth probes
    wire.ts            protocol probes (§4.3)
    active.ts          read-only tool calls, argument synthesis, clientInfo variants
  rules/
    types.ts engine.ts index.ts lexicon.ts
    util/{text.ts, schemaWalk.ts, html.ts, net.ts, wwwAuth.ts}
    server.ts spec.ts tools.ts annotations.ts schema.ts injection.ts data.ts policy.ts apps.ts auth.ts runtime.ts manual.ts
  report/
    index.ts score.ts text.ts json.ts markdown.ts sarif.ts constants.ts
test/
  fixtures/ good-server.mjs bad-server.mjs http-bridge.ts auth-server.ts modern-server.ts snapshots/*.json
  rules/*.test.ts  e2e-stdio.test.ts  e2e-http.test.ts  auth-probe.test.ts  report.test.ts  catalog.test.ts
```

### 4.2 Snapshot and rule contract
```ts
type Platform = 'claude' | 'chatgpt' | 'spec';
type Severity = 'error' | 'warning' | 'info';
type Era = 'modern' | 'legacy' | 'dual' | 'sse-legacy' | 'unknown';

interface HttpExchange {
  label: string; method: string; url: string;
  requestHeaders: Record<string, string>;        // redacted
  status?: number; headers?: Record<string, string>; contentType?: string;
  bodySnippet?: string;                            // ≤ 4 KB
  json?: unknown; durationMs: number;
  error?: { name: string; code?: string | number; causeCode?: string; message: string };
}

interface Snapshot {
  target: { kind: 'http'; urlAsEntered: string; url: URL } | { kind: 'stdio'; command: string; args: string[] };
  localMode: boolean;
  era: Era; protocolVersion?: string;
  serverInfo?: Record<string, unknown>;            // raw, unvalidated
  capabilities?: Record<string, unknown>;
  instructions?: unknown;
  initializeRaw?: unknown; discoverRaw?: unknown;
  tools: Record<string, unknown>[]; resources: Record<string, unknown>[];
  resourceTemplates: Record<string, unknown>[]; prompts: Record<string, unknown>[];
  listMeta: Record<string, { pages: number; rawPages: unknown[]; error?: string }>;
  toolsRelist?: string[]; toolsFreshConnection?: string[];
  resourceReads: Record<string, { ok: boolean; raw?: unknown; error?: unknown; durationMs: number }>;
  transport: {
    kind: 'streamable-http' | 'sse' | 'stdio';
    exchanges: HttpExchange[];                     // full trace incl. SDK traffic
    preflight?: HttpExchange;
    dns?: { a: string[]; aaaa: string[]; error?: string };
    tls?: Array<{ host: string; ok: boolean; code?: string }>;
    probes: Partial<Record<WireProbeName, HttpExchange | JsonRpcObservation>>;
    timings: Record<string, number[]>;
    sessionId?: string;
    stdio?: { nonJsonStdout: string[]; stderrTail: string };
  };
  authProbe?: {
    trigger: 'preflight-401' | 'preflight-403' | 'bearer-rejected';
    challenge?: { status: number; raw: string; parsed: Array<{ scheme: string; params: Record<string, string> }> };
    prmAttempts: HttpExchange[]; prm?: { url: string; via: 'header' | 'well-known-path' | 'well-known-root'; json: Record<string, unknown> };
    as: Array<{ issuer: string; attempts: HttpExchange[]; discoveryUrl?: string; json?: Record<string, unknown> }>;
    invalidToken?: HttpExchange;
    active?: { dcr?: HttpExchange; clientId?: string; authorize?: HttpExchange[]; token?: HttpExchange[] };
  };
  active?: { calls: Array<{ tool: string; kind: 'valid' | 'synthetic' | 'invalid-missing' | 'invalid-type'; args: unknown;
                           result?: unknown; jsonRpcError?: unknown; httpStatus?: number; durationMs: number }>;
             clientInfoVariants?: Record<string, string[]> };
  coverage: { toolLevel: 'ok' | 'auth-required' | 'token-rejected' | 'connect-failed'; reason?: string };
  options: { target: 'claude' | 'chatgpt' | 'all'; active: boolean; activeAuth: boolean };
}

interface RuleMeta {
  id: string; title: string;
  severity: Partial<Record<Platform, Severity>>;   // keys = platforms
  needs: Array<'tools'|'resources'|'prompts'|'ui'|'http'|'stdio'|'auth'|'legacy'|'modern'|'active'|'active-auth'>;
  rationale: string; fix: string; sources: string[];
}
interface RawFinding {
  message: string; severity?: Severity; platforms?: Platform[];
  tool?: string; resource?: string; path?: string; evidence?: string;
}
interface Rule extends RuleMeta { check(snap: Snapshot): RawFinding[] }   // pure, synchronous, no I/O
```
- The engine:
  - evaluates `needs` and records skipped rules with their reasons
  - catches exceptions thrown by a rule and turns them into an `INTERNAL` info finding
  - applies §1.2 platform filtering and severity
  - applies `--ignore`
  - sorts the findings
- All I/O lives in `connect.ts` and `probe/*`. Rules are pure functions over the snapshot. This makes them unit-testable from JSON snapshots.
- `catalog.test.ts` asserts:
  - IDs are unique and match `/^(SRV|SPEC|TOOL|INJ|DATA|POL|APPS|AUTH|RT|MAN)-\d{3}$/`
  - every rule has at least one source URL and at least one platform
  - IDs match a frozen list, so a removed ID is never reused

### 4.3 Default wire probes (side-effect-free)
| Probe | Request | Rules |
|---|---|---|
| preflight | unauthenticated POST initialize, redirect manual | SRV-006/007/009, AUTH-001/003, auth trigger |
| discover | POST server/discover (modern headers and `_meta`) | era, SPEC-011..013 |
| notification | captured from the SDK `notifications/initialized` POST | SPEC-004 |
| get | GET with Accept event-stream, aborted after headers | SPEC-005, SPEC-015 |
| badVersion | tools/list with `MCP-Protocol-Version: 1900-01-01` (legacy), or discover (modern) | SPEC-007 |
| unknownMethod | `mcp-review-check/nonexistent` | SPEC-008, SPEC-016 |
| unknownTool | tools/call `mcp_review_check_nonexistent_tool` | SPEC-009 |
| resourceMissing | resources/read `mcp-review-check://does-not-exist` | SPEC-010 |
| headerMismatch (modern) | tools/list without `Mcp-Method`, then with a wrong one | SPEC-014 |
| delete (modern-only) | DELETE endpoint | SPEC-015 |
| origins | initialize with Origin claude.ai, chatgpt.com, evil.invalid | SRV-008 |
| relist / fresh | tools/list again; new connection tools/list | SRV-019 |
| challenge | GET `/.well-known/openai-apps-challenge` | SRV-016 |

That totals about 20 requests per run with no writes. Legacy probes reuse the SDK session id via `transport.sessionId` and `transport.protocolVersion`, which are instance getters and not part of the Transport interface type.

### 4.4 Node 18 compatibility (mandatory)
- **Runtime dependencies:**
  - `@modelcontextprotocol/sdk` `~1.32.1`. Its engines field is `>=18`. It speaks only the 2025-11-25 era (`LATEST_PROTOCOL_VERSION = '2025-11-25'`).
  - `zod` `^4`, a required peer of the SDK. Import as `zod/v4`, the same way the SDK does.
  - `ajv` `^8.17`, already a dependency of the SDK. It is declared explicitly so we do not rely on hoisting. It is used for TOOL-017 and RT-006 (`ajv/dist/2020.js`).
  - Argument parsing uses `node:util` `parseArgs`. There is no other runtime dependency.
- **Forbidden packages:**
  - SDK v2 (`@modelcontextprotocol/client`, `/core`, `/server` 2.x need Node ≥20)
  - `@modelcontextprotocol/ext-apps` (Node ≥20)
  - `@modelcontextprotocol/inspector` (Node ≥22)
  - The MCP Apps constants are re-declared locally.
- The `EBADENGINE` warning for `@hono/node-server` during install is harmless: it is used only by the SDK server-side HTTP transport, and the CLI never loads it.
- **Imports:**
  - `@modelcontextprotocol/sdk/client/index.js`
  - `/client/streamableHttp.js` (`StreamableHTTPClientTransport`, `StreamableHTTPError`)
  - `/client/sse.js` (`SSEClientTransport`, `SseError`)
  - `/client/stdio.js` (`StdioClientTransport`, `getDefaultEnvironment`)
  - `/types.js` (`McpError`, `ErrorCode`, `LATEST_PROTOCOL_VERSION`)
- **SDK documentation gap:** with no `authProvider`, a 401 throws `StreamableHTTPError` with `.code === 401`, **not** `UnauthorizedError`. Classify errors as follows:
  - 401 → auth-required
  - 403 → forbidden (insufficient_scope or WAF)
  - 400, 404, 405 → maybe SSE
  - `McpError` → JSON-RPC
  - `TypeError` (check `cause.code`) → network
- The OAuth discovery is our own fetch code, not `discoverOAuthServerInfo`. That helper falls back to treating the MCP origin as the authorization server, and it hides the attempts and timings we need. A parity test compares our PRM parse against the SDK's `extractWWWAuthenticateParams`.
- **Node 18 built-ins used:** global `fetch` (undici; `redirect: 'manual'` exposes the real 3xx and `Location`), `AbortSignal.timeout`, `crypto.randomUUID`, `crypto.createHash`, `dns.promises`, `tls.connect`. The modern SSE responses use a small line parser of our own (`data:` lines, matched by id).
- **Build:**
  - TypeScript `~5.9`, `module`/`moduleResolution: NodeNext`, `target: ES2022`, `strict`, `@types/node@^18.19`.
  - If fetch types are missing, add `lib: ["ES2022", "DOM"]`. Verify this in milestone M0.
  - ESM package (`"type": "module"`), with `bin: { "mcp-review-check": "dist/cli.js" }` and a shebang.
  - `engines.node: ">=18.19"`.
  - No publishing in this phase. Run locally with `node dist/cli.js` or `npm link`.
- **Dev dependencies:** `vitest@^3.2` (supports Node 18; do not use vitest 4), `typescript`, `@types/node`.

### 4.5 Redaction
- `Authorization`, `Cookie`, `--header` values, and query values matched by AUTH-001 are replaced with `«redacted»` in every format and in `--verbose` traces.
- Token-like values found by RT-010 are shown as their first 4 characters followed by `…`.

---

## 5. Report UX

### 5.1 Text (default)
```
mcp-review-check 0.1.0 · rules 2026-10-22 · target: all
Server  Acme Docs 1.4.2 · https://mcp.acme.com/mcp
Transport streamable-http · era legacy (2025-11-25) · auth OAuth (CIMD, S256)
Checked 12 tools · 3 resources · 1 prompt · 2 UI resources · 104 rules run · 18 skipped (need --active)

ERRORS (3)
  x TOOL-011 [claude] delete_invoice: neither readOnlyHint nor destructiveHint is set
      fix  Add annotations { readOnlyHint: false, destructiveHint: true }
      docs https://claude.com/docs/connectors/building/submission
  x TOOL-012 [chatgpt] 7 tools missing openWorldHint: search_docs, get_doc, list_spaces, +4 more
      fix  Set readOnlyHint, destructiveHint and openWorldHint to explicit booleans
      docs https://developers.openai.com/plugins/plugin-guidelines
WARNINGS (5)
  ! INJ-006 [claude, chatgpt] search_docs (tool.description): "…never use other search tools…"
  ...
INFO (4)
  i ...

MANUAL CHECKLIST (not verified automatically)
  [ ] MAN-001 [claude] Privacy policy URL (data collection, usage, retention)
  ...

Score 62/100 · 3 errors · 5 warnings · 4 info
Claude: BLOCKED (2 errors) · ChatGPT: BLOCKED (1 error) · Result: FAIL (--fail-on error)

Passing these automated checks does not guarantee approval. Directory reviews include manual
testing and policy judgment, and requirements change. Rules reflect public docs as of 2026-10-22.
mcp-review-check is independent and not affiliated with Anthropic or OpenAI.
```
- Findings are grouped by severity (errors, then warnings, then info), sorted by rule ID and then by subject.
- Within a severity group, more than 3 findings of the same rule and message template are collapsed into one line with `+N more`. `--verbose` expands them.
- Each finding shows the rule ID, its platforms (a platform whose own severity is lower is annotated, e.g. `[spec, chatgpt: warning]`), the subject (tool, resource or `server`) with its location, the message, the fix hint and the first source link.
- Markers are the ASCII characters `x`, `!` and `i`. Colors are red, yellow and cyan. There are no emojis.
- When coverage is `auth-required`, the §3.4 notice is printed right after the header. When it is `list-failed`, the tools/list error and "Tool, injection, data and policy checks could not run (see SPEC-020)" are printed.
- The target URL is shown through `displayUrl` (§1.5) in every format.

### 5.2 Score and verdict
- `score = max(0, round(100 − 12·E − 4·W))`. Each rule contributes at most 3 penalized findings, so one systemic issue does not zero the score. Info findings and MAN items do not count.
- Scores are computed over the findings for the active platforms.
- Per-platform verdict:
  - `BLOCKED`: at least one error for that platform, counted at `severityByPlatform[platform]` (§1.2)
  - `NEEDS ATTENTION`: warnings only
  - `NO AUTOMATED BLOCKERS`: neither
- The score is labeled provisional in `--help`.

### 5.3 Other formats
- **json:**
  ```
  { tool: {name, version, catalogDate}, target, startedAt, durationMs,
    server: {url|command, serverInfo, era, protocolVersion, transport, auth},
    coverage, summary: {errors, warnings, info, score, verdicts: {claude?, chatgpt?}, failed},
    findings: [{ruleId, severity, platforms, severityByPlatform, title, message, tool?, resource?, path?, evidence?, fix, docs: string[]}],
    skipped: [{ruleId, reason}], ignored: [...], manual: [{id, platforms, text, docs}],
    disclaimer, contact: {text, url} | null }
  ```
  Findings are not collapsed.
- **markdown:** an H1 with the server name, a summary table, then one H2 per severity with a table (`Rule | Platforms | Subject | Message | Fix | Docs`), then a manual checklist as `- [ ]` items, then the disclaimer and the CTA. Pipes inside cells are escaped.
- **sarif:** SARIF 2.1.0.
  - `tool.driver` = mcp-review-check, with `rules[]` taken from the catalog (`id`, `shortDescription`, `helpUri` = first source, `properties.platforms`).
  - Level mapping: error→`error`, warning→`warning`, info→`note`.
  - Each result has `logicalLocations` `[{name: tool, kind: 'function'}]` and `physicalLocation.artifactLocation.uri` set to the redacted server URL (`new URL().href`, so it is a valid URI), or `stdio:` + `encodeURIComponent(command)`.
  - `tool.driver.informationUri` is written only when `CONTACT_URL` is an absolute http(s) URL.
  - The output validates against the official SARIF 2.1.0 schema (vendored in `test/fixtures/sarif-schema-2.1.0.json`).
  - Manual items are excluded.
  - Known limitation: GitHub code scanning cannot link these results to source lines.

### 5.4 CTA constant
`src/report/constants.ts`:
```ts
export const CONTACT_URL = '';  // set to a real absolute https URL before release; no brand or URL is invented here
export const CTA_TEXT = 'Need help getting your connector approved?';
```
- When `CONTACT_URL` is a valid absolute http(s) URL (`contactUrl()`), every format prints `${CTA_TEXT} ${CONTACT_URL}` and JSON puts it in `contact`.
- Otherwise (empty, or a placeholder such as `<CONTACT_URL>`) the CTA is omitted and JSON `contact` is `null`.

---

## 6. Testing (vitest)

- **Unit tests per rule file:**
  - Hand-written minimal `Snapshot` JSON in `test/fixtures/snapshots/`.
  - Each rule gets at least one positive case and one negative case.
  - Heuristic rules also get the documented false-positive guards as negative cases: "only use this tool when…", emoji ZWJ, a Slack `thread` id, own-tool workflow hints, an entity-type `type` enum, Cyrillic-only text.
- **Fixture servers:**
  - `good-server.mjs`: stdio, SDK `McpServer`.
    - Tools are fully annotated, with titles, descriptions and parameter descriptions.
    - A read-only tool returns `structuredContent` that matches its `outputSchema` and is mirrored as text.
    - A `ui://` resource uses the correct MIME type, a CSP that covers its origins, a correct `openai/widgetDomain`, and `prefersBorder`.
    - Expectation: **zero errors and zero warnings** for `--target all` in local mode, ignoring the local-mode info findings.
  - `bad-server.mjs`: stdio, low-level SDK `Server` with raw `setRequestHandler` responses, so malformed payloads reach the checker.
    - It writes a stdout banner, and has:
      - a 70-character name
      - duplicate names
      - an `api_request` tool with a GET/POST method enum
      - an `action` enum mixing get and delete
      - a missing title and missing annotations
      - `readOnlyHint` and `destructiveHint` both true
      - `delete_x` marked readOnly
      - an inputSchema whose root type is `array`
      - a network `$ref`
      - a `conversation_history` parameter
      - a `password` parameter
      - a `card_number` parameter
      - a description containing "ignore previous instructions", a U+E0001 tag character, an HTML comment, and "never use other tools"
      - a `transfer_funds` tool
      - a UI tool pointing to an `https://` URI
      - a UI resource with the wrong MIME type and an undeclared script origin
      - an unknown method returning -32602
    - Expectation: the set of emitted rule IDs equals a frozen list (snapshot test).
  - `http-bridge.ts`: an in-process `node:http` server bridging to an SDK `McpServer` or `Server` through `InMemoryTransport` from `@modelcontextprotocol/sdk/inMemory.js`.
    - POST parses the JSON-RPC message, forwards it, and awaits the response with the matching id. Notifications get 202.
    - Switches: wrong Content-Type, 200 for notifications, cross-host 301, `Invalid Host` 403, Origin strictness, session ids, SSE-only mode (GET `endpoint` event).
    - We do this instead of the SDK's server-side Streamable HTTP transport because that transport may pull in `@hono/node-server`, which needs Node ≥20. M0 verifies; if it loads cleanly, it may be used too.
  - `auth-server.ts`: `node:http` serving 401 and PRM/AS metadata.
    - Good variant, modeled on the Linear shape: header PRM, path-aware well-known, issuer match, S256, CIMD + none, iss supported.
    - Bad variants: no `WWW-Authenticate`, `resource` mismatched by a trailing slash, two authorization servers, issuer mismatch, no S256, no CIMD/DCR, `client_credentials`-only grants, 200 for an invalid token, 1 s artificial delay (for timing logic with injected thresholds).
  - `modern-server.ts`: a raw 2026-07-28 server.
    - Good variant, modeled on the Cloudflare shape: discover, resultType, ttlMs/cacheScope, -32020/-32022/404-32601, GET 405.
    - Bad variant: missing ttlMs, mismatched cacheScope across pages, sessions minted.
- **E2E tests:** spawn `dist/cli.js` (built in `globalSetup`) against the fixtures and assert:
  - exit codes 0, 1, 2 and 3
  - `--format json` schema shape
  - SARIF validity (required keys; schema validation in the report tests)
  - `--target claude` drops chatgpt-only findings
  - `--ignore`
  - redaction: no bearer value appears anywhere in the output
  - 401 → coverage notice plus auth findings
- **Determinism and network isolation:**
  - DNS, TLS and clock access go through an injectable `deps` object (`resolve4`, `resolve6`, `tlsCheck`, `now`), so the tests never touch the network.
  - Localhost fixtures use local mode.
  - Network-dependent smoke tests against DeepWiki, Cloudflare, Linear and Notion run only behind `MCP_REVIEW_CHECK_LIVE=1` and are excluded from CI.
- **Catalog and parity tests:** catalog invariants (§4.2), and SDK parity for WWW-Authenticate parsing.

---

## 7. Milestones
- **M0, Node 18 spike:**
  - install the pinned dependencies
  - verify the deep imports, `zod/v4`, `ajv/dist/2020.js`, fetch typings, and that `InMemoryTransport` exists
  - check whether `sdk/server/streamableHttp.js` loads on Node 18
- **M1:** CLI skeleton, `connect.ts` (legacy plus SSE fallback, stdio), snapshot listing, engine, text and JSON report, SRV-001..003 and TOOL-001..016.
- **M2:** the remaining TOOL rules, INJ, DATA and POL, the good/bad stdio fixtures, and the frozen-ID test.
- **M3:** the auth probe and AUTH-001..018, the auth fixtures, and the coverage messaging.
- **M4:** wire probes, modern client, SPEC rules, the http-bridge and modern fixtures.
- **M5:** the APPS rules and the HTML origin extractor.
- **M6:** markdown and SARIF output, score, manual checklist, `--list-rules`, `--ignore`.
- **M7:** `--active` (RT-001..012) and `--active-auth` (AUTH-019..021).

---

## 8. Open questions
- **Q1:** Does ChatGPT read `_meta.ui.domain` ahead of `openai/widgetDomain` when both are present? This decides whether one server can satisfy both hosts' domain rules (§2.11 C1). Until confirmed, APPS-012 prefers `openai/widgetDomain`.
- **Q2:** Should SRV-004's "no A record" be checked against public DNS (DoH) instead of the system resolver? v1 uses the system resolver and says so in the message.
- **Q3:** Should listing and manifest linting (`--listing listing.json`, `--plugin plugin.json`) turn the MAN-002/015..024 items into automated checks? This is planned for v1.1.
- **Q4:** The score weights (12/4, cap of 3 per rule) are provisional. Revisit them after running the tool on real servers.
