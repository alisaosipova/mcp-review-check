# mcp-review-check: Implementation SPEC

> **Design document; it may differ from the implementation.** This is the plan the first version was built from.
> It is kept for the reasoning behind each rule, not as user documentation. For current behaviour see the
> [README](../../README.md), [docs/RULES.md](../RULES.md), `mcp-review-check --help` and `mcp-review-check explain <RULE-ID>`;
> the catalog in `src/rules/` is authoritative for rule IDs, severities and sources.
>
> Known differences: the catalog has <!-- RULE_COUNT -->180<!-- /RULE_COUNT --> automated rules (APPS-019 added) and <!-- MANUAL_COUNT -->31<!-- /MANUAL_COUNT --> manual checklist items, dated
> <!-- CATALOG_DATE -->2026-11-02<!-- /CATALOG_DATE -->; Node 22.12+ is required, so the Node 18 notes in §4.4 and milestone M0 are historical, and the test
> runner is vitest 4. The exit code counts only the `--target` directories (spec findings only with `--fail-on-spec`),
> the score counts root causes (`scoreVersion` 2), several severities changed (for example TOOL-007, SRV-001, SRV-008),
> and the CLI gained options such as `--max-duration`, `--fail-on-incomplete`, `--baseline`, `--quiet`, `--checklist`, `--local`, `--no-local`, `explain`,
> `--config`, `--json-output`, `--save-baseline`, `--format junit`, `--fail-on-drift`, `--diff-only`, `--plugin-dir` and `--openai-manifest`.
> See CHANGELOG.md for the full list. Many detection patterns quoted in §2 (INJ, DATA, POL, APPS, AUTH, SPEC, TOOL and RT rules)
> were narrowed or extended after 0.1.0 to fix false positives; CHANGELOG.md names each change, and the code in
> `src/rules/` is authoritative where this document quotes an older pattern.

Spec version 0.1. Rule catalog date 2026-11-02 (public sources read as of 2026-10-22; the vendor checklists behind LST-001..LST-026 and the 2026-07-28 specification pages behind SPEC-021..023 were re-read on 2026-11-02; the vendor tool-name and tool-budget limits behind TOOL-002, TOOL-033 and TOOL-034 were checked on 2026-11-01). Status: implemented in 0.1.0 (milestones M0–M7 done); later changes are tracked in [CHANGELOG.md](../../CHANGELOG.md). The behaviour changes of 0.2.0 that alter a contract described here (exit codes §3.2, stopped runs §3.3, `--baseline` §3.5, the GitHub Action §3.6, the package surface §4.1, report fields §4.2 and §5.3, TOOL-002 and TOOL-033..035 in §2.3, SPEC-016 in §2.2, and the answers to Q5–Q8 in §8) are written into this document too, and so are the additions of 0.3.0 (the options in §3.1, the baseline loop in §3.5, the action outputs in §3.6, the config file in §3.7, the input caps and stopped runs in §3.3 and §4.2, Node 22.12 in §4.4, the JUnit format in §5.3), and those of 0.4.0 (the drift, listing and schema options in §3.1, exit 1 for drift and the budget stop in §3.2, drift in §3.5, the config keys in §3.7, the listing inputs in §3.8, the snapshot byte budget and the exchange summary in §4.2, BASE-001 and the report schema in §5.3, SPEC-021..023 in §2.2, AUTH-012 in §2.8, LST-001..026 in §2.13, and the answers to Q1–Q4 in §8).

`mcp-review-check` is a CLI that connects to an MCP server, takes a snapshot of what the server exposes, and checks it against the public review criteria of the Claude connector directory, the ChatGPT plugin directory, and the MCP specification. It runs on Node 22.12 or newer (the plan said Node 18; see §4.4), sends no telemetry, and links every rule to a public source. Checks that cannot be automated are printed as a manual checklist.

Non-goals for v1:
- Full JSON-schema conformance of every wire message. That is the job of `@modelcontextprotocol/conformance`, and the report may suggest running it.
- Linting listing or plugin manifests. Those items appear as manual checklist entries in v1; 0.4.0 automates part of them (§3.8, §2.13).
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
| `plugin-dir` / `openai-manifest` | `--plugin-dir` / `--openai-manifest` was given (0.4.0, §3.8) |

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
- **`corpus(snap)`**: a list of `{text, where, tool?, path?}` entries. `where` is one of `tool.name`, `tool.title`, `tool.annotations.title`, `tool.description`, `param.description` (with a JSON pointer), `instructions`, `prompt.description`, `prompt.argument.description`, `resource.description`, or `resourceTemplate.description`. Since 1.1.0 also `param.title` (every schema node), `param.enum` (string `enum` values and a string `const`), `param.default` and `param.examples` (string leaves of `default`, `examples`, `example`, at most 200 per keyword) and `param.name` (property keys), with JSON pointers to the string. A scope selects them: `values` (enum/const, on by default), `samples` (default/examples) and `keys` (property names); INJ-001 reads all, INJ-003 and INJ-005 add samples, POL-003/004 read neither enum nor samples. Hidden-character scans run on the raw text. Regex scans run on `scanForm(text)` (1.1.0): NFKC, then format characters, controls other than tab/LF/VT/FF/CR/space (so U+FEFF too), CGJ, U+17B4/17B5 and variation selectors removed and Hangul fillers and U+2800 replaced by a space; a message whose match needed the fold names the folded code points. The corpus is built once per snapshot.Since 1.1.0 also `param.title` (every schema node), `param.enum` (string `enum` values and a string `const`), `param.default` and `param.examples` (string leaves of `default`, `examples`, `example`, at most 200 per keyword) and `param.name` (property keys), with JSON pointers to the string. A scope selects them: `values` (enum/const, on by default), `samples` (default/examples) and `keys` (property names); INJ-001 reads all, INJ-003 and INJ-005 add samples, POL-003/004 read neither enum nor samples. Hidden-character scans run on the raw text. Regex scans run on `scanForm(text)` (1.1.0): NFKC, then format characters, controls other than tab/LF/VT/FF/CR/space (so U+FEFF too), CGJ, U+17B4/17B5 and variation selectors removed and Hangul fillers and U+2800 replaced by a space; a message whose match needed the fold names the folded code points. The corpus is built once per snapshot. From 1.1.1 a stopped or budget-exhausted run shares it too: the memo is keyed by the raw tools list, not by the read-tracking view each rule of such a run gets (A09-06). From 1.1.1 the fold note is added only when a folded character falls inside the match range on the scan form, and never names a variation selector on a base it is defined for (A10-04).
- **`walkSchema(schema, visit)`**: recursive walk through `properties`, `items`, `prefixItems`, `additionalProperties` (when it is an object), `anyOf/oneOf/allOf/not/if/then/else`, `$defs/definitions`, and local `$ref` targets (`#/...`). It yields `{path, name, node}` with cycle protection and a depth cap of 64. Property names are normalized to lowercase snake_case for name matching.
- **`resolvedNode(root, node)` / `enumValues(node)`** (`util/schemaWalk.ts`, 1.0.1): a property's local `$ref` chain merged into one node, and its closed value list (`enum`, `const`, or an anyOf/oneOf whose every branch is a const/enum, an optional `{type:'null'}` branch aside). Rules that read a property's type, enum or format judge the resolved node too: TOOL-015, and the DATA-001/003/005 name skips, where the resolved node can only add a skip. With `{open: true}` (1.1.0) the const/enum values of an anyOf/oneOf are returned even beside a free branch (TOOL-023/024); a resolved node drops its `$ref`, so the target's shape is judged. `unwrapNullable(root, node)` (1.1.1, A05-05) reads an optional wrapper (anyOf/oneOf with exactly one branch besides `{type:'null'}`, as pydantic `Optional[X]` and zod `.nullable()` emit) as that branch, resolved through its `$ref` chain, under the node's own keywords; `enumValues(node, {root})` reads `$ref` branches through their targets. Both are used only where they clear a finding: the free-form tests of TOOL-015/023/025/026, the DATA name skips, and TOOL-021 (c). The TOOL-023 method-mix and TOOL-024 value lists keep reading the node as written. Name splitting (`snakeCase`, `tokenize`) and the CSS `url()` scan are linear in the input.
- **`extractOrigins(html)`**: regex-based, no DOM dependency. From 1.1.1 the tag, `@import` and CSS `url()` scans read `stripHtmlComments(html)` (A05-12): a forward, linear tokenizer removes only what a browser reads as a comment. A `<!--` inside a tag (quote-aware), a bogus comment or a raw-text element (script, style, title, textarea, xmp, iframe, noembed, noframes, noscript; plaintext to the end) opens none; a comment ends at once on `<!-->`/`<!--->`, otherwise at the nearest `-->` or `--!>`; anything unclosed is kept. The JS patterns read the raw HTML.
  - Returns `{kind: 'resource'|'connect'|'frame'|'base'|'navigate', origin, evidence, confidence: 'tag'|'js'}`.
  - `tag` confidence (the URL sits in a tag attribute):
    - `<script src>`, `<link href rel=stylesheet|preload|icon|modulepreload>`, `<img src/srcset>`, `<source src>`, `<video|audio src>`, `@import`, CSS `url()`, `@font-face src` → resource
    - `<iframe src>` → frame
    - `<video poster>`, `<embed src>`, `<object data>` → resource (1.1.0)
    - `<base href>` → base
  - `js` confidence (literal https/wss URL as the first argument):
    - `fetch(`, `new WebSocket(`, `new EventSource(`, `.open('<any method>', ...)`, `navigator.sendBeacon(`, `axios.*(` / `ky(` → connect
    - `new Worker(`, `new SharedWorker(` → resource (1.1.0)
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
  - `capabilities.tasks` (2025-11-25), or an own key `io.modelcontextprotocol/tasks` in `capabilities.extensions` (2026-07-28, 1.1.0), in every capability object the server announced (initialize, and server/discover on a dual-era server)
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
  - `ttlMs` is a number ≥ 0 but not an integer → warning (1.1.0; the caching page defines it as integer milliseconds, the MUST covers only ≥ 0).
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
  - A successful response (a `result`, no `error`) whose `id` is not the request's (strict comparison: `"6"` does not echo `6`) → **warning** "`<source>`: result answers another request id (response id X, request id Y)". Such an entry (`observedError.result: true`, with the request `method`) has no `code`, so the code checks do not apply to it. When the response is to `tools/list`, `resources/list` or `prompts/list` and SPEC-020 reports that listing as failed because of the mismatch, SPEC-016 leaves it to SPEC-020, so one exchange is not reported twice.
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

**SPEC-021 Deprecated protocol features in use.** Severity: spec=info.
- Detect, each as info (the deprecated features registry says new implementations SHOULD NOT adopt a Deprecated feature; there is no MUST NOT):
  - `capabilities.logging`, `capabilities.sampling` or `capabilities.roots` in the initialize or server/discover capabilities. Sampling and roots are client capabilities, and the message says so. A dual-era server whose two capability objects both show the problem gets one finding naming both.
  - `transport.kind === 'sse'` (HTTP+SSE only, deprecated since 2025-03-26). SRV-003 carries the directory consequence.
  - `inputRequests` entries with `sampling/createMessage` or `roots/list` in 2026-07-28 `input_required` results or in active tool-call results, and, separately, `includeContext` `"thisServer"` / `"allServers"` in such a sampling request. Methods are looked up in a `Map`, so `constructor` is not a deprecated request.
- Not duplicated: SRV-015 (Claude support of sampling/tasks/subscriptions).
- Source: https://modelcontextprotocol.io/specification/2026-07-28/deprecated, https://modelcontextprotocol.io/specification/2026-07-28/changelog#deprecated (SEP-2577, SEP-2596)

**SPEC-022 2026-07-28 results identify the server.** Severity: spec=info. Needs: modern.
- Detect: an object result in `transport.modernResults` (or `discoverRaw` when no server/discover result is recorded) without `_meta["io.modelcontextprotocol/serverInfo"]` (servers SHOULD include it on every response). The finding lists the methods once. A second finding covers a value that is not an object with string `name` and `version`.
- Source: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts (`ResultMetaObject`), the 2026-07-28 changelog (SEP-2575)

**SPEC-023 capabilities.extensions well-formed.** Severity: spec=error.
- Detect, in the initialize and server/discover capabilities:
  - `extensions` is not an object → error.
  - An identifier has no `/`, or has an invalid prefix label or name per the `_meta` key rules (a mandatory prefix is a MUST in schema.ts) → error.
  - A settings value is not an object (`JSONObject`) → error.
  - A well-formed identifier under a non-official prefix reserved for MCP (for example `dev.mcp/x`) → warning, the level SPEC-018 gives that `_meta` rule. Official `io.modelcontextprotocol/*` identifiers pass.
  - `io.modelcontextprotocol/tasks` declared while `tasks/get`, `tasks/update` or `tasks/cancel` has no recorded result → info "declared, not verified". The run does not call them yet (a read-only `tasks/get` with a bogus `taskId` is a later connect item); the extension text does not state in one sentence that all three must be implemented, which is why this part is not an error.
- Source: schema.ts (`ServerCapabilities.extensions`), https://modelcontextprotocol.io/docs/extensions/overview, https://github.com/modelcontextprotocol/ext-tasks/blob/main/specification/2026-07-28/tasks.md

### 2.3 TOOL: tool metadata and schemas
All TOOL rules need `tools`. The message names `tool.name`.

**TOOL-001 Tool name characters and length.** Severity: spec=warning.
- Detect: the name does not match `/^[A-Za-z0-9_.-]{1,128}$/`. List the offending characters. A non-string name → **error**.
- Fix: rename using only letters, digits, `_`, `-` and `.`.
- Source: https://modelcontextprotocol.io/specification/2025-11-25/server/tools

**TOOL-002 Tool name at most 64 characters.** Severity: claude=error, chatgpt=error.
- Detect: `[...name].length > 64`. The Claude cap comes from the directory policy (the Claude API itself accepts 128 characters); the OpenAI API rejects function names over 64 characters. The character set is TOOL-033.
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy, https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create

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
  - a string property named `/^(url|uri|href|link|endpoint|webhook(_url)?|host|hostname)$/i`, or with `format: 'uri'`, that has no enum, const list (`enumValues`) or pattern, judged on the property node and on its local `$ref` target; a `$ref` that does not resolve locally is not reported
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
- Detect, for each of `inputSchema` and `outputSchema`: depth over 10 or more than 200 subschemas *(linter-defined)*.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic#composition-keyword-resource-use

**TOOL-021 x-mcp-header constraints.** Severity: spec=error.
- Detect, for every node with `x-mcp-header`:
  - (a) the value is not an RFC 9110 token `/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/`
  - (b) the value is duplicated within the tool (compared case-insensitively)
  - (c) the property type is not string, integer or boolean. A nullable primitive is accepted (1.1.1, A05-13): `type: [prim, 'null']`, or anyOf/oneOf of one primitive and `{type:'null'}`. The schema-extension text limits the annotation to primitive types and does not forbid null; its own table says a `null` value makes the client omit the header.
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

**TOOL-033 Tool name matches the vendor API pattern.** Severity: claude=error, chatgpt=error.
- Detect: a string name that is empty or contains a character outside `[A-Za-z0-9_-]`. The message lists each offending character once (up to 10) and the limits: Claude API `^[a-zA-Z0-9_-]{1,128}$`, OpenAI API a-z, A-Z, 0-9, `_` and `-`, at most 64 characters. Length over 64 is TOOL-002; a non-string name is TOOL-001. The `.` that TOOL-001 (MCP specification) allows is an error here, because both vendor APIs reject it.
- Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools, https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create

**TOOL-034 Tool list budget.** Severity: claude=info, chatgpt=info.
- Detect: `tools.length > 40` or `JSON.stringify(tools).length > 65536` *(linter-defined, `TOOL_LIST_MAX_COUNT` / `TOOL_LIST_MAX_BYTES` in `src/limits.ts`)*, measured after the input caps (16 KB per string, README "Input caps"). One finding per server. The message gives the count and size, an estimate of context tokens (chars / 4), and suggests consolidating related tools or hiding rarely used ones. Anthropic notes that tool selection degrades past 30–50 tools; OpenAI suggests fewer than 20 functions at the start of a turn. The MCP specification sets no budget, so `spec` is not a platform.
- Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool, https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools, https://developers.openai.com/api/docs/guides/function-calling

**TOOL-035 Schema lint: dangling required, keyword typos, unknown format.** Severity: spec=info.
- Scope: every node `walkSchema` visits in `inputSchema` and `outputSchema` (properties, items, combinators, `$defs`, local `$ref` targets).
- Detect:
  - (a) a node with its own `properties` whose `required` names a key not in `properties`. Skipped when the node admits extra keys (`additionalProperties` true or a schema, `patternProperties`, `unevaluatedProperties` true or a schema), composes properties (`allOf`, `anyOf`, `oneOf`, `$ref`, `$dynamicRef`, `if`, `dependentSchemas`, `dependencies`), or sits under `allOf/anyOf/oneOf/not/if/then/else/dependentSchemas/dependencies`.
  - (b) a node key that is not a known keyword and is one edit (insert, delete, substitute, or adjacent swap) from a known keyword of at least 5 characters, or a singular form of a plural keyword (`property`, `additionalProperty`, `patternProperty`, `unevaluatedProperty`). Known keywords: draft-04 to 2020-12 plus OpenAPI `nullable`, `discriminator`, `xml`, `externalDocs`, `example`. Keys starting with `x-` are ignored; property names are never compared.
  - (c) a string `format` outside JSON Schema 2020-12 §7.3, the draft-03/04 legacy names and the OpenAPI format registry.
- Source: https://json-schema.org/draft/2020-12/json-schema-validation, https://json-schema.org/draft/2020-12/json-schema-core, https://spec.openapis.org/registry/format/, https://modelcontextprotocol.io/specification/2026-07-28/basic#json-schema-usage

**TOOL-036 Every $ref resolves inside the schema.** Severity: spec=warning. (1.1.0)
- Detect, for `inputSchema` and `outputSchema`: a `$ref`, `$dynamicRef` or `$recursiveRef` whose `#/...` pointer names nothing, whose `#name` fragment names no `$anchor`/`$dynamicAnchor` (or draft-07 `$id: '#name'`), or that is relative while the root has no absolute `$id` and no embedded resource has that `$id`.
- References inside an embedded resource (own `$id`) and data keywords (`enum`, `const`, `default`, `examples`, `example`, `x-`) are skipped at keyword positions; inside `properties`, `patternProperties`, `$defs`, `definitions` and `dependentSchemas` every key is a name and is walked. Absolute references to other documents are TOOL-019.
- Warning, not error: detection is deterministic, but no source makes an unresolvable reference a MUST-level rejection.
- Source: https://modelcontextprotocol.io/specification/2026-07-28/basic#ref-resolution, https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.3.1

### 2.4 INJ: prompt injection and model manipulation
Scope: the `corpus(snap)` from §1.5. Every INJ finding quotes the matched snippet (up to 120 characters, with hidden characters escaped as `\u{...}`) and its location.

**INJ-001 Hidden or invisible characters.** Severity: claude=error, chatgpt=error.
- Detect, on raw text including tool names:
  - Unicode tag characters U+E0000–U+E007F, or bidi controls U+202A–U+202E and U+2066–U+2069 → error.
  - U+200B, U+200C, U+200E, U+200F, U+2060–U+2064, U+FEFF, U+00AD, or any other `\p{Cf}` → **warning**.
  - U+200D between two `\p{Extended_Pictographic}` characters (emoji ZWJ sequences) is exempt.
  - Exempt from 1.1.1: the tag characters of the RGI subdivision flags (U+1F3F4, the tag spelling of `gbeng`, `gbsct` or `gbwls`, U+E007F) (A05-07); U+200C between two letters or marks of a joining script (Arabic, Syriac, NKo, Mongolian, Mandaic) and U+200D between two of a Brahmic script (Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala), at most two per word, and U+200E/U+200F/U+061C next to a letter of a right-to-left script (A05-08). The same characters in a Latin word or in a run are still reported.
  - A run of two or more variation selectors (U+FE00–FE0F, U+E0100–E01EF) → error (1.1.0).
  - A single variation selector on a base it is not defined for, U+3164, U+FFA0, U+115F/U+1160 outside a conjoining-jamo syllable, U+2800 outside Braille text, U+034F, U+17B4, U+17B5 → **warning** (1.1.0).
  - Property names, schema titles, enum/const, default and examples are scanned too (1.1.0).
- Source: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy, https://developers.openai.com/plugins/plugin-guidelines

**INJ-002 Mixed-script words (homoglyphs).** Severity: claude=warning, chatgpt=warning.
- Detect: a single word (`\p{L}+`) that contains Latin together with Cyrillic or Greek letters. Since 1.1.0 also Latin with Armenian or Cherokee, and ASCII letters with fullwidth Latin (U+FF21–FF5A) or Mathematical Alphanumeric Latin letters (U+1D400–1D6A5); invisible characters are removed before words are split. Text written entirely in one non-Latin script is fine. Biomedical notation is exempt (1.0.1): Latin capitals followed by lowercase Greek letters (`/^[A-Z]+[α-ω][A-Zα-ω]*$/u`, linear; TNFα, NFκB). From 1.1.1 also lowercase Greek before capitals and the integrin form (`/^[αβγδεζηθκλμξπστφψω]+[A-Z][A-Zαβγδεζηθκλμξπστφψω]*$|^[αβ][a-z][αβ]$/u`; NF-κB, αSMA, γH2AX, αKG, αvβ3) (A05-09). The prefix leaves out the Greek letters that pass for Latin (ο ι ν ρ υ χ), so `ιOS`, `οPENAI`, `ρAYPAL`, `νISA` and `pαypal` still match.
- Source: same as INJ-001.

**INJ-003 Markup hidden from humans, or pseudo-system tags.** Severity: claude=warning, chatgpt=warning.
- Detect: an HTML comment `<!-- ... -->` (found with `indexOf`; a lazy regex is quadratic on many unterminated `<!--`), or `/<\/?(system|important|instructions?|admin|assistant|secret|hidden)\b[^>]{0,200}>/i`. From 1.1.1 a match of the form `<name-word>` (a hyphen or underscore after the name, no whitespace or attributes) with no `</name-word` in the text is a placeholder (A05-11): skipped when the character before or after it is `/`, `.`, `:` or `=` (`https://<vault>.vault.azure.net/secrets/<secret-name>`, `--host=<admin-host>`), otherwise reported at **info** (`<system-prompt> You are ...`); a later non-placeholder match wins at warning.
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
  - Strong names (skipped for integer, number or boolean parameters from 1.1.1, A05-06: an integer `context_window` is a token count): `/^(conversation(_?(history|context|log|summary|memory))?|chat_?(history|log|transcript|memory|memories)|conversation_?memories|message_?history|previous_?messages|prior_?turns|all_?messages|transcript|full_?context|context_?window|system_?prompt|user_?prompt)$/i` → error. Bare `memory` is not strong: a VM or cache size parameter has that name.
  - An array whose items are objects with `role` and `content` properties → error.
  - A description matching `(entire|full|whole|complete) (conversation|chat|transcript)`, `(include|pass|send|provide) (the )?(user's )?(previous|prior|all) (chat |conversation )?messages`, or `contents of (your|the chat's|the conversation's) memory` → **warning** (regex detection, §1.2). A bare `history` ("full history of status changes") does not match.
  - Weak names `/^(messages|history|thread|context|background|user_context|additional_context|memory|memories)$/i` → **warning**, skipped for integer, number or boolean parameters, also behind a `$ref` or an optional wrapper (`int | None`, 1.1.1, A05-05). Those names are often legitimate, for example a Slack thread id.
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
UI tools are found through `uri = _meta.ui.resourceUri ?? _meta["ui/resourceUri"] ?? _meta["openai/outputTemplate"]`. For UI resources, `_meta` is read from the `resources/read` content item first, with the `resources/list` entry as a fallback. Define `RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app'` locally. Do **not** import `@modelcontextprotocol/ext-apps`, which needs Node ≥20. `uiResources(snap)` builds this view once per snapshot (memoized like the corpus, §1.5) with each content item decoded once, and the `<script type=importmap>` scan is linear: an opener inside an earlier map body is script text, and a map without `</script` is parsed once (1.1.1, A09-07, A09-01).

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
    - a wildcard's host part decides breadth: a port or path does not narrow it (`https://*.vercel.app:443` is broad, 1.1.0)
  - it uses `http://` on a non-localhost host
  - it has a path, query, fragment or trailing slash
  - it contains `'unsafe-*'`
  - it names localhost or a private IP
  - a wildcard appears outside `resourceDomains` → spec **info**
  - public CDNs (unpkg.com, cdn.jsdelivr.net) in `resourceDomains` → claude **info**: "serve from your own origin in production"
- Source: https://developers.openai.com/plugins/build/chatgpt-ui, https://claude.com/docs/connectors/building/mcp-apps/design-guidelines

**APPS-007 External origins used by the widget are declared in the CSP.** Severity: chatgpt=error, claude=warning, spec=warning. Needs: ui.
- Detect: run `extractOrigins(html)` and match each origin (from 1.1.1 the tag, `@import` and CSS `url()` scans skip HTML comments, see `extractOrigins`, A05-12) against the matching list (`resourceDomains`/`resource_domains`, `connectDomains`/`connect_domains`, `frameDomains`/`frame_domains`, `baseUriDomains`). Each undeclared origin is a finding.
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
- Detect: a query parameter name with a secret sign, the same list redaction uses (`isSecretName`: `token`, `api_key`, `api-key`, `apiKey`, `client_secret`, `credential`, `session`, `cookie`, `signature`, `pass`, `pwd`, `dsn`, …; not names that point to a secret, such as `sessionId`, `key_id` or `token_type`). The value is always redacted in the output.
- Source: https://claude.com/docs/connectors/building/authentication

**AUTH-002 401 challenge format.** Severity: claude=error, chatgpt=error, spec=warning.
- Detect, on the unauthenticated 401:
  - `WWW-Authenticate` is missing, or the scheme is not Bearer (or DPoP), or `resource_metadata` is missing:
    - a well-known PRM still resolves → claude-only **warning** (the spec needs one discovery mechanism; Claude calls the header the reliable path)
    - no PRM, but legacy origin AS metadata exists (`authProbe.legacyDiscovery`) → chatgpt error, spec **warning**, claude **warning** (deprecated discovery that Claude still follows; the spec needs only one discovery mechanism, so the spec error for missing discovery is AUTH-004's)
    - no discovery at all → **info** pointing to AUTH-004, which carries the one error
  - `resource_metadata` is not an absolute https URL → error.
  - `resource_metadata` given unquoted (`resource_metadata=https://…`) is read whole, as MCP SDK clients do, and gets a spec **warning** to quote it.
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
  - Spec: neither → warning. DCR only → **info** (0.4.0 wording): "DCR only: Dynamic Client Registration is deprecated in 2026-07-28 for new servers; add CIMD (Claude uses it only with client_id_metadata_document_supported: true and "none" in token_endpoint_auth_methods_supported)". The condition (`registration_endpoint` without `client_id_metadata_document_supported: true`) and the severities are unchanged; this extends the rule and adds no new one. The deprecated features registry (https://modelcontextprotocol.io/specification/2026-07-28/deprecated) is added to the sources.
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
- Call only tools with `annotations.readOnlyHint === true`, `destructiveHint !== true`, and no write verb in the name. A name has a write verb when a token of it is in WRITE_VERBS. If the first token is a READ verb, only the tokens after the first conjunction (and, then, or, also, plus) get the checks below; otherwise every token does: a token in the probe-only list (exec, kill, stop, restart, reboot, shutdown, deploy, push, commit, apply, install, uninstall, rollback, clear, flush, unlink, rm, notify, reply, lock, unlock, grant, ban, block, enable, activate, subscribe, pause, resume, toggle), an `-ed`/`-ing` form of such a verb (or an `-s`/`-es` form in verb position), or a token that starts with a HARD_DESTRUCTIVE verb (except dropdown, droplet, dropbox, dropzone) (1.0.1).
- The GET and subscriptions/listen probes wait min(--timeout, 5 s) for the status line. With `--active-auth`, the CLI prints the registered DCR `client_id` and the registration endpoint on stderr (never the client secret or registration access token), so the client can be deleted.
- At most 3 calls per tool and 50 tools, one at a time. A name listed more than once is called only when every entry with it is safe, and once (`tools/call` addresses a tool by name, so the server picks the implementation).
- Each call uses the `--timeout` value, capped at 240 s.
- Arguments come from `--tool-args <file.json>` (`{toolName: args}`) or are synthesized: `default` → `examples[0]` → `enum[0]` → `const` → type placeholder (`"mcp-review-check"`, `1`, `false`, `[]`, `{}`). The placeholder follows the schema so that common validation passes: a sample value for a string `format` (uri, email, date-time, uuid, …), `minLength`/`maxLength`, numeric bounds and `multipleOf`, `minItems`, the required properties of nested objects, the first `anyOf`/`oneOf` branch and local `$ref`.
- Invalid-input variants: `{}` when required properties exist, and the first required property set to the wrong type: a value outside every type the property allows (type unions, anyOf/oneOf, `$ref`); when no such value exists (no type), the wrong-type call is skipped.
- Success-path rules apply only to non-`isError` results.

**RT-001 Error messages are specific.** Severity: claude=error.
- Detect, on invalid-input calls that got an answer: the error text (`content[*].text` when `isError`, or the JSON-RPC `message` + `data`) matches `isGenericError` (generic phrases only, no length rule) → error. A stack trace (`/\n\s+at .+\(.+:\d+:\d+\)/` or `/Traceback \(most recent call last\)/`) → **warning**.
- Source: https://claude.com/docs/connectors/building/review-criteria

**RT-002 Invalid input silently accepted.** Severity: claude=warning, spec=warning.
- Detect: a wrong-type call, or the call without the required arguments, returns a success result.
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

### 2.13 LST: listing and plugin manifests (0.4.0)
Platform `claude` for the plugin folder (`--plugin-dir`, LST-001..LST-015) and `chatgpt` for the package manifest (`--openai-manifest`, LST-016..LST-026). All need the corresponding input (§3.8); LST-015 and LST-026 also need `http`, LST-025 `tools`. Severity follows the vendor result: "blocks" or "rejects" with deterministic detection is an error, "held for a reviewer" a warning, and heuristics (README word count, credential-looking literals, prompt normalization, @mentions, the host match against the target) at most a warning. No rule quotes a header, env or credential value. Sources: C-PSC = https://claude.com/docs/plugins/pre-submission-checklist, C-REF = https://code.claude.com/docs/en/plugins-reference, O-SUB = https://developers.openai.com/plugins/deploy/submission, O-ERR = https://developers.openai.com/plugins/deploy/submission-errors (all read 2026-11-02; developers.openai.com/apps-sdk/deploy/submission redirects to O-SUB).

| ID | Detects | Severity | Source |
|---|---|---|---|
| LST-001 | `.claude-plugin/plugin.json` missing or not valid JSON (info for a folder with only `skills/<name>/SKILL.md`, which passes with a note) | claude: error | C-PSC, C-REF |
| LST-002 | `name` not lowercase letters, digits and hyphens, ≤64, starting and ending with a letter or digit; non-ASCII and reserved names (`claude`, `anthropic`, `official`, `plugin`, `mcp`, `test`) are errors, other pattern breaks warnings | claude: error / warning | C-PSC, C-REF#name |
| LST-003 | `description`, `author` or `version` missing | claude: warning | C-PSC, C-REF |
| LST-004 | No README (error) or fewer than 40 words outside code blocks (warning, approximate count) | claude: error / warning | C-PSC |
| LST-005 | No LICENSE file and no `license` field | claude: error | C-PSC |
| LST-006 | `.mcp.json` invalid or a server entry with neither `command` nor `url` | claude: error | C-PSC, https://code.claude.com/docs/en/mcp |
| LST-007 | Remote server without `type` http, sse or ws, or a `url` that is not absolute `https://`/`wss://`, `${user_config.KEY}` or `""` | claude: error | C-PSC |
| LST-008 | `npx`, `bunx`, `pnpm dlx`, `yarn dlx`, `uvx`, `pipx run`, `uv run` without an exact version pin (`@latest` and ranges fail; `uv run` needs `--locked`/`--frozen` among its options before the script or `--`). Since 1.1.0 also `npm exec`/`npm x`, `pnpx`, `bun x` and `uv tool run`, behind `env [K=V ...]` (also `-S`), `cmd /c` and `sh -c` wrappers | claude: error | C-PSC |
| LST-009 | `.npmrc`, `bunfig.toml`, `uv.toml` or (1.1.0) a `pyproject.toml` (`[[tool.uv.index]]`, the index keys of `[tool.uv]`/`[tool.uv.pip]`) that sets a registry, index or proxy next to a launcher | claude: error | C-PSC |
| LST-010 | `.mcpb`/`.dxt` bundle instead of `command`/`url` (error when fetched from a URL) | claude: warning / error | C-PSC, C-REF#mcpservers |
| LST-011 | Credentials in headers or env: a known token format is an error; a literal under a credential name, or `${ENV}` read from the user's machine, a warning | claude: error / warning | C-PSC, C-REF#user-configuration |
| LST-012 | `.DS_Store`, `Thumbs.db`, `desktop.ini`, `__MACOSX` | claude: error | C-PSC |
| LST-013 | Non-image/font files over 256 KiB, more than 512 files, binaries, symlinks (held for a reviewer) | claude: warning | C-PSC |
| LST-014 | Directory listing fields (`icon`, `documentationUrl`, `supportUrl`, `privacyPolicyUrl`, `termsOfServiceUrl`) that are not `https://` or an image inside the plugin; missing fields are info. Automates part of MAN-002 | claude: warning / info | C-REF#directory-listing-fields, https://claude.com/docs/connectors/building/submission |
| LST-015 | Plugin remote server URL host differs from the checked server | claude: warning | C-PSC |
| LST-016 | Package manifest unreadable or without listing fields; a bare `mcp.json` is a warning (listing not checked). Automates MAN-015 | chatgpt: error / warning | O-SUB, O-ERR |
| LST-017 | Listing text over the final-submission limits (displayName and shortDescription ≤30, longDescription ≤4000, developerName ≤80, capabilities ≤20 × ≤120, unknown category); missing developerName or category is info. Automates MAN-015 | chatgpt: error / info | O-ERR, O-SUB |
| LST-018 | The four listing URLs (`websiteURL`, `supportURL`, `privacyPolicyURL`, `termsOfServiceURL`) not HTTPS, with credentials or over 1024 characters. Automates the format part of MAN-016 | chatgpt: error | O-SUB, O-ERR |
| LST-019 | Starter prompts: more than 3, over 128 characters, multi-line, duplicates or @mentions (the last two heuristic warnings). Automates MAN-017 | chatgpt: error / warning | O-ERR, O-SUB |
| LST-020 | `brandColor` not `#RRGGBB` or under 2:1 contrast against white, `brandColorDark` under 2:1 against #212121. Automates MAN-018 | chatgpt: error | O-ERR, O-SUB |
| LST-021 | Icons: logo and composerIcon not `./` paths to PNG, JPEG, WebP or SVG; missing in the Agent Plugins format or a non-`./` path is a warning. Automates part of MAN-019 | chatgpt: error / warning | O-SUB, O-ERR |
| LST-022 | Review data: not exactly 5 positive and 3 negative test cases (each with `description`, `prompt`, positive ones with `tools_triggered` and `expected_behavior`), demo recording URL, release notes; an omitted value is a warning because omission keeps the saved dashboard value. Automates MAN-020 and part of MAN-021 | chatgpt: error / warning | O-SUB, O-ERR |
| LST-023 | `clientSecret`, `test_credentials`, `reviewer_instructions`, non-empty server headers, `apps`/`.app.json`, hooks. Automates MAN-023 | chatgpt: error | O-SUB, O-ERR |
| LST-024 | `mcp.json` without exactly one remote MCP server with an https URL (error when it does not parse). Automates the one-server part of MAN-020 | chatgpt: warning / error | O-SUB, O-ERR |
| LST-025 | Test cases whose `tools_triggered` (a comma-separated string) names a tool absent from the live `tools/list`. Automates part of MAN-020 | chatgpt: warning | O-SUB |
| LST-026 | Package MCP server URL host differs from the checked server | chatgpt: warning | O-SUB |

Not checked (deferred): image dimensions and size (MAN-019, MAN-024; needs image decoding), scripts that start launchers, repository-level checks (`.gitattributes` filters, archive size), translations. `mcpServers` paths other than `.mcp.json` were deferred until 1.1.0; see the 1.1.1 note below.

**1.1.1 notes (review round 4, block P6; patch-safe: nothing here adds a warning or an error).**
- *plugin.json `mcpServers` files (A06-01, first half).* Every `.json` string of `mcpServers` (a string or an array) is read into `plugin.mcpFiles[]` (at most 16, in the order written; `./.mcp.json` is not read twice) when it is a `./` path with no `..` segment, not absolute, inside the real root and not behind a link. `pluginServers()` appends their servers after `.mcp.json` and the inline ones, marked `fromFile` (a same-named server is listed too; name replacement comes with 1.3.0). Every finding that exists only because of those files is **info** with the suffix "(reported at rule severity from 1.3.0)", whatever the rule: LST-006 (a path that is not `./`, "path escapes plugin folder", "Path not found", a file that does not parse or is not a server map, a server entry with neither or both of command and url), LST-007, LST-008, LST-011 on their servers, LST-009 when only a file server uses a launcher, and LST-015 for a file server's host (the 1.1.0 LST-015 result over the other servers is kept as it was). Read problems of these files are carried to LST-006, not printed as `warning:` lines. 1.3.0 reports them at rule severity.
- *Dependency folders (A06-06).* `--plugin-dir` never walks `.git`, `.hg` or `.svn` (`VCS_DIRS`) and does not walk `node_modules`, `bower_components`, `.venv`, `venv`, `__pycache__`, `site-packages`, `.tox`, `.nox`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `.turbo`, `.parcel-cache` or `.next` (`DEPENDENCY_DIRS`, folders only, any depth) when the root `.gitignore` lists them (`gitignoreRules`: read as text, never through git; exact names, `/name`, `name/`, `**/name`, `a/name`, `!` re-includes, last match wins, no glob expansion, at most 1000 rules). Their package configs, files, binaries and system files are then not counted; LST-013 names the skipped folders at info (up to 20). Trade-off, accepted: a finding inside a skipped folder is hidden; a committed (not ignored) dependency folder is walked and checked as in 1.1.0. Rejected: listing files with `git ls-files` (the plugin under review is untrusted, and git runs commands its config names, such as `core.fsmonitor`); skipping `dist/` or `build/` (a plugin often commits its built server there).
- *Linear inputs (A09-02, A09-04).* The pyproject.toml table header is parsed by `tomlHeader()` (the key runs to the first `]`, with the same result as the 1.1.0 regex) instead of a lazy regex that was quadratic on a run of spaces; the LST-009 package-source regex lets leading whitespace stop at a line break (`^\s*` rescanned every following blank line); `env -S` / `--split-string` is unwrapped on a reversed stack (each word handled once; a limit on expansions was rejected, since `-S '' -S '' ... -S 'npx pkg'` would hide the launcher); the LST-009 `[index...]` header match stops at a line break.
- *Manual checklist (A06-07).* LST-022 counts as having checked MAN-020 and MAN-021 only when mcp.json parsed and names at least one server.
- *`--verbose` dump (A06-08).* A one-string `command` is split as `--stdio` splits it (quote-aware `tokenizeCommand`; an unterminated quote is closed, an unsplittable command hidden whole) and redacted like an argv; every `scheme://` URL inside a string goes through `displayUrl`, and every string through the known-token mask.

Image formats (1.1.0): an SVG is recognised only by its root element after the prologue; an `<svg` tag elsewhere (a comment, a text file) is not an SVG (A06-06; the 1.0.x compatibility branch is gone). LST-014 accepts only a PNG, JPEG, GIF, WebP or SVG path as the plugin icon, not a font file.

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
| `--format text\|json\|markdown\|sarif\|junit` | `text` | §5.3 |
| `--output <file>` | stdout | When given, the full report goes to the file and a one-line summary goes to stderr. If the file cannot be written, the report goes to stdout with an error message and exit 2. |
| `--json-output <file>` | — | Also writes the JSON report (§5.3 json, with `baselined` marks under `--baseline`) to the file, whatever `--format`, from the same redacted report. A write failure is exit 2; the primary report is still emitted. Naming the `--output` file with a non-json `--format` is a usage error. New in 0.3.0. |
| `--save-baseline <file>` | — | The same document under the baseline name (§3.5); may be given with `--json-output`. New in 0.3.0. |
| `--timeout <ms>` | `30000` | Per request, at most 2^31−1−1000 ms (Node clamps larger timers to 1 ms). Connect uses `min(timeout, 15000)`, `--active` calls `min(timeout, 240000)`. 2026-07-28 JSON-RPC calls read the response body within the request's own timeout; probes cap the body at 256 KB and 10 s. The GET probe uses 5 s and the TLS check 10 s. |
| `--max-duration <ms>` | no limit | Overall deadline for the whole check; a stop after the handshake keeps the partial results (§3.3) and exits 4 (§3.2). Since 1.1.0 it also bounds the rules: the engine checks it between rules (`EngineOptions.deadline`), the rules not started by then are skipped with `stopped by --max-duration`, and `limits.stopped` gets `phase: "rules"`, `unfinished: ["rules"]` and in `completed` the phases the run went through. The rules get at least `RULES_GRACE_MS` (1000 ms) after they start; a running rule is not interrupted. |
| `--fail-on error\|warning\|never` | `error` | Controls exit code 1. |
| `--fail-on-incomplete` | off | Exit 3 on a partial check (`coverage.toolLevel` `auth-required`, `token-rejected` or `list-failed`), §3.2. |
| `--baseline <file>` | — | A JSON report of an earlier run; its findings are known and only new findings count (§3.5). |
| `--fail-on-drift` | off | Exit 1 when a tool was added, removed or changed since `--baseline` (§3.5), also at `--fail-on never`; needs `--baseline`, otherwise exit 2. New in 0.4.0. |
| `--diff-only` | off | With `--baseline`, text and markdown show only the new findings and the changed tool definitions, without the known-findings line and the manual checklist (§3.5); needs `--baseline`, otherwise exit 2. New in 0.4.0. |
| `--plugin-dir <dir>` | — | Also lints a Claude plugin folder (LST-001..LST-015, §3.8). Needs a `<url>` or `--stdio` target. New in 0.4.0. |
| `--openai-manifest <file>` | — | Also lints a ChatGPT plugin package manifest (LST-016..LST-026, §3.8). Needs a `<url>` or `--stdio` target. New in 0.4.0. |
| `--active` | off | Enables the RT rules, which call read-only tools. |
| `--active-auth` | off | Enables AUTH-019..021. **Creates a DCR client** on your authorization server. The CLI prints this notice. |
| `--tool-args <file>` | — | JSON `{toolName: argsObject}` for RT calls. |
| `--env K=V`, `--cwd <dir>` | — | stdio only. `--env` is repeatable and merged over `getDefaultEnvironment()`. |
| `--ignore <RULE-ID>` | — | Repeatable. Ignored findings are still counted in JSON under `ignored`. |
| `--list-rules` | — | Prints the catalog (ID, platforms, severity, title, source) and exits 0. |
| `--config <file>`, `--no-config` | discovery | Options from a JSON file (§3.7); `--no-config` turns discovery off. Not both. New in 0.3.0. |
| `--no-color`, `--verbose`, `--help`, `--version` | — | Color is also off when stdout is not a TTY or `NO_COLOR` is set. `--verbose` prints the HTTP trace (redacted) and stdio stderr tail. |

- Exactly one of `<url>` or `--stdio` is allowed. Otherwise exit 2.
- `--stdio` is split by a small shell-like tokenizer (single quotes, double quotes, backslash escapes) and spawned **without** a shell. An unbalanced quote is a usage error (exit 2).
- Arguments are parsed with `node:util` `parseArgs` (`allowPositionals: true`, `multiple: true` for the repeatable flags).

### 3.2 Exit codes
| Code | Meaning |
|---|---|
| 0 | Completed, below the `--fail-on` threshold (with `--baseline`: no new finding reaches it) |
| 1 | Completed, threshold reached (for a `--target` directory, or for the spec with `--fail-on-spec`); with `--baseline`, counted over new findings only; with `--fail-on-drift`, also when a tool definition was added, removed or changed since the baseline, or when the definitions could not be compared (a warning on stderr says why) |
| 2 | Usage or config error (including a `--baseline` file that is missing, not a regular file, larger than 16 MiB or not a JSON report of mcp-review-check, `--diff-only` or `--fail-on-drift` without `--baseline`, a `--plugin-dir` or `--openai-manifest` path that is missing or of the wrong kind, and a wrong config file, §3.7), or `--output`, `--json-output` or `--save-baseline` could not be written |
| 3 | Fatal: could not reach the server or complete any handshake (a report is still emitted, containing the SRV-003 error), also when `--max-duration` ran out before the handshake; with `--fail-on-incomplete`, a partial check (`coverage.toolLevel` is `auth-required`, `token-rejected` or `list-failed`); or an unexpected internal error (`fatal:` and the stack on stderr) |
| 4 | `--max-duration` stopped the check after the handshake (`limits.stopped` set, no fatal error), at any `--fail-on` and with or without `--fail-on-incomplete`; the Result line reads `INCOMPLETE (stopped at --max-duration during <phase>)` and JSON `summary.failed` is `true`. New in 0.2.0; 0.1.x exited 3 |
| 128+N | Ended by signal N (130 SIGINT, 143 SIGTERM, 131 SIGQUIT, 129 SIGHUP); no report is written |

Precedence: fatal (3) → stopped (4) → partial with `--fail-on-incomplete` (3) → gate or `--fail-on-drift` (1) → 0.

With `--fail-on-incomplete` a partial check fails the report too (1.0.1; since 1.1.0 `buildReport` applies it, for every format): `summary.failed` is true and `gate.reason` names `partial check: <level> (--fail-on-incomplete)`; JUnit adds one `<error type="incomplete">` per suite, and the GitHub partial-check annotation is an `::error`. The Result line says the partial check once; when no finding reached the gate its head reads `FAIL (--fail-on-incomplete)`.

A run that spent the snapshot byte budget (§4.2) is a partial check, not a `--max-duration` stop: `limits.stopped` is unset, so the exit code is never 4; with `--fail-on-incomplete` it is 3, and otherwise it follows `--fail-on` (the verdict reads INCOMPLETE, and `summary.failed` is true only when the gate is reached).

A 401 without `--bearer` is **not** fatal. The auth probe runs and the exit code follows `--fail-on`. A token the server rejects is not fatal either: the check is partial (`token-rejected`) and, without `--fail-on-incomplete`, the exit code follows `--fail-on`. In GitHub Actions a partial check always adds one `::warning` titled `mcp-review-check` naming the reason and that tool-level checks were skipped; exit 3 and 4 add one `::error` titled `mcp-review-check` with the cause. The README's [Exit codes](../../README.md#exit-codes) section is authoritative for the details. Exit 4 and `--fail-on-incomplete` answer §8 Q5 and Q6.

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

**Stopped by `--max-duration`.** The run goes through the phases `connect`, `auth probe`, `listing`, `UI resource reads`, `wire probes`, `tools re-list`, `text-only tools/list` and `active tool calls` (`PHASES` in `src/snapshot.ts`), skipping the ones it does not need. When `--max-duration` runs out, the report covers what ran. Each wire probe (each of the four Origin probes included, from 0.3.0) and each `--active` call is in the snapshot as soon as it finishes; the JSON-RPC errors and 2026-07-28 results seen so far are kept, and all of it goes through redaction and the input caps. `limits.stopped` names the phase that was cut short (`phase`), the phases that finished (`completed`) and the ones that did not (`unfinished`: the cut phase and every later one). A rule that reads data of an unfinished phase (a probe that never ran, the partial active calls, the observed errors or modern results gathered over the whole run, a listing, UI read, re-list or auth probe that did not finish) reports what it finds there. If it finds nothing, it is listed as skipped with reason `stopped by --max-duration` and is not counted as run, because finding nothing in partial data is not a pass. Rules over the request log and latency samples are judged on the requests that were made. A deadline that lands while connections are closing, after every check has run, does not mark the run as stopped. The clientInfo variants (RT-012) are kept only as a full set: a stop while they run leaves `active.clientInfoVariants` out, and RT-012 is listed as skipped with `stopped by --max-duration`, because a partial set would compare uneven tool lists (a wave-5 decision, not a gap). SRV-008 on a stop inside the Origin probes reports what the probes already made show; if they show nothing, it is skipped the same way (before 0.3.0 such a stop dropped all four probes).

### 3.4 Auth probe and coverage messaging
- The probe sequence is the one in AUTH-002..016. All requests are GETs, plus one invalid-token POST. Nothing is created.
- When the server needs auth and no valid `--bearer` was given:
  - `coverage.toolLevel = 'auth-required'`.
  - Every rule that needs tools, resources, prompts, ui or active is listed as skipped.
  - The report shows a prominent notice: **"Server requires OAuth. Auth checks ran; tool, resource and UI checks need `--bearer <token>` (obtain a token via your OAuth flow or a test account)."**
- When `--bearer` is given but rejected (401): the same notice appears, worded as "token rejected".

### 3.5 Baseline (`--baseline <report.json>`)
`src/baseline.ts`, added in 0.2.0, so CI can adopt the linter on a server with existing findings and fail only on new ones.
- **Input.** A report written by `--format json` (UTF-8, UTF-8 with BOM, UTF-16LE with BOM). It must be a JSON object with `tool.name === 'mcp-review-check'`, `schemaVersion` between 1 and the current one, and a `findings` array whose entries have a string `ruleId`, a string-array `platforms` and string-or-absent `tool`, `resource`, `path` and `message`. Anything else, an empty path, or a missing or unreadable file is a usage error (exit 2) before connecting; the messages never quote the file.
- **Identity.** Rule ID + `tool` + `resource` + `path` (the basis of the SARIF `partialFingerprints`), with platforms as a covering condition: a finding is known when an unused baseline entry with the same key lists all its platforms (a baseline for `--target all` covers a run for `--target claude`, not the reverse). Each baseline entry covers one finding, so one more repeat than the baseline had is new. Among several entries on the same key, the one whose message matches after replacing every number with `#` is taken first, then any free one, so a reworded message or a changed number stays known. SRV-020 (the era note) is never baselined. Findings are matched in their redacted form, as the baseline was written.
- **Effect.** Known findings no longer count toward `--fail-on`, the verdicts, the `errors`/`warnings`/`info` counts or the GitHub annotations. The score still counts every finding: it describes the server, not the delta.
- **Output.** JSON lists every finding with `baselined: true|false` and adds `summary.baselined` (`schemaVersion` stays 1, the fields are additive). SARIF sets `baselineState` (`new` / `unchanged`, SARIF 2.1.0 §3.27.24) on every result and `runs[0].properties.summary.baselined`. Text lists only the new findings plus one line `N known finding(s) from baseline, not listed: <rule IDs>` (rule IDs only, at most 8; not with `--quiet`); markdown and the job summary add a `Baseline` row to the summary table; the `--output` summary line adds `· N known from baseline`.
- **Writing it.** `--save-baseline <file>` (0.3.0) writes the JSON report besides the chosen format (§3.1); the loop is a first run with `--fail-on never --save-baseline baseline.json`, then `--baseline baseline.json` on later runs. `--baseline b.json --save-baseline b.json` refreshes the file in place, since the baseline is read before connecting. `--format json --output <file>` writes the same document.
- **Tool-definition drift (0.4.0, `src/report/drift.ts`).** The JSON report carries `toolFingerprints`, in tools/list order: `{name, sha256, fields}`. `sha256` is SHA-256 (hex) over the canonical JSON (object keys sorted by UTF-16 code unit at every depth, no whitespace, undefined members omitted) of the tool's present fields among `name, title, description, inputSchema, outputSchema, annotations, _meta`; `fields` maps each present field to the SHA-256 of its own canonical JSON. Fingerprints are computed over the input-capped snapshot as the rules saw it (1.0.1): strong secrets scrubbed, so a rotated secret that a description echoes is not a change, but run-specific `--env` values not redacted, so the digests do not depend on the command line; names are the redacted report's. When comparing, a tool also counts as unchanged if its digest in the report's redacted form matches, which keeps 1.0.0 baselines valid. A listing-only report has `toolFingerprints: null`. A change past the 16 KB cap of one string is not seen. They are `null` when tools/list did not finish. With `--baseline`, tools are paired by name (duplicates in order), and added, removed and changed tools (with the changed fields) are reported in every format: a section after the findings in text and markdown, `baseline.toolChanges` in JSON, one `note` result per change under the synthetic rule `BASE-001` in SARIF (not in the catalog), and the suite's `<system-out>` in JUnit. If either side has no fingerprints (a 0.3 baseline, or a partial run), there is no comparison and the reason is reported (`baseline.notCompared`).
- **Matching (1.0.1).** A finding takes a free baseline entry with the same rule and subject whose platforms include its own, the same wording first, tried in the report's redaction and then as the rules wrote it. Last, an entry whose subject holds `«redacted»` takes a still-new finding whose subject is equal around it (the marker stands for any text inside the same JSON string), so a non-secret `--env` value dropped or changed since the baseline does not make findings new.
- **Writes (1.0.1).** `--save-baseline` is skipped on exit 3 (no connect) and exit 4 (a `--max-duration` stop), and warns when the report records no fingerprints or is larger than `INPUT_FILE_CAP`. `--json-output` is still written.
- **Effect of drift.** Drift is informational and does not change the verdicts, `summary.failed` or the exit code. `--fail-on-drift` makes any change, or a comparison that was not possible, exit 1 (3 and 4 still win), and the section heading and the `--output` summary line say so.
- **`--diff-only`.** Requires `--baseline`. Text and markdown (and the GitHub step summary) drop the known-findings line and the manual checklist, even with `--checklist`; JSON, SARIF and JUnit are unchanged.

### 3.6 GitHub Action
`action.yml` at the repository root (0.2.0) is a composite action, so every release tag is also an action version (`uses: alisaosipova/mcp-review-check@v0.3.0`). It runs the CLI once with `--format sarif --output <sarif-file>` and, from 0.3.0, `--json-output` to a file under `$RUNNER_TEMP`; the annotations and the job summary come from the same run (§3.2, `GITHUB_ACTIONS`). Inputs: `target` or `stdio` (exactly one), `platform` (`--target`), `fail-on`, `fail-on-spec`, `active`, `bearer` (exported only as `MCP_REVIEW_CHECK_TOKEN` and masked), `version` (the npm version or range, default the current `MAJOR.MINOR`), `sarif-file`, `upload-sarif`, `extra-args` and `cli-path` (run a built `dist/cli.js` instead of the npm package). Outputs: `exit-code` and `sarif-file`, and from 0.3.0 `report-json` (the JSON report's path) and, read from that report by a separate `if: always()` step, `score` (`summary.score`, empty when it is `null`), `verdict` (`INCOMPLETE` when `limits.stopped` is set, else `FAIL` when `summary.failed`, else `PASS`, as the Result line), `verdict-claude` and `verdict-chatgpt` (`summary.verdicts.<platform>.verdict`, empty when the platform is not a target), `errors` and `warnings` (`summary.errors`, `summary.warnings`, over the new findings with `--baseline`) and `new-findings` (`findings.length - (summary.baselined ?? 0)`). The step writes only integers and upper-case words, so a report value cannot inject an output line, and leaves every report output empty when no report was written (exit 2) or it does not parse. Because of `--json-output`, the `version` default is `0.3` and the action needs CLI 0.3 or newer. The step exits with the CLI's exit code, and the SARIF is uploaded with a SHA-pinned `github/codeql-action/upload-sarif` also when the check fails. Every input reaches the script through `env:`. The README's "CI recipes" section documents the inputs, and CONTRIBUTING.md the release coupling of the `version` default.

Since 1.0.1 the action splits `extra-args` on spaces, tabs, CR and LF (one option per line is allowed; no quoting, no globbing) and rejects a `bearer` with CR or LF with exit 2 before printing anything. Without `cli-path` it installs `mcp-review-check@<version>` into `$RUNNER_TEMP` with `npm install --ignore-scripts`, without `MCP_REVIEW_CHECK_TOKEN` in the environment, after copying the project's `.npmrc` (from `npm prefix`) there with mode 600; a failed install exits 3, and the token is exported only for the CLI run. The Docker workflow builds the image once for linux/amd64 and linux/arm64 into a registry local to the build runner, smoke-tests each platform by digest, and the push job (the only one with `packages: write`) copies that archive to ghcr.io and fails unless the pushed digest equals the tested one.

### 3.7 Config file
`src/config.ts`, added in 0.3.0, so a project keeps its check settings next to the server.
- **Discovery.** `--config <file>` names the file. Otherwise the first of `mcp-review-check.config.json` and `.mcp-review-check.json` that exists in `--cwd`, or else in the process working directory, is read. `--no-config` disables discovery, and `--config` together with `--no-config` is a usage error. A missing `--config` file is a usage error; a discovered file that does not exist is simply not read.
- **Which commands read it.** A check only: `--help`, `--version`, `--list-rules` and `explain` return before the file is read, so a broken config file never breaks them.
- **Format.**
  - A JSON object (UTF-8 with or without BOM, or UTF-16LE with BOM). Keys are the camelCase long option names: `target`, `format`, `output`, `jsonOutput`, `saveBaseline`, `sarifLocation`, `timeout`, `maxDuration`, `failOn`, `failOnSpec`, `failOnIncomplete`, `baseline`, `failOnDrift`, `diffOnly`, `pluginDir`, `openaiManifest`, `local`, `noLocal`, `active`, `activeAuth`, `toolArgs`, `ignore`, `header`, `bearer`, `env`, `cwd`, `noColor`, `verbose`, `quiet`, `checklist`.
  - The server is `url`, or `stdio`: a string split like `--stdio "<command>"`, or `stdio` + `args` (or a `stdio` array), kept verbatim like `--stdio -- …`.
  - Switches (`failOnDrift` and `diffOnly` included) take booleans (`false` counts as absent). `timeout`/`maxDuration` take a number or a string. `ignore` takes a string or an array. `header` and `env` take an array of `"Name: value"` / `"K=V"` strings or an object.
- **Precedence.**
  - Each value becomes the string or list the flag would give and then goes through the flag's validation.
  - A flag on the command line overrides the key, and a list flag (`--ignore`, `--header`, `--env`) replaces the file's list instead of adding to it.
  - The file's server is used only when the command line names neither a `<url>` nor `--stdio`.
  - (1.1.0) A switch on the command line replaces the key of that switch and of its opposite (`OPPOSITES` in cli.ts). Every boolean key has a command-line opposite (`--no-<switch>`, `--color` for `noColor`, `--local` and `--no-local` for each other). When the command line names the server, the file's keys of the other transport are not used (a `<url>`: `env`, `cwd`; `--stdio`: `header`, `bearer`, `activeAuth`), and `--bearer` replaces the file's `Authorization` header, each with one note on stderr. Two conflicting values from one source are a usage error.
  - parseArgs has no defaults for `target`, `format`, `timeout` and `fail-on`; the defaults are applied after the merge, so an option absent from the command line can be told from its default.
- **Relative paths.** `output`, `jsonOutput`, `saveBaseline`, `baseline`, `toolArgs`, `cwd`, `pluginDir` and `openaiManifest` are resolved relative to the config file's directory, as tsconfig and eslint do. `sarifLocation` stays repository-relative.
- **Validation.** Errors (exit 2) name the file and the key and never a value:
  - an unknown key, with "did you mean" for a kebab-case spelling (`fail-on` → `failOn`);
  - a wrong type, a non-object, invalid JSON (the parser's message is not shown, since it quotes the file) or a missing `--config` file;
  - `url` with `stdio`, or `args` without `stdio`.

  A value rejected by the flag's validation reuses the flag's message plus `(from <file>: key "<key>")`.
- **Trust (1.0.1).** A file found by discovery is used only for options: its server keys (`url`, `stdio`, `args`), output paths (`output`, `jsonOutput`, `saveBaseline`), `cwd`, `env`, `header`, `bearer`, `active` and `activeAuth` (`DISCOVERED_FORBIDDEN`) are validated, then ignored with a stderr warning that names the file and the keys. Only `--config <file>` may set them. Each applied config file is named on stderr, with the key the server came from.
- **Secrets.** `header` and `bearer` keys are accepted with one stderr warning that names the keys and recommends `$MCP_REVIEW_CHECK_TOKEN`. File values are redacted like the flags (§4.5), since they become the same values. The markdown `rerun:` line is built from the real command line, so file values never appear in it.

### 3.8 Listing inputs (`--plugin-dir`, `--openai-manifest`)
`src/listing/` and `src/rules/listing.ts`, added in 0.4.0 (the answer to Q3). The two options are checked before connecting (the path exists and is the right kind, a regular file for the manifest; otherwise exit 2 naming the flag, never the path) and read after the handshake. The result is stored as `snap.listing` before the rules run. Both need a `<url>` or `--stdio` target (a listing-only run is not implemented), and a path in the config file is relative to the file.
- **Inputs.** `--plugin-dir <dir>` is a Claude plugin folder (the folder containing `.claude-plugin/plugin.json`): the loader reads `plugin.json`, `.mcp.json`, README*, LICENSE*, package-manager configs and the file list. `--openai-manifest <file>` is a ChatGPT plugin package manifest (`plugin.json` with `extensions.com.openai`, or a Codex `.codex-plugin/plugin.json`); the companion `mcp.json` or `.mcp.json` is read from the package root, since OpenAI keeps the listing in plugin.json and only the MCP configuration in mcp.json. A bare `mcp.json` is accepted, and LST-016 then warns that the listing was not checked.
- **Bounds.** No link is followed (`lstat`, then `O_NOFOLLOW`; every read opens `O_NONBLOCK` and checks the descriptor, so a FIFO cannot hang the run), `.git` is skipped (since 1.1.1 also the dependency, VCS and build-cache folders of §2.13 at any depth, and each folder is read with `opendir` only as far as the entry cap needs, I-A06-7), JSON over 1 MiB is not parsed, README and configs are read up to 256 KiB, at most 10,000 entries and depth 32, and parsed strings over TEXT_CAP are cut and listed in `limits.truncated`. Read and parse problems are recorded in `snap.listing.errors` with a relative path and an error code (a JSON syntax error gives line and column, never a window of the file) and printed as `warning:` lines on stderr; they are never thrown.
- **Rules.** The LST rules (§2.13) need `plugin-dir` or `openai-manifest` and are skipped with "needs --plugin-dir" / "needs --openai-manifest" otherwise. Without the options nothing changes.
- **Manual checklist.** With the input given, fully automated MAN items are dropped (`--openai-manifest`: MAN-015, 017, 018, 020, 023) and partly automated ones keep only their manual rest plus "(the rest is checked by LST-0xx)" (MAN-016, 019 and 021; MAN-002 with `--plugin-dir`). MAN-022 and MAN-024 stay manual: they need image decoding or a live UI.
- **Redaction.** The report redactor does not know values from the plugin files, so no rule quotes a header, env, `clientSecret`, `test_credentials` or `reviewer_instructions` value. URLs go through `displayUrl`.

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
Later additions include `src/baseline.ts` (§3.5), `src/limits.ts` (input caps and linter-defined thresholds), `action.yml` (§3.6), `src/config.ts` (§3.7) and `src/report/junit.ts` (§5.3).

**Package surface.** The package is CLI-only. From 0.2.0 `package.json` has no `main`, and its `exports` map exposes only `./package.json`, so `import 'mcp-review-check'` and deep imports of `dist/` fail and the internal modules are not an accidental public API. The `mcp-review-check` bin (`dist/cli.js`) is the supported interface.

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
  json?: unknown; durationMs: number;               // json: only the exchanges the rules read (see Exchanges)
  bodyBytes?: number; bodySha256?: string; jsonRpc?: JsonRpcSummary[]; jsonParsed?: boolean; oauthError?: string;
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
  listing?: Listing;                               // --plugin-dir / --openai-manifest (§3.8)
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
  needs: Array<'tools'|'resources'|'prompts'|'ui'|'http'|'stdio'|'auth'|'legacy'|'modern'|'active'|'active-auth'|'plugin-dir'|'openai-manifest'>;
  rationale: string; fix: string; sources: string[];
}
interface RawFinding {
  message: string; severity?: Severity; platforms?: Platform[];
  tool?: string; resource?: string; path?: string; evidence?: string;
}
interface Rule extends RuleMeta { check(snap: Snapshot): RawFinding[] }   // pure, synchronous, no I/O
```
Later additions to the snapshot (see `src/snapshot.ts`; `coverage.toolLevel` also takes `'list-failed'` and `'stopped'`):
```ts
interface ObservedError {                         // in transport.observedErrors
  source: string; requestId?: unknown; responseId?: unknown; code?: unknown; message?: unknown; modern?: boolean;
  result?: boolean;   // a successful response whose id is not the request's (no code), SPEC-016
  method?: string;    // the request's method, on result entries
}
const PHASES = ['connect', 'auth probe', 'listing', 'UI resource reads', 'wire probes', 'tools re-list', 'text-only tools/list', 'active tool calls'];
interface Limits {                                // snap.limits, also in the JSON report
  truncated: Array<{ where: string; length: number; cap: number; unit?: 'items' | 'bytes' }>;
  budgetExhausted?: { bytes: number; overBytes: number; phase: string; completed: string[]; unfinished: string[] };   // snapshot byte budget
  stopped?: { maxDurationMs: number; phase: string; completed?: string[]; unfinished?: string[] };   // §3.3
}
```
**Input caps** (`capSnapshot` in `src/limits.ts`, after redaction, also on a stopped snapshot). TEXT_CAP (16 KB) applies to the listed tool, prompt, resource and resource-template metadata, `serverInfo`, `instructions`, the raw list pages, the text-only `tools/list`, the `--active` call results, and the 2026-07-28 results. From 0.3.0 it also applies to the `--active` call arguments (synthesized or from `--tool-args`; the structure is kept and only long strings are cut), the calls' JSON-RPC errors (`message` and `data`) and transport errors, and every field of the observed JSON-RPC errors. Identifier keys (`name`, `uri`, `pattern`, …) inside these get ID_CAP (1 MB). Each cut adds one entry `{ where, length, cap }` to `limits.truncated` per object, with the longest string it cut: `tools/call <tool> args`, `tools/call <tool> JSON-RPC error`, `tools/call <tool> transport error`, and `observed JSON-RPC errors` (one entry for the whole list). The rules that read error text match on its start (RT-001's stack-trace and generic-phrase checks) or quote a prefix (RT-005, SPEC-016), so the cut does not change their results. From 1.1.1 every field of a `resources/read` content item other than `text` and `blob` (which keep HTML_CAP) is capped the same way, `uri` at ID_CAP and `mimeType` and `_meta` at TEXT_CAP, recorded as `UI resource <uri> item` (A09-03). A finding message shows a JSON pointer over 1024 characters as its first and last 60 characters and the TOOL-009 and TOOL-036 messages are cut to 2 KB (A09-08). The finding `path` is not cut in 1.x: baselines and SARIF fingerprints match on it.

**Snapshot byte budget** (0.4.0, `SNAPSHOT_BUDGET` = 64 MiB in `src/limits.ts`). A run reads at most the budget of server data, counted where it is kept: the bodies the tracer reads (the probes and the 2026-07-28 requests), the responses handed to the SDK over HTTP, and the JSON-RPC message lines of every stdio connection (a line over the 64 MB stdio buffer is dropped by the SDK and not counted). The read that crosses the budget stops at it; from then on no request is sent and no listing page is asked for. The run stops as on a `--max-duration` deadline (abort, close, copy the snapshot): `limits.truncated` records `snapshot budget (N bytes over)` with `unit: "bytes"` and `limits.budgetExhausted` records `{bytes, overBytes, phase, completed, unfinished}`. The coverage is `stopped` with reason `snapshot budget exhausted (during <phase>)`, or `connect-failed` with a fatal error if no handshake had completed. The engine treats `limits.budgetExhausted.unfinished` like `limits.stopped.unfinished`: a rule that reads data of an unfinished phase and finds nothing is skipped with reason `snapshot budget exhausted` (`--max-duration` keeps `stopped by --max-duration`), and findings made on partial data are kept. The verdict is INCOMPLETE and the Result line reads `INCOMPLETE (snapshot budget exhausted (during <phase>))`. It is a partial check, not a stop: `summary.failed` follows the `--fail-on` gate and the exit code is never 4 (§3.2). JUnit adds an `incomplete` suite property and a `<system-out>` line (not an `<error>`), and the GitHub `::warning` names the budget and the bytes.

**Exchanges** (0.4.0). An HTTP exchange records the request, the status, the headers, a masked 4 KB snippet, `bodyBytes`, `bodySha256` (over the masked text when a known secret occurs in it) and `jsonRpc`: one entry per JSON-RPC response with its `id`, flags for a result or a method, `error` (`code`, `message`, and `data` up to 4096 characters of JSON), `resultInfo` (`isError`, length of `contents`) and, for the discover probe, `resultValue` (the same object as `discoverRaw`). `jsonParsed` is true when the body was a JSON object or array, and `oauthError` is the string `error` member of such an object (up to 200 characters). The tracer returns the parsed body once and keeps it on `exchange.json` only for the exchanges whose bodies the rules read (the wire probes, the discover call, the auth probe's metadata and token requests); after the run `dropExchangeBodies` removes `json` from the wire probes and the token requests, so no exchange holds a separate full parsed body (the PRM and AS metadata exchanges share the object with `authProbe.prm.json` and `as[].json`). Every other result lives once in the snapshot field built from it. The JSON report does not contain exchanges.

- The engine:
  - evaluates `needs` and records skipped rules with their reasons; on a snapshot with `limits.stopped`, also skips a rule that read data of an unfinished phase and found nothing (§3.3)
  - catches exceptions thrown by a rule and turns them into an `INTERNAL` info finding
  - in a run without a working transport (`fatal`, or `coverage.toolLevel` connect-failed), skips a rule that finds nothing with `could not connect`, except the rules that judge only the entered URL or its DNS (SRV-001, SRV-004, SRV-005, SRV-017, AUTH-001) and SRV-003, which reports the failure; findings are never dropped (1.0.1). After a stop, a rule that reads the run-wide data (`transport.notifications`, `transport.stdio`, `observedErrors`, `modernResults`) and finds nothing is skipped, not passed
  - applies §1.2 platform filtering and severity
  - applies `--ignore`
  - sorts the findings
- All I/O lives in `connect.ts` and `probe/*`. Rules are pure functions over the snapshot. This makes them unit-testable from JSON snapshots.
- `catalog.test.ts` asserts:
  - IDs are unique and match `/^(SRV|SPEC|TOOL|INJ|DATA|POL|APPS|AUTH|RT|LST|MAN)-\d{3}$/`
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
| origins | initialize with Origin claude.ai, chatgpt.com, evil.invalid (server/discover on a modern-only server; on legacy HTTP+SSE a GET of the event stream with each Origin, cut after the headers) | SRV-008 |
| relist / fresh | tools/list again; new connection tools/list | SRV-019 |
| challenge | GET `/.well-known/openai-apps-challenge` | SRV-016 |
| close session | one best-effort DELETE with `Mcp-Session-Id` (no retries, at most 5 s) for a session a stateful server minted for a raw initialize (preflight, initialize-mode Origin probes, invalid token); the SDK connections end theirs the same way | none (kept out of rule evidence) |

Session end on a stop (1.1.0): when a run is stopped (deadline, byte budget, signal), every Streamable HTTP session for which the server returned an `Mcp-Session-Id` is ended with one DELETE carrying that id, the negotiated `MCP-Protocol-Version` and the run's request headers, without following redirects, in parallel, within 1500 ms (`SESSION_END_TIMEOUT_MS`); the response is ignored and not recorded. A session receives at most one DELETE.

That totals 20 to 40 requests per run with no writes: about 35 to a stateful 2025-11-25 server, about 25 to a stateless 2026-07-28 one. When the preflight gets a redirect to another path on the same host (no https→http downgrade), the get, badVersion, delete and Origin probes go to the redirect target, as the SDK client does; SRV-006 still reports the redirect. The get probe reuses the SDK session's own standalone GET when the client already opened one, because servers that allow one SSE stream per session answer a second GET with 409. Legacy probes reuse the SDK session id via `transport.sessionId` and `transport.protocolVersion`, which are instance getters and not part of the Transport interface type.

Transport notes (1.0.1):
- **Stalled server.** When tools/list gets no answer within --timeout after a successful initialize (or server/discover), later listings and all wire probes wait at most 2000 ms (`STALLED_TIMEOUT_MS`, never more than --timeout), and the CLI says so on stderr at once. A listing without an answer in that wait is not recorded, so the rules that need it are skipped, and `coverage.reason` names those methods; an HTTP wire probe the short wait cut off is left out of the snapshot. UI resource reads keep the full wait. After a stall, a timed-out HTTP wire probe (the Origin probes and the domain challenge) is not retried (1.1.0); other transient failures still are. connect.ts passes the stall to `runWireProbes` (`stalled`), and both decide it with `listingTimedOut` in `probe/wire.ts`.
- **Proxy.** The proxy variables are HTTPS_PROXY, HTTP_PROXY and ALL_PROXY, in either case (`PROXY_URL_VARS` in `src/proxy.ts`); routing and redaction read the same list. NO_PROXY follows undici's EnvHttpProxyAgent: comma or whitespace separated entries, `*` only as the whole value, `.example.com` and `*.example.com` match the domain and its subdomains, `host:port` limits the entry to that port, IPv6 in brackets.
- **Diagnosis.** A 5xx handshake answer is kind `http`: 502/503/504 name the proxy (when one is used) or the gateway, with a plain-text body kept in one redacted line of at most 200 characters. Only 404/405/410, or an HTML page below 500, is `not-mcp`. A TLS error with a proxy in use names the proxy and NODE_EXTRA_CA_CERTS. When a stdio server exits before it answers initialize, the connect error names its exit code or signal.

### 4.4 Node compatibility
The plan targeted Node 18; the implementation requires **Node 22.12 or newer** (`engines.node: ">=22.12"`, from 0.3.0; 0.2.x required 20.19), the oldest release line CI tests. The Node 18 constraints below (forbidden packages, vitest 3, `@types/node@^18`) are historical; what holds today:
- `engines.node: ">=22.12"`; CI runs Node 22 and 24 on Linux, macOS and Windows. Node 20 reached end of life on 2026-04-30 and was dropped in 0.3.0; while the version is 0.x, a minor release may raise the minimum.
- Dev dependencies: vitest 4, `@types/node` 22 (it tracks the oldest supported Node; Dependabot ignores its semver-major updates), TypeScript `~5.9`.
- `lib: ["ES2022"]` without DOM: `@types/node` types `fetch`, `Response`, `Headers` and `AbortSignal.timeout`, and the DOM globals (`name`, `status`, `close`, …) would hide typos in Node code.
- Releases are published to npm only from CI (`.github/workflows/release.yml`, see CONTRIBUTING.md); the "no publishing in this phase" note below is historical.
- Packaging (1.1.0): the tarball carries `npm-shrinkwrap.json`, generated by `prepack` from `package-lock.json` (production packages only) and removed by `postpack`; it is never committed.
- CLI startup (1.1.0): cli.ts loads the transport, rules and renderers on the first check (`loadCheckModules`); the proxy is installed then, before the first connect, and `proxy.ts` loads undici only inside `installProxy`.

The original Node 18 plan:
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
mcp-review-check 1.1.0 · rules 2026-11-02 · target: all
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
testing and policy judgment, and requirements change. Rules reflect public docs as of 2026-10-22; the catalog date moved to 2026-11-01 when the 0.1.x fixes changed rule severities.
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
  { schemaVersion, $schema, tool: {name, version, catalogDate}, target, startedAt, durationMs,
    server: {url|command, serverInfo, era, protocolVersion, transport, auth},
    coverage, limits, toolFingerprints: [{name, sha256, fields}] | null, baseline?: {toolChanges: {added, removed, changed: [{name, fields}]} | null, notCompared?}, summary: {errors, warnings, info, score, verdicts: {claude?, chatgpt?}, failed, baselined?},
    findings: [{ruleId, severity, platforms, severityByPlatform, title, message, tool?, resource?, path?, evidence?, fix, docs: string[], baselined?}],
    skipped: [{ruleId, reason}], ignored: [...], manual: [{id, platforms, text, docs}],
    disclaimer, contact: {text, url} | null }
  ```
  Findings are not collapsed. `baselined` and `summary.baselined` are present only with `--baseline` (§3.5); `limits.stopped.completed` and `limits.stopped.unfinished` only on a run stopped by `--max-duration` (§3.3). `authProbe` (1.1.0) is present only when `--active-auth` ran its probes: `authProbe.active.clientId` is the `client_id` from the dynamic client registration answer, or `null`; client secrets and registration access tokens are never in the report. `--json-output` and `--save-baseline` (0.3.0) write this document besides any `--format`. From 0.4.0 `toolFingerprints` is always present (§3.5), `baseline` only with `--baseline`, and `$schema` is the second key.
  **Report schema.** `schema/report.schema.json` (JSON Schema draft 2020-12, shipped in the npm package through `files`) describes `schemaVersion` 1. Its `$id` is the raw GitHub URL of the file at the tag of the release (`JSON_SCHEMA_URL` in `src/report/json.ts`, built from the package version; the release step updates `$id` with the version and a test checks that they agree), and the report repeats it in `$schema`; the URL answers 404 until that tag is pushed. Objects are closed (`additionalProperties: false`; the server's own `serverInfo` stays open), and a test validates the fixture reports with ajv (already a runtime dependency, `ajv/dist/2020.js`), so it fails when the report gains a field the schema lacks. `server` is exactly one of `url`, `command` (with `argv`) or `listingOnly`; `limits.budgetExhausted` records a snapshot budget stop. JSON and SARIF reports with more than 10 000 findings (also with `--baseline`) are printed without indentation; a report too large for one string ends the run with `error: the <format> report … is too large` (exit 3, no stack). No stdout or stderr line built from server text may start a workflow command: `visibleText`, a leading `::` and the legacy `##[` anywhere are neutralised (`ciSafeLine`); JSON and SARIF write `##[` as `#\u0023[` and JUnit as `#&#35;[`, the same value to a parser. `summary.gate.notGated` is null when the run could not connect.
- **markdown:** an H1 with the server name, a summary table, then one H2 per severity with a table (`Rule | Platforms | Subject | Message | Fix | Docs`), then, with `--baseline`, `## Changed tool definitions (N since baseline)` (a Tool | Change table, or a `>` note when not compared), then a manual checklist as `- [ ]` items, then the CTA (when due) and the disclaimer. Pipes inside cells are escaped.
- **sarif:** SARIF 2.1.0.
  - `tool.driver` = mcp-review-check, with `rules[]` taken from the catalog (`id`, `shortDescription`, `helpUri` = first source, `properties.platforms`).
  - Level mapping: error→`error`, warning→`warning`, info→`note`.
  - Each result has `logicalLocations` `[{name: tool, kind: 'function'}]` and `physicalLocation.artifactLocation.uri` set to the redacted server URL (`new URL().href`, so it is a valid URI), or `stdio:` + `encodeURIComponent(command)`.
  - `tool.driver.informationUri` is the project repository URL (`package.json` `repository.url`), never `CONTACT_URL`.
  - The output validates against the official SARIF 2.1.0 schema (vendored in `test/fixtures/sarif-schema-2.1.0.json`).
  - Manual items are excluded.
  - With `--baseline`, every result carries `baselineState` `new` or `unchanged` and `runs[0].properties.summary.baselined` counts the known ones (§3.5). Each changed tool definition adds one `note` result of the synthetic rule `BASE-001` "Tool definition changed since baseline" (`baselineState: new`, `properties.change` and `fields`, a partial fingerprint per change); its rule entry is added to the driver only when there is a change, and `runs[0].properties.baseline` holds the JSON drift object.
  - Known limitation: GitHub code scanning cannot link these results to source lines.
- **junit** (0.3.0, `src/report/junit.ts`): JUnit XML for CI test views (GitLab `reports: junit`, Jenkins, `dorny/test-reporter`).
  - Structure: a `<testsuites name="mcp-review-check">` root with `tests`, `failures`, `errors`, `skipped` (the sums of its suites) and `time` (the run duration in seconds). It holds one `<testsuite>` per gated platform (`summary.gate.platforms`: the `--target` directories, plus `spec` with `--fail-on-spec`) with the same counts and `<properties>`: target, score, failOn, the verdict (not on the `spec` suite) and, with known findings, baselined.
  - Test cases: one `<testcase classname="<platform>" name="<RULE-ID> <title>">` per catalog rule of that platform, plus any other rule ID with findings there (`INTERNAL`). Test cases carry no `time`.
  - Failure threshold: a test case whose findings reach `--fail-on` at the platform's own severity has one `<failure message="…" type="<severity>">` (the message is the first finding, or `N findings …; first: …`), whose body lists each such finding with its evidence and fix. With `--fail-on never` nothing fails.
  - `<system-out>`: findings below `--fail-on`, findings known from `--baseline` (`known from baseline, not a failure: …`; never failures) and `--ignore`d findings. With `--baseline` each suite's own `<system-out>` has the one-line known-findings tally.
  - Skipped: a skipped rule without findings is `<skipped message="<reason>"/>`. After a failed connect, SRV-003 (which reports it as a spec error only) is `<skipped message="could not connect"/>` in the claude and chatgpt suites, not a passed test case (1.0.1).
  - Error element: a failed connect or a `--max-duration` stop adds one `mcp-review-check run` test case per suite with `<error message="…" type="connect|max-duration"/>`, counted in `errors`, so a dead server is not a green test report.
  - Escaping: text passes through `visibleText` (control and format characters as `\u{..}`), then lone surrogates, U+FFFE and U+FFFF are shown as `\u{..}` (not allowed in XML 1.0), then `& < > " '` are escaped.
  - Manual items are excluded. On `--list-rules` the format prints the text catalog with a warning, as sarif does.

### 5.4 CTA constant
`src/report/constants.ts`:
```ts
export const CONTACT_URL = 'mailto:20horizon93@gmail.com';  // an absolute http(s) URL or a mailto: with one plain address
export const CTA_TEXT = 'Need help getting your connector approved?';
```
- When `CONTACT_URL` is valid (`contactUrl()`), text and markdown print `${CTA_TEXT} ${address or URL}` above the disclaimer on a `BLOCKED`, legacy-era or auth-required result, and JSON puts `{text, url}` in `contact`; SARIF never carries it.
- Otherwise (empty, a placeholder such as `<CONTACT_URL>`, a mailto: with a query or a second address) the CTA is omitted and JSON `contact` is `null`.

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
  **Decided 2026-11-02 (0.4.0):** keep. APPS-012 prefers `openai/widgetDomain`; revisit if OpenAI documents the precedence.
- **Q2:** Should SRV-004's "no A record" be checked against public DNS (DoH) instead of the system resolver? v1 uses the system resolver and says so in the message.
  **Decided 2026-11-02 (0.4.0):** keep the system resolver; the message says so.
- **Q3:** Should listing and manifest linting (`--listing listing.json`, `--plugin plugin.json`) turn the MAN-002/015..024 items into automated checks? This is planned for v1.1.
  **Decided 2026-11-02 (0.4.0):** yes, this release. `--plugin-dir` and `--openai-manifest` (not `--listing`/`--plugin`) feed LST-001..LST-026 (§2.13, §3.8), which automate MAN-015, 017, 018, 020 and 023 fully and MAN-002, 016, 019 and 021 in part. The OpenAI listing fields live in plugin.json, not in mcp.json. MAN-022 and MAN-024 stay manual.
- **Q4:** The score weights (12/4, cap of 3 per rule) are provisional. Revisit them after running the tool on real servers.
  **Decided 2026-11-02 (0.4.0):** keep the provisional weights; the seven frozen real-server snapshots show no anomaly.
- **Q5:** Should a run stopped by `--max-duration` get its own exit code (for example 4) instead of sharing 3 with "could not connect" and internal errors? CI could then tell "too slow" from "unreachable"; it changes the documented exit-code contract (§3.2), so it waits for a minor release.
  **Decided 2026-11-01 (0.2.0):** yes. A stop after the handshake (`limits.stopped` set, no fatal error) exits 4 at any `--fail-on`, so CI can tell "too slow" (4) from "unreachable" (3). A deadline that runs out before the handshake is a connect failure and stays exit 3. The change ships in the minor release 0.2.0, as the stability policy allows for a contract change, and is listed under "Changed" in the CHANGELOG (§3.2).
- **Q6:** Should a token the server rejects (`token-rejected`, tool checks skipped) fail the run, either always (exit 3) or behind an option such as `--fail-on-incomplete`? Today the exit code follows `--fail-on`, so a CI job with an expired token can pass with most checks skipped (a verdict without errors reads `INCOMPLETE`).
  **Decided 2026-11-01 (0.2.0):** not by default; behind the opt-in `--fail-on-incomplete`. Without the flag the exit code keeps following `--fail-on`, so existing pipelines that check an OAuth server without a token keep their result. With it, any partial check (`auth-required`, `token-rejected`, `list-failed`) exits 3; a stop is exit 4 with or without it. Independently of the flag, the GitHub Actions output prints one `::warning` for a partial check, naming the reason and that tool-level checks were skipped, so a green job with skipped checks is visible (§3.2).
- **Q7:** SARIF `level` maps the finding's highest severity over every platform (§5.3). Should it follow the gated platforms instead (so a spec-only error is a `note` without `--fail-on-spec`), or should an option such as `--sarif-level gated|max` choose?
  **Decided 2026-11-01 (0.2.0):** keep the current mapping: SARIF `level` is the finding's highest severity over all platforms (§5.3), with no option. The gate is the exit code; SARIF describes the finding, and the difference is a format inconsistency, not a contract break.
- **Q8:** Should APPS-013 count every `<a href>` in a widget as navigation that needs `redirect_domains`, not only `openExternal` / `ui/open-link`? It would add a ChatGPT warning to most widgets with links, and it is not verified that ChatGPT gates plain anchors.
  **Decided 2026-11-01 (0.2.0):** keep APPS-013 scoped to `openExternal` / `ui/open-link`. Until it is verified that ChatGPT gates plain anchors, counting every `<a href>` would add an unsupported warning to most widgets with links.
