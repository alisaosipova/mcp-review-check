# WP7-auth-spec-srv remediation report

Branch `worktree-wf_365c0c99-4d0-7`, base `8b0f41e`. Owned files: `src/rules/{auth,spec,server,manual}.ts`, `src/rules/util/{wwwAuth,net}.ts`. Regression tests: `test/remediation-wp7-auth-spec-srv.test.ts`.

Verification: `npm run typecheck`, `npm run build`, `npx vitest run test/remediation-wp7-auth-spec-srv.test.ts test/rules test/util.test.ts test/local-mode.test.ts test/auth-probe.test.ts test/root-causes.test.ts test/catalog-stale.test.ts test/docs.test.ts test/report.test.ts` (16 files, 438 tests, green), plus `test/e2e-http.test.ts -t "modern bad server"` and `-t "cross-host redirect"`.

## Done

| id | commit | what changed |
|---|---|---|
| F041 | 6277b6d | SPEC-011: when the era is modern only because server/discover was rejected (-32020/-32021/-32022), the finding is info and shows the HTTP status, code, message and data.supported. "result is not an object" stays an error only for a result that is not an object. |
| F038 | 3806e40 | AUTH-020: a login page that carries redirect_uri in a hidden input is the "verify manually" info again. A rejection needs a 400, an OAuth JSON error naming the redirect, or error wording about the redirect URI. |
| F020 | ffe770e | WWW-Authenticate parser: an unquoted value such as `resource_metadata=https://...` is read whole up to `,` or whitespace, as the MCP SDK does. It no longer becomes `https` plus a phantom challenge. `Challenge.unquoted` lists such params, and AUTH-002 adds a spec warning asking for the quotes. |
| F052 | 4972912 | AUTH-017: the error needs most samples over 10 s (a one-shot call still counts). A single outlier is a warning with "N of M samples". |
| F050 | ff01b0e | SPEC-001 no longer reports a missing serverInfo. SRV-013 owns that finding. |
| F049 | ae9829c | On a modern-only server, the GET status and session use are reported only by SPEC-015. SPEC-005 skips modern-only servers. SPEC-006 drops its "see SPEC-015" warning but still checks the session id format in every era. |
| F051 | 010e317 | A 401 with no OAuth discovery at all: AUTH-004 keeps the error on all platforms. AUTH-002 becomes info "(see AUTH-004)", and the AUTH-013 ChatGPT note becomes info. Legacy-discovery and well-known-PRM verdicts are unchanged. |
| F045 | 144344f | `isBearerLike` (bearer or DPoP) in util/wwwAuth.ts. AUTH-003, AUTH-015 and AUTH-016 now read DPoP challenges as AUTH-002 and AUTH-013 already did. |
| F042 | 9426750 | AUTH-012: CIMD without "none" and without DCR gives one Claude warning naming both facts. The two contradictory warnings are gone. |
| F027 | 2c73979 | net.ts normalizes IPv6 to 8 groups. IPv4-mapped hex form (`::ffff:7f00:1`), uncompressed loopback, zone ids, `ff00::/8` and `2001:db8::/32` are recognized by `isNonPublicIPv6` and `isLoopbackHost`. |
| F040 | c7f65d1 | SPEC-016: the 2026-07-28 range/removed-code policy applies only when the server era is modern or dual. |
| F121 | 0527bea | The manual checklist lists the [oauth] items when OAuth was found through legacy discovery (also any AS metadata), not only through a PRM. The regression test went into commit c7f65d1. |
| F039 | 8a811eb | SPEC-018: a prefix is reserved when `modelcontextprotocol` or `mcp` is followed by another label (modelcontextprotocol.io/, mcp.dev/, tools.mcp.com/) or sits in the second label (io.modelcontextprotocol/, dev.mcp/). `mcp/x` and `com.example.mcp/x` stay valid. |
| F043 | bda8532 | Local mode: a TLS failure of a local AS (loopback, private, dotless or the MCP host) is info with the "Deploy-time check:" prefix in AUTH-010 and in AUTH-007 (metadata fetch failed on a TLS code). The local banner picks these up automatically, because report/text.ts collects them by the DEPLOY prefix. |
| F060 | 8120e7f | SPEC-010: content returned for the made-up missing URI is an info observation (catch-all handler). |
| F059 | 01a01c1 | SRV-010 samples only successful (2xx) `sdk <method>`, `modern <method>` and `discover` exchanges. It falls back to `transport.timings` when no exchanges were recorded. |
| F056 | 39f2ad5 | SPEC-017: a non-array `sizes` is a warning. `image/jpg` is removed from the allow-list and reported as info "use image/jpeg". |
| F054 | af046d8 | SRV-006: a cross-host redirect only on GET is a warning. On the POST preflight it stays a Claude error. The F055 regression test went into this commit. |
| F055 | ed19c9f | SRV-015 matches only `sampling/createMessage`, "MCP sampling" and "sampling request(s)/capability(ies)", not the bare word. |
| F057, F058 | 3050452 | AUTH-006 validates authorization_servers[1..2] as ChatGPT findings with their index. AUTH-007 skips an issuer that is not a URL and had no attempts (AUTH-006 already reports it). |
| F053 | 8960548 | AUTH-008: "metadata has no issuer (RFC 8414 REQUIRED)" or "is not a string" instead of "issuer undefined !== …". |

## Deferred

| id | reason |
|---|---|
| F061 | needs docs/design/spec.md. The code is deliberately consistent: the spec platform of AUTH-002 is a warning because the spec needs only one discovery mechanism, and AUTH-004 carries the spec error. §2.8 AUTH-002 should read "chatgpt error, spec warning, claude warning" for legacy discovery. This is WP10. |

## Existing tests changed

- `test/rules/auth.test.ts`. AUTH-017 positive case: `[100, 11000]` became `[11000, 100, 12000]` (F052). AUTH-002 positive case: now a non-https `resource_metadata`, because the no-discovery case is info (F051). "AUTH-013 401 without OAuth discovery": chatgpt `error` became `info` (F051).
- `test/rules/spec.test.ts`. SPEC-016 positive case now sets `era = 'dual'` (F040).
- `test/e2e-http.test.ts`. "modern bad server" no longer expects SPEC-006 for a UUID session id (F049).

## Notes for WP10 (docs/design/spec.md, docs/RULES.md)

- §1.4: local mode now also downgrades AUTH-010 and AUTH-007 for a local AS with an untrusted certificate.
- §1.5: the net helpers cover hex-form IPv4-mapped, ff00::/8 and 2001:db8::/32. `isBearerLike` is a new helper. The WWW-Authenticate parser is now lenient on unquoted values.
- SPEC-001 no longer lists serverInfo. SPEC-005 has no modern-only branch (SPEC-015 owns it). SPEC-006 drops the third bullet. SPEC-010 has a new content info. SPEC-011 reports a rejected discover as info. SPEC-016 is era-gated. SPEC-017 covers sizes type and image/jpg. SPEC-018 has the new reserved-prefix wording.
- SRV-006: GET-only is a warning. SRV-010: 2xx SDK calls only. SRV-015: narrowed sampling wording.
- AUTH-002: a no-discovery header is info, and an unquoted resource_metadata gets a spec warning. AUTH-006 checks [1..2] for chatgpt. AUTH-007 has the unparsable-issuer skip and local TLS. AUTH-012 has the merged message. AUTH-013: the no-discovery note is info. AUTH-017 uses a sample majority. AUTH-020 has the narrowed rejection test.

## CHANGELOG lines

### Fixed
- SPEC-011 reports a rejected `server/discover` (-32020/-32021/-32022) as info with its HTTP status, code and `data.supported`, instead of an error saying the result is not an object.
- AUTH-020 no longer treats a login page that carries `redirect_uri` in a hidden input as a rejected redirect URI, so a correct authorization server is no longer BLOCKED for Claude with `--active-auth`.
- An unquoted `resource_metadata=https://...` in `WWW-Authenticate` is read whole (as MCP SDK clients do), so the header PRM is found. AUTH-002 adds a spec warning to quote it.
- AUTH-003, AUTH-015 and AUTH-016 read `scope=`, `error=` and `resource_metadata` from DPoP challenges.
- AUTH-012 gives one Claude warning for CIMD without `"none"` and without DCR, instead of two contradictory ones.
- IPv4-mapped IPv6 addresses in hex form (`[::ffff:7f00:1]`), uncompressed loopback, multicast and documentation ranges count as local or non-public.
- SPEC-016 no longer applies the 2026-07-28 error-code range policy to legacy servers answering the discover probe.
- The manual checklist shows the OAuth items for servers that use legacy (2025-03-26) discovery without a PRM.
- SPEC-018 flags the spec's reserved `_meta` prefix examples (`modelcontextprotocol.io/`, `mcp.dev/`, `tools.mcp.com/`).
- AUTH-008 says the metadata has no `issuer` instead of printing `undefined`.
- SRV-015 no longer reads "audio sampling rate" or "statistical sampling" as MCP sampling.

### Changed
- AUTH-017 is a Claude error only when most latency samples exceed 10 s. A single slow sample is a warning.
- A 401 without any OAuth discovery is one error (AUTH-004). AUTH-002 and the AUTH-013 ChatGPT note become info pointing to it.
- A missing `initialize.serverInfo` is reported once, by SRV-013 (no longer also by SPEC-001).
- On modern-only servers, the GET status and session use are reported once, by SPEC-015 (no longer also by SPEC-005 and SPEC-006).
- In local mode, an untrusted certificate on a local authorization server is a "Deploy-time check" info in AUTH-010 and AUTH-007.
- SRV-006: a cross-host redirect only on GET is a warning. The POST handshake redirect stays a Claude error.
- SRV-010 measures latency over successful handshake and listing calls only.
- AUTH-006 also validates `authorization_servers[1]` and `[2]` for ChatGPT. AUTH-007 no longer repeats AUTH-006 for an issuer that is not a URL.

### Added
- SPEC-010 notes (info) a server that returns content for a missing resource URI.
- SPEC-017 warns when an icon's `sizes` is not an array and notes `image/jpg` (use `image/jpeg`).
