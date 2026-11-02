# W6C-spec-rules report (wave 6, 0.4.0)

Branch `worktree-wf_9e838c12-410-3`. Rule IDs: SPEC-020 was the last SPEC rule, so SPEC-021, SPEC-022 and SPEC-023 were free and are used as planned.

## Done

| Item | Result |
|---|---|
| 1. SPEC-021 deprecated features | New rule, `spec: info`. It reports `capabilities.logging`, `capabilities.sampling` and `capabilities.roots` in the server's capabilities. It reads initialize and server/discover separately, so a dual-era server whose two objects differ gets one finding that names both sources. It also reports an HTTP+SSE-only transport (`transport.kind === 'sse'`), and `sampling/createMessage` / `roots/list` requests that show up in `inputRequests` of 2026-07-28 `input_required` results (`modernResults`) or of active tool-call results. Separately, it reports `includeContext: "thisServer"`/`"allServers"` in those sampling requests. Every finding is info: the registry says new implementations **SHOULD NOT** adopt a deprecated feature, and no page says MUST NOT, so nothing qualified for warning. It does not duplicate SRV-015 (Claude platform support, `claude: info`) or SRV-003 (SSE-only for the directories): SPEC-021 is spec-platform only and is about protocol deprecation. |
| 2. SPEC-022 serverInfo in result `_meta` | New rule, `spec: info`, `needs: ['modern']`, so it runs only when 2026-07-28 was negotiated (era `modern` or `dual`). It lists the methods whose 2026-07-28 results lack `_meta["io.modelcontextprotocol/serverInfo"]` (one finding, methods deduplicated). In a second finding it reports a value that is not an object with string `name` and `version`. The rule reads `transport.modernResults`, plus `discoverRaw` when no server/discover result was recorded (as in the frozen dual-era fixtures). |
| 3. SPEC-023 `capabilities.extensions` | New rule, `spec: error`. These cases are errors because they are deterministic: extensions is not an object; an identifier has no vendor prefix, or has an invalid prefix label or name (the `_meta` key rules with a mandatory prefix are a MUST in schema.ts); a settings value is not an object (the `JSONObject` type). A well-formed identifier under a non-official prefix reserved for MCP (for example `dev.mcp/x`) is a warning, the same level SPEC-018 gives that `_meta` rule. Official `io.modelcontextprotocol/*` identifiers pass. When `io.modelcontextprotocol/tasks` is declared, the rule gives an info "declared, not verified" for each of `tasks/get`, `tasks/update`, `tasks/cancel` without a recorded result. The run never calls these methods. **Connect-package follow-up:** add a read-only probe, for example `tasks/get` with a non-existent `taskId` (the spec says servers SHOULD answer with a JSON-RPC error), so the methods can be verified. |
| 4. AUTH DCR/CIMD | AUTH-012 already had the spec info "DCR only: DCR deprecated in 2026-07-28; add CIMD" under the exact condition (`registration_endpoint` and not `client_id_metadata_document_supported: true`). Per the plan I **extended AUTH-012** and added no new rule. The new message is: `DCR only: Dynamic Client Registration is deprecated in 2026-07-28 for new servers; add CIMD (Claude uses it only with client_id_metadata_document_supported: true and "none" in token_endpoint_auth_methods_supported)`. The deprecated features registry is added to `sources`. Severities are unchanged. |
| 5. Registration and docs | The three rules are added to `specRules`. `test/catalog.test.ts` now has `range('SPEC', 23)` (only that number changed). Pos/neg cases are in `test/rules/spec.test.ts`, with realistic near misses: `completions` / `resources.subscribe`, an official extension with settings, and a third-party `com.acme/audit`. `npm run readme:rules` regenerated `docs/RULES.md`. |

## Files

- `src/rules/spec.ts` — SPEC-021..023 and the helpers `capabilitySources`, `perSource`, `inputRequests`
- `src/rules/auth.ts` — AUTH-012 message and sources
- `test/rules/spec.test.ts` — cases for SPEC-021..023
- `test/catalog.test.ts` — SPEC range 20 → 23
- `test/remediation-w6c-spec-rules.test.ts` — new, 20 tests
- `docs/RULES.md` — regenerated
- `README.md` and `docs/design/spec.md` — **only** the generated `<!-- RULE_COUNT -->` marker (147 → 150), written by `npm run readme:rules`, in its own commit (a5bff4e). I made no manual edit to spec.md. If W6B's LST rules land too, the integrator re-runs `npm run readme:rules` and the count follows.

## Tests run

- `npm run typecheck` — passes
- `npm run build` — passes
- `npx vitest run test/remediation-w6c-*.test.ts test/rules/*.test.ts test/catalog.test.ts test/docs.test.ts test/remediation-wp4-protocol.test.ts test/real-servers.test.ts` — **13 files, 387 tests passed**
- `MCP_REVIEW_CHECK_SKIP_BUILD=1 npx vitest run test/e2e-stdio.test.ts` (GOOD/BAD fixture set, a check that `BAD_STDIO_RULES` needs no change) — **25 passed**

## Findings delta on the frozen real-server snapshots

The delta was computed by running all rules over `test/fixtures/real/*` before and after the change.

| Server | Before | After | Delta |
|---|---|---|---|
| kiwi | 6 | 6 | — (discover carries serverInfo, `version: ""` is a string) |
| huggingface | 18 | 18 | — (`extensions: {"io.modelcontextprotocol/skills": {...}}` is valid; discover has serverInfo) |
| mslearn | 14 | 15 | **+ SPEC-021 info**: `initialize: capabilities.logging is declared; Logging is deprecated in 2026-07-28 (SEP-2577); ...` |
| exa | 4 | 4 | — |
| svelte | 23 | 23 | — |
| openzeppelin | 74 | 74 | — |
| aws-knowledge | 12 | 12 | — |

This looks right. MS Learn really declares `logging: {}`, and the finding is info, so it changes no gate. No rule raised a warning or error, `ACCEPTED_NEW` stays empty, and `real-servers.test.ts` passes. The fixtures hold no `modernResults`, so SPEC-022 checks only the frozen discover results here, and all three dual-era servers carry serverInfo.

## Verified facts (fetched 2026-11-02)

- https://modelcontextprotocol.io/specification/2026-07-28/changelog
  - "Deprecated" section: Roots, Sampling and Logging are deprecated (SEP-2577, https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2577). HTTP+SSE is reclassified as Deprecated (SEP-2596, https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2596). The `includeContext` values `thisServer`/`allServers` are Deprecated (SEP-2596). DCR is deprecated in favour of CIMD (PR #2858).
  - Wording: "New implementations should not adopt them."
  - Major change 2 (SEP-2575): servers SHOULD identify themselves in each result's `_meta` (`io.modelcontextprotocol/serverInfo`).
  - Minor change 1: adds `extensions` to ServerCapabilities.
  - Major change 6 (SEP-2663): tasks become the `io.modelcontextprotocol/tasks` extension with `tasks/get`, `tasks/update` and `tasks/cancel`; `tasks/list` is removed.
- https://modelcontextprotocol.io/specification/2026-07-28/deprecated (registry): "new implementations **SHOULD NOT** adopt it". It lists Roots, Sampling, Logging and DCR (deprecated in 2026-07-28), `includeContext` thisServer/allServers (2025-11-25, removal follows Sampling), and HTTP+SSE (2025-03-26). **No MUST NOT anywhere**, so SPEC-021 is info throughout.
- https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts
  - `ServerCapabilities.logging` is `@deprecated` (SEP-2577).
  - `sampling` and `roots` exist only in ClientCapabilities. A server declaring them is therefore non-standard, and the SPEC-021 message says so.
  - `extensions?: { [key: string]: JSONObject }` — "Keys MUST follow the `_meta` key naming rules, with a mandatory prefix."
  - `ResultMetaObject["io.modelcontextprotocol/serverInfo"]` — "Servers SHOULD include this field on every response".
  - `includeContext`: "The values `thisServer` and `allServers` are deprecated (SEP-2596): servers SHOULD omit this field or use `none`".
  - `InputRequests` is a map of `CreateMessageRequest | ListRootsRequest | ElicitRequest`.
- https://modelcontextprotocol.io/docs/extensions/overview: identifiers are `{vendor-prefix}/{extension-name}` and follow the `_meta` key rules with a mandatory prefix. Official extensions use `io.modelcontextprotocol`. Servers advertise extensions in server/discover capabilities, and on 2025-11-25 in `initialize` `result.capabilities.extensions` (same rules).
- https://github.com/modelcontextprotocol/ext-tasks/blob/main/specification/2026-07-28/tasks.md: "The extension introduces three methods: `tasks/get`, `tasks/update`, and `tasks/cancel`". "Upon receiving a `tasks/get` request, the server MUST …". `tasks/update` and `tasks/cancel`: "the server MUST acknowledge the request with an empty result". **Not stated explicitly:** a sentence of the form "a server that declares the extension MUST implement all three methods". That obligation follows from the method definitions, and is also why the tasks part of SPEC-023 is info ("declared, not verified").
- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration: "Dynamic Client Registration is deprecated. New implementations should use Client ID Metadata Documents instead." Authorization servers advertise CIMD with `client_id_metadata_document_supported: true`.
- https://claude.com/docs/connectors/building/authentication: "Claude selects CIMD only when your authorization server metadata advertises both `"client_id_metadata_document_supported": true` and `"none"` in `token_endpoint_auth_methods_supported` … If either is missing, Claude falls back to DCR."

**Unverifiable or partial:** the obligation to implement all three tasks methods (see above) is info only. Everything else is backed by the quotes above.

## Deferred

- **Tasks method probe** — reason `needs src/probe/**` / `src/connect.ts` (W6D or the next connect package): a read-only `tasks/get` with a bogus `taskId` when `io.modelcontextprotocol/tasks` is declared, so SPEC-023 can verify the methods instead of reporting "not verified".
- **Catalog date** — reason `needs src/catalog.ts`: the sources were re-read on 2026-11-02, and CONTRIBUTING step 6 suggests bumping `CATALOG_DATE` and re-running `npm run readme:rules`. Left to the integrator or W6E.
- **SPEC-005 / `subscriptions/listen` (MARKET §3.12 item 4)** — not in this package's item list. Reason `feature: tighten SPEC-005 for modern-only GET as subscriptions/listen`.
- **Logging notifications observed** (`notifications/message` without `logLevel`): the snapshot records no server notifications. Reason `needs src/connect.ts` (record notifications).

## Proposed CHANGELOG lines (`## [Unreleased]` → Added / Changed)

```
### Added
- SPEC-021 (spec info): deprecated 2026-07-28 features in use — `logging`, `sampling` or `roots` in the server's capabilities, an HTTP+SSE-only transport, `sampling/createMessage` or `roots/list` requested through `input_required` results, and `includeContext: "thisServer"`/`"allServers"` (SEP-2577, SEP-2596; links the deprecated features registry).
- SPEC-022 (spec info): 2026-07-28 results without `_meta["io.modelcontextprotocol/serverInfo"]` (SHOULD), or with a malformed value.
- SPEC-023 (spec error): `capabilities.extensions` must be an object keyed by prefixed `_meta`-style identifiers with object settings; a reserved non-official prefix is a warning; `io.modelcontextprotocol/tasks` declared without verified `tasks/get`, `tasks/update`, `tasks/cancel` is info.

### Changed
- AUTH-012: the DCR-only spec finding now says that Dynamic Client Registration is deprecated in 2026-07-28 for new servers and that Claude uses CIMD only with `client_id_metadata_document_supported: true` and `"none"` in `token_endpoint_auth_methods_supported`; it cites the deprecated features registry.
```

## Proposed spec paragraphs (`docs/design/spec.md` §2.2, after SPEC-020; and AUTH-012)

**SPEC-021 Deprecated protocol features in use.** Severity: spec=info.
- Detect, each as info (the registry says new implementations SHOULD NOT adopt a Deprecated feature; there is no MUST NOT):
  - `capabilities.logging`, `capabilities.sampling` or `capabilities.roots` in the initialize or server/discover capabilities. Sampling and roots are client capabilities, and the message says so. A dual-era server whose two capability objects both show the problem gets one finding naming both.
  - `transport.kind === 'sse'` (HTTP+SSE only, deprecated since 2025-03-26). SRV-003 carries the directory consequence.
  - `inputRequests` entries with `sampling/createMessage` or `roots/list` in 2026-07-28 `input_required` results or in active tool-call results, and, separately, `includeContext` `"thisServer"`/`"allServers"` in such a sampling request.
- Not duplicated: SRV-015 (Claude support of sampling/tasks/subscriptions).
- Source: https://modelcontextprotocol.io/specification/2026-07-28/deprecated, https://modelcontextprotocol.io/specification/2026-07-28/changelog#deprecated

**SPEC-022 2026-07-28 results identify the server.** Severity: spec=info. Needs: modern.
- Detect: an object result in `transport.modernResults` (or `discoverRaw` when no server/discover result is recorded) without `_meta["io.modelcontextprotocol/serverInfo"]`. The finding lists the methods once. A second finding covers a value that is not an object with string `name` and `version`.
- Source: schema.ts (`ResultMetaObject`), changelog major change 2.

**SPEC-023 capabilities.extensions well-formed.** Severity: spec=error.
- Detect, in the initialize and server/discover capabilities:
  - `extensions` is not an object → error.
  - An identifier has no `/`, or has an invalid prefix label or name per the `_meta` key rules → error.
  - A well-formed identifier under a non-official reserved prefix → warning.
  - A settings value is not an object → error.
  - `io.modelcontextprotocol/tasks` declared while `tasks/get`, `tasks/update` or `tasks/cancel` has no recorded result → info "declared, not verified". The run does not call them yet.
- Source: schema.ts (`ServerCapabilities.extensions`), https://modelcontextprotocol.io/docs/extensions/overview, https://github.com/modelcontextprotocol/ext-tasks/blob/main/specification/2026-07-28/tasks.md

**AUTH-012**, Spec bullet: replace with "Spec: neither → warning. DCR only → **info**: 'DCR only: Dynamic Client Registration is deprecated in 2026-07-28 for new servers; add CIMD (Claude uses it only with client_id_metadata_document_supported: true and "none" in token_endpoint_auth_methods_supported)'." Add https://modelcontextprotocol.io/specification/2026-07-28/deprecated to the sources.
