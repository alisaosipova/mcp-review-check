# mcp-review-check rules

The rule catalog, dated <!-- CATALOG_DATE -->2026-10-22<!-- /CATALOG_DATE -->: every automated rule with its severity per platform and its public source, then the manual checklist. Generated from the code (`npm run build && npm run readme:rules`); do not edit the tables by hand. `mcp-review-check --list-rules --format markdown` prints the same tables, and `mcp-review-check explain <RULE-ID>` prints one rule's rationale, sources and fix.

Severity is listed per platform; a rule's platforms are the keys. **error** only when the source states a MUST or a rejection criterion *and* detection is deterministic; heuristics (regex or word lists) are at most **warning**. In [local mode](../README.md#local-mode) deploy-time checks are reported as info.

<!-- RULES:START -->
| ID | Title | Severity by platform | Source |
|---|---|---|---|
| SRV-001 | Remote server served over HTTPS | claude: error, chatgpt: error | [link](https://claude.com/docs/connectors/building/submission) |
| SRV-002 | Local stdio server cannot be submitted as a remote connector | claude: info, chatgpt: info | [link](https://claude.com/docs/connectors/building/submission) |
| SRV-003 | Streamable HTTP transport available | claude: warning, chatgpt: warning, spec: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| SRV-004 | Hostname resolves to public IPv4 | claude: error, chatgpt: error | [link](https://claude.com/docs/connectors/building/troubleshooting) |
| SRV-005 | Temporary tunnel or shared hosting domain | chatgpt: error, claude: warning | [link](https://developers.openai.com/plugins/build/mcp-server) |
| SRV-006 | No cross-host redirect at the registered URL | claude: error | [link](https://claude.com/docs/connectors/building/troubleshooting) |
| SRV-007 | Host-header (DNS-rebinding) protection rejects the public hostname | claude: error, chatgpt: error | [link](https://claude.com/docs/connectors/building/testing) |
| SRV-008 | Origin header handling | claude: info, chatgpt: info, spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) |
| SRV-009 | Bot challenge or WAF signature in responses | claude: warning, chatgpt: warning | [link](https://claude.com/docs/connectors/building/authentication) |
| SRV-010 | Handshake and listing latency | chatgpt: info | [link](https://developers.openai.com/plugins/deploy/troubleshooting) |
| SRV-011 | Server name ends with "MCP", "MCP Server" or "Plugin" | chatgpt: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| SRV-012 | Overly generic single-word name | chatgpt: info | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| SRV-013 | serverInfo present with name and version | spec: error | [link](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) |
| SRV-014 | Server instructions quality | chatgpt: warning, spec: info | [link](https://developers.openai.com/plugins/build/mcp-server) |
| SRV-015 | Server depends on features Claude does not support | claude: info | [link](https://claude.com/docs/connectors/building) |
| SRV-016 | ChatGPT domain-verification file format | chatgpt: info | [link](https://developers.openai.com/plugins/deploy/submission) |
| SRV-017 | Canonical server URL form | spec: warning, claude: info | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#canonical-server-uri) |
| SRV-018 | stdio server writes non-MCP output to stdout | spec: error | [link](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) |
| SRV-019 | tools/list stable across calls and connections | spec: warning | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#capabilities) |
| SRV-020 | Protocol era report | spec: info | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) |
| SPEC-001 | initialize result shape | spec: error | [link](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) |
| SPEC-002 | Capabilities declared for served primitives | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#capabilities) |
| SPEC-003 | Request responses use application/json or text/event-stream | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) |
| SPEC-004 | Notification POST returns 202 with no body | spec: error | [link](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) |
| SPEC-005 | GET on the MCP endpoint | spec: warning | [link](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) |
| SPEC-006 | Mcp-Session-Id format | spec: error | [link](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) |
| SPEC-007 | Unsupported protocol version rejected | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) |
| SPEC-008 | Unknown method → -32601 | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) |
| SPEC-009 | Unknown tool → JSON-RPC protocol error | spec: warning | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#error-handling) |
| SPEC-010 | Resource not found → error, never empty contents | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/resources#error-handling) |
| SPEC-011 | server/discover result | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/discover) |
| SPEC-012 | resultType on every result | spec: error | [link](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts) |
| SPEC-013 | Caching hints on cacheable results | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching) |
| SPEC-014 | Header/body mismatch rejected with -32020 | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#server-validation) |
| SPEC-015 | No sessions in modern-only servers | spec: warning | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#earlier-streamable-http-revisions) |
| SPEC-016 | JSON-RPC error codes and ids valid | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic#error-codes) |
| SPEC-017 | Icons well-formed | spec: warning | [link](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts) |
| SPEC-018 | _meta key syntax and reserved prefixes | spec: warning | [link](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts) |
| SPEC-019 | SSE responses disable proxy buffering | spec: info | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) |
| SPEC-020 | List methods for declared capabilities succeed | spec: error, claude: error, chatgpt: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#listing-tools) |
| TOOL-001 | Tool name characters and length | spec: warning | [link](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) |
| TOOL-002 | Tool name at most 64 characters | claude: error | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| TOOL-003 | Tool names unique | chatgpt: error, spec: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| TOOL-004 | Promotional or comparative tool name | chatgpt: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| TOOL-005 | Opaque tool name | chatgpt: info | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| TOOL-006 | Tool has a title | claude: error, spec: info | [link](https://claude.com/docs/connectors/building/review-criteria) |
| TOOL-007 | Tool has a description | chatgpt: error, claude: error, spec: info | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| TOOL-008 | Description too thin, generic or overloaded | claude: warning, chatgpt: warning | [link](https://developers.openai.com/plugins/plan/tools) |
| TOOL-009 | Every input parameter has a description | chatgpt: info, claude: info | [link](https://developers.openai.com/plugins/plan/tools) |
| TOOL-010 | Annotation field types | spec: error | [link](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts) |
| TOOL-011 | Claude: readOnlyHint or destructiveHint declared | claude: error | [link](https://claude.com/docs/connectors/building/submission) |
| TOOL-012 | ChatGPT: readOnlyHint, destructiveHint and openWorldHint all explicit booleans | chatgpt: error | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| TOOL-013 | Contradictory annotations | chatgpt: error, claude: warning, spec: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| TOOL-014 | Annotations likely do not match behavior (heuristic) | claude: warning, chatgpt: warning, spec: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| TOOL-015 | openWorldHint false on an open-ended tool (heuristic) | chatgpt: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| TOOL-016 | inputSchema present with root type "object" | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool) |
| TOOL-017 | Schemas valid for their dialect | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic#json-schema-usage) |
| TOOL-018 | Parameterless tool should set additionalProperties:false | spec: info | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool) |
| TOOL-019 | No network $ref | spec: warning | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic#ref-resolution) |
| TOOL-020 | Schema complexity bounded | spec: info | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic#composition-keyword-resource-use) |
| TOOL-021 | x-mcp-header constraints | spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#schema-extension) |
| TOOL-022 | x-mcp-header on a sensitive parameter | spec: warning | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#x-mcp-header) |
| TOOL-023 | Catch-all HTTP tool mixing safe and unsafe methods | claude: error | [link](https://claude.com/docs/connectors/building/review-criteria) |
| TOOL-024 | Operation enum mixing read and write, or many modes | claude: warning, chatgpt: warning | [link](https://claude.com/docs/connectors/building/review-criteria) |
| TOOL-025 | Generic executor or operation dispatcher | chatgpt: error | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| TOOL-026 | Free-form query tool must name or link the target API | claude: warning | [link](https://claude.com/docs/connectors/building/review-criteria) |
| TOOL-027 | Collection tools without pagination or limits | claude: info | [link](https://claude.com/docs/connectors/building/review-criteria) |
| TOOL-028 | No option to trim response size | claude: info | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| TOOL-029 | openai/toolInvocation status strings | chatgpt: error | [link](https://developers.openai.com/plugins/reference) |
| TOOL-030 | openai/fileParams file-object schema | chatgpt: error | [link](https://developers.openai.com/plugins/reference) |
| TOOL-031 | openai/profile marker contract | chatgpt: error | [link](https://developers.openai.com/plugins/build/auth) |
| TOOL-032 | Per-tool securitySchemes | chatgpt: info | [link](https://developers.openai.com/plugins/build/auth) |
| INJ-001 | Hidden or invisible characters | claude: error, chatgpt: error | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| INJ-002 | Mixed-script words (homoglyphs) | claude: warning, chatgpt: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| INJ-003 | Markup hidden from humans, or pseudo-system tags | claude: warning, chatgpt: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| INJ-004 | Encoded payloads | claude: warning, chatgpt: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| INJ-005 | Overriding system instructions or hiding behavior from the user | claude: error, chatgpt: error | [link](https://claude.com/docs/connectors/building/review-criteria) |
| INJ-006 | Steering the model away from other tools | claude: warning, chatgpt: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| INJ-007 | Coercing calls to tools or software the user did not request | claude: warning, chatgpt: warning | [link](https://claude.com/docs/connectors/building/review-criteria) |
| INJ-008 | Overly broad triggering | chatgpt: warning, claude: info | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| INJ-009 | Pulling instructions from external sources | claude: warning, chatgpt: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| INJ-010 | Safety-guardrail circumvention language | claude: warning, chatgpt: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| DATA-001 | Requests conversation history, transcripts, memory or system prompt | claude: error, chatgpt: error | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| DATA-002 | Reads Claude memory, chat history or user uploads | claude: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| DATA-003 | Inputs solicit secrets or credentials | chatgpt: error, claude: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| DATA-004 | Inputs collect restricted data (PCI, PHI, government IDs) | chatgpt: error | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| DATA-005 | Inputs request precise user location | chatgpt: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| POL-001 | Money or financial-asset transfer (heuristic) | claude: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| POL-002 | AI image, video or audio generation (heuristic) | claude: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| POL-003 | Advertising, sponsored content, pricing or promotions | claude: warning, chatgpt: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| POL-004 | Subscription upsell or checkout flow | chatgpt: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| POL-005 | Unofficial wrapper, demo or test server | chatgpt: info | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| APPS-001 | UI resourceUri uses ui:// and resolves | spec: error | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| APPS-002 | Deprecated or duplicated UI link keys | spec: warning, chatgpt: info | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| APPS-003 | UI resource MIME type and payload | spec: error, claude: error, chatgpt: error | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| APPS-004 | UI content looks like an HTML document | spec: warning | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| APPS-005 | UI resource declares a CSP | chatgpt: error, claude: info | [link](https://developers.openai.com/plugins/deploy/app-review) |
| APPS-006 | CSP entries narrow and well-formed | chatgpt: warning, spec: warning | [link](https://developers.openai.com/plugins/build/chatgpt-ui) |
| APPS-007 | External origins used by the widget are declared in the CSP | chatgpt: error, claude: warning, spec: warning | [link](https://developers.openai.com/plugins/build/chatgpt-ui) |
| APPS-008 | Nested frames declared | claude: warning, chatgpt: warning | [link](https://claude.com/docs/connectors/building/mcp-apps/design-guidelines) |
| APPS-009 | csp or permissions placed on the tool instead of the resource | spec: warning | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/src/spec.types.ts) |
| APPS-010 | Tool visibility | spec: error, chatgpt: warning | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| APPS-011 | Claude ui.domain equals the URL hash | claude: error | [link](https://claude.com/docs/connectors/building/mcp-apps/troubleshooting) |
| APPS-012 | ChatGPT dedicated widget domain | chatgpt: error | [link](https://developers.openai.com/plugins/reference) |
| APPS-013 | openExternal targets need redirect_domains | chatgpt: warning | [link](https://developers.openai.com/plugins/reference) |
| APPS-014 | App connects to the host | claude: warning | [link](https://claude.com/docs/connectors/building/mcp-apps/troubleshooting) |
| APPS-015 | Widget uses browser APIs the sandbox blocks | chatgpt: warning | [link](https://developers.openai.com/plugins/guides/security-privacy) |
| APPS-016 | Widget style and accessibility hints | chatgpt: info | [link](https://developers.openai.com/plugins/build/chatgpt-ui) |
| APPS-017 | UI resource meta field types | spec: error | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| APPS-018 | UI tools declare outputSchema | chatgpt: warning | [link](https://developers.openai.com/plugins/reference) |
| APPS-019 | UI tools stay callable without MCP Apps (text-only fallback) | spec: warning, chatgpt: warning | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| AUTH-001 | Token in the server URL query | claude: error, chatgpt: error, spec: error | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-002 | 401 challenge format | claude: error, chatgpt: error, spec: warning | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-003 | Wrong status for an unauthenticated request | claude: error, chatgpt: error, spec: warning | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-004 | Protected Resource Metadata discoverable | claude: error, chatgpt: error, spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery) |
| AUTH-005 | PRM `resource` matches the MCP URL | claude: error, spec: error, chatgpt: warning | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-006 | PRM authorization_servers | claude: error, chatgpt: error, spec: error | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-007 | Authorization server metadata discoverable | claude: error, chatgpt: error, spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery) |
| AUTH-008 | Issuer identical | claude: error, spec: error, chatgpt: warning | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery) |
| AUTH-009 | Required AS endpoints and response types | claude: error, chatgpt: error, spec: error | [link](https://datatracker.ietf.org/doc/html/rfc8414#section-2) |
| AUTH-010 | AS endpoints over HTTPS with trusted certificates | claude: error, chatgpt: error, spec: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations) |
| AUTH-011 | PKCE S256 advertised | claude: error, chatgpt: error, spec: error | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-012 | Client registration path | claude: warning, chatgpt: warning, spec: warning | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-013 | Authorization-code grant supported | chatgpt: error, claude: warning | [link](https://developers.openai.com/plugins/build/auth) |
| AUTH-014 | RFC 9207 iss parameter | chatgpt: info, spec: info | [link](https://developers.openai.com/plugins/build/auth) |
| AUTH-015 | Scope guidance | claude: info, spec: warning, chatgpt: info | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-016 | Invalid token gets 401 | spec: error, chatgpt: warning | [link](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#token-handling) |
| AUTH-017 | OAuth endpoint latency | claude: error | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-018 | Microsoft Entra ID notes | claude: info | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-019 | DCR accepts JSON registration | claude: warning | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-020 | Redirect URIs accepted at /authorize | claude: error | [link](https://claude.com/docs/connectors/building/authentication) |
| AUTH-021 | Token endpoint form-encoding and error codes | claude: error | [link](https://claude.com/docs/connectors/building/authentication) |
| RT-001 | Error messages are specific | claude: error | [link](https://claude.com/docs/connectors/building/review-criteria) |
| RT-002 | Invalid input silently accepted | claude: warning, spec: warning | [link](https://claude.com/docs/connectors/building/review-criteria) |
| RT-003 | Input-validation errors reported with isError | spec: warning | [link](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts) |
| RT-004 | Result size | claude: error | [link](https://claude.com/docs/connectors/building) |
| RT-005 | Tool latency | claude: error, chatgpt: warning | [link](https://claude.com/docs/connectors/building) |
| RT-006 | structuredContent conforms to outputSchema | spec: error, chatgpt: error | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#output-schema) |
| RT-007 | structuredContent mirrored as text | spec: warning | [link](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content) |
| RT-008 | UI tools return meaningful content | spec: warning | [link](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| RT-009 | Auth failures surfaced at the transport level | claude: warning, chatgpt: warning | [link](https://claude.com/docs/connectors/building/lazy-authentication) |
| RT-010 | Results leak internals or secrets | chatgpt: warning | [link](https://developers.openai.com/plugins/plugin-guidelines) |
| RT-011 | Injection patterns in tool output | claude: warning, chatgpt: warning | [link](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| RT-012 | Behavior gated on clientInfo | claude: info | [link](https://claude.com/docs/connectors/building/testing) |

**Manual checklist** (printed as reminders; never scored):

| ID | Platform | Reminder |
|---|---|---|
| MAN-001 | claude | Privacy policy URL (data collection, usage, retention) |
| MAN-002 | claude | Listing: name ≤100, one-liner ≤200, description ≤2000, 1–5 categories, docs URL, privacy URL, support contact, icon; slug is permanent |
| MAN-003 | claude | ≥3 working example prompts; populated test account |
| MAN-004 | claude | Public documentation by publish date |
| MAN-005 | claude [ui] | Carousel screenshots: PNG, ≥1000 px wide, 3–5 images, cropped to the app response |
| MAN-006 | claude [ui] | Allowed link URIs: https origins or owned custom schemes only |
| MAN-007 | claude [oauth] | Rotate refresh tokens for public clients; return the new one in the same response |
| MAN-008 | claude [oauth] | Register `https://claude.ai/api/mcp/auth_callback` exactly; loopback callbacks port-agnostic |
| MAN-009 | claude | WAF/CDN allows Anthropic egress `160.79.104.0/21` |
| MAN-010 | claude | Server calls your own first-party APIs (or legitimately proxied ones) |
| MAN-011 | claude | Compliance acknowledgments: guidelines, first-party API, financial transactions, AI media generation, prompt injection, conversation data, public docs |
| MAN-012 | claude | Tool descriptions accurately describe real behavior (reviewers test each tool in Verified review) |
| MAN-013 | spec [oauth] | Validate token audience (accept the canonical URI); never pass the client's token upstream |
| MAN-014 | spec [oauth] | Low-scope token → 403 `insufficient_scope` with `scope` and `resource_metadata` |
| MAN-015 | chatgpt | Listing (final submission limits): displayName ≤30, shortDescription ≤30, longDescription ≤4000, developerName ≤80, valid category, ≤20 capabilities of ≤120 chars |
| MAN-016 | chatgpt | websiteURL, supportURL, privacyPolicyURL, termsOfServiceURL: HTTPS, no credentials, ≤1024 chars, publicly accessible |
| MAN-017 | chatgpt | Starter prompts: ≤3, ≤128 chars, single line, unique, no @mentions |
| MAN-018 | chatgpt | Brand colors `#RRGGBB`, ≥2:1 contrast vs white / vs #212121 (dark) |
| MAN-019 | chatgpt | Icons square, 48–4096 px, ≤5 MiB, PNG/JPEG/WebP/SVG |
| MAN-020 | chatgpt | Exactly 5 positive and 3 negative test cases; tools_triggered exist; release notes |
| MAN-021 | chatgpt | Demo recording URL covering web, iOS and Android |
| MAN-022 | chatgpt | Works on desktop and mobile, including UI; light and dark themes; WCAG AA contrast |
| MAN-023 | chatgpt | Package: no test_credentials/reviewer_instructions, no clientSecret, no non-empty server headers, no `.app.json`/apps/hooks |
| MAN-024 | chatgpt [ui] | Screenshots are optional and allowed only with custom UI: one PNG or JPEG per starter prompt, exactly 706 px wide, 400–860 px tall |
| MAN-025 | chatgpt | Privacy policy discloses categories, purposes, recipients, retention, user controls; covers every user field tools return |
| MAN-026 | chatgpt [oauth] | Reviewer test account: works externally, no MFA/SMS/magic link, doesn't expire, seeded data |
| MAN-027 | chatgpt | Be ready to justify each tool's three hints (`justification_required` may still appear) |
| MAN-028 | chatgpt [oauth] | Advertised OIDC scopes (openid/email/profile) enabled for the client |
| MAN-029 | chatgpt | Not an unofficial third-party connector, demo or trial; EU data residency projects cannot submit |
| MAN-030 | chatgpt | Physical goods only for commerce; no subscription upsell |
| MAN-031 | spec | Consider running `npx @modelcontextprotocol/conformance server --url <url>` for full schema conformance |
<!-- RULES:END -->
