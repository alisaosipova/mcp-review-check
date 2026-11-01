# WP5-apps remediation report

Package: `src/rules/apps.ts`, `src/rules/util/{ui,html,access}.ts`. Branch `worktree-wf_365c0c99-4d0-5`.
Regression tests: `test/remediation-wp5-apps.test.ts`.

## Done

| Id | Commit | What changed |
|---|---|---|
| F084 | c82b2c4 | The CSS `url()` scan in `extractOrigins` no longer matches the JS URL constructor (`new URL("https://...")`, `x.URL(...)`). APPS-007 stops raising a false resource-origin error for a fetch target declared in connectDomains. |
| R032 | 506f856 | APPS-006 treats `*.<rest>` as overly broad when `rest` is a public suffix (it uses `registrableDomain`, so `co.uk` and `com.au` count), a shared host suffix, or a shared cloud host (`cloudfront.net`, `amazonaws.com`, `azureedge.net`, `googleapis.com`, ...). |
| F101 | 5a4f7fc | `extractOrigins` reads `import ... from "https://..."`, `import "https://..."`, `export ... from "https://..."`, `import("https://...")` and the `<script type="importmap">` targets (imports and scopes) as resource origins with js confidence, so APPS-007 caps them at warning. |
| F099 | 697bce0 | `extractLinks` (POL-004) takes hrefs from `<a>` and `<area>` only, so `<link rel=stylesheet href=.../pricing.css>` and `<base href>` are no longer reported as upsell links. |
| R041 | 9b6e623 | APPS-012 compares the widget domain with the shared sandbox as an origin, so a value in any letter case gets the not-unique warning. |
| R030 | 6c0695d | `uiResources` falls back to the only content item, or the only text/html item, when no item has the requested uri. The HTML rules and the `_meta` checks (APPS-005, APPS-012, ...) now check it. APPS-001 still reports the mismatch and names the item's uri. |
| R042 | 0abe855 | APPS-017 reports a `_meta.ui` that is a string, an array, null or a number as an error ("_meta.ui is a string, not an object") and does not go on to the field checks. |
| R033 | c29b242 | APPS-006 flags `ws://` to a non-loopback host as it already flagged `http://`. |
| R034 | c29b242 | APPS-006: a wildcard outside the leftmost host label (`https://api.*.example.com`, `https://*.example.*`) is now reported as invalid. `data:`, `blob:` and other bare scheme sources are reported as "a scheme source, not an origin", where the message used to be "has a path...". |
| R035 | c29b242 | A host without a scheme (`api.example.com`) gets a single APPS-006 finding ("has no scheme; write https://..."). `originMatches` treats such an entry as a CSP host-source (https/wss), so APPS-007 no longer also says the origin is undeclared. |
| R043 | c29b242 | APPS-006 now declares `claude: 'info'`, the platform its public-CDN hint already emitted. Entry problems keep explicit `chatgpt`/`spec` platforms, so Claude users get only the CDN hint, as before. |
| F106 | c29b242 | APPS-006 reports an entry that appears in both `ui.csp` and `openai/widgetCSP` for the same list once, naming both fields (`connectDomains/connect_domains`). |
| R037 | 7afe743 | APPS-015 searches for dialogs in comment-stripped HTML. `navigator.clipboard.writeText`/`.write` pass when the resource declares `ui.permissions.clipboardWrite`. Reads and other clipboard use are still flagged. |
| F108 | 7afe743 | APPS-015 skips bare `alert(`/`confirm(`/`prompt(` calls when the widget declares that name itself (`function`, `const`/`let`/`var`/`class`, a function or arrow parameter). `window.prompt(` is always flagged. The message no longer carries the preceding character (`>alert(` becomes `alert(`). |
| R040 | 7afe743 | APPS-016 trackers now also include googletagmanager.com, google-analytics.com, static.hotjar.com, cdn.segment.com and api.segment.io. `data-alt=` and `aria-alt=` no longer count as alt text. |
| F107 | 78080b9 | `normalizeMime` unquotes parameter values (RFC 2045 quoted-string) and trims the space around `=`, so APPS-003 accepts `text/html; profile="mcp-app"`. |
| R038 | 78080b9 | APPS-019 skips a tool that is also missing from `toolsFreshConnection` (a fresh connection with full capabilities). Such a tool varies per session, which SRV reports, so its absence is not caused by the UI extension. |
| R036 | a072902 | `cspOf` collects unknown CSP keys. APPS-005 warns "unknown CSP field openai/widgetCSP.connectDomains is ignored by hosts (did you mean connect_domains?)". |

## Deferred

| Id | Reason |
|---|---|
| F102 | Contradicts spec.md §APPS-013 ("openExternal targets need redirect_domains"). Counting every `<a href>` as a navigate origin widens the rule beyond openExternal/ui/open-link. Whether ChatGPT gates plain anchors with redirect_domains is not verified, and the change would add a chatgpt warning to most widgets that contain links. Needs a spec decision (docs/design/spec.md, WP10/maintainer) before code. |

## Existing tests changed

None. Expected red until WP10 regenerates the catalog: `test/docs.test.ts` ("docs/RULES.md equals the generator output"). APPS-006 now has `claude: info` (R043), so `docs/RULES.md` (and the README rule table, if generated) must be regenerated with `npm run readme:rules`.

## Notes for WP10 (docs/design/spec.md, docs/RULES.md)

- Regenerate docs/RULES.md: APPS-006 severity is `chatgpt: warning, claude: info, spec: warning`.
- spec.md `extractOrigins`: add ES module `import`/`export ... from`/`import()` and import-map targets (resource, js confidence). CSS `url()` excludes the JS `URL(` constructor. `originMatches` accepts scheme-less host-sources.
- spec.md APPS-001: when the uri does not match, the only (or only text/html) item is checked as the widget.
- spec.md APPS-005: unknown CSP keys → warning. APPS-006: `ws://`, invalid wildcard position, scheme sources, scheme-less hosts, multi-label/cloud suffixes, one finding per duplicated entry, and the claude info severity line. APPS-015: comments, own functions, clipboardWrite permission. APPS-016: tracker list. APPS-017: `_meta.ui` not an object. APPS-019: tools missing from the fresh connection are skipped.

## CHANGELOG lines

### Fixed
- APPS-007 no longer reports a `new URL("https://...")` target as an undeclared resource origin (error) when the host is declared in connectDomains.
- POL-004 no longer reports stylesheets, icons or `<base>` hrefs (for example `/css/pricing.css`) as upsell links; only `<a>` and `<area>` links count.
- APPS-012 recognises the shared ChatGPT sandbox domain in any letter case.
- When resources/read returns the widget under a different uri (for example a cache-busting `?v=2`), the HTML and CSP rules check that item, instead of reporting false "no CSP declared" and "no widget domain" errors and skipping its HTML. APPS-001 still reports the uri mismatch.
- APPS-006 reports wildcards on multi-label public suffixes (`*.co.uk`, `*.com.au`) and shared cloud hosts (`*.cloudfront.net`, `*.amazonaws.com`) as overly broad.
- APPS-006 flags unencrypted `ws://` entries, wildcards outside the leftmost host label, and `data:`/`blob:` scheme sources with accurate messages.
- APPS-006 reports a CSP entry repeated in `_meta.ui.csp` and `openai/widgetCSP` once, not twice.
- A CSP entry without a scheme now gives one APPS-006 finding and no longer also makes APPS-007 report the origin as undeclared.
- APPS-003 accepts a quoted MIME parameter, `text/html; profile="mcp-app"`.
- APPS-015 no longer flags dialogs mentioned in comments, the widget's own `prompt`/`confirm`/`alert` functions, or clipboard writes when `clipboardWrite` permission is declared.
- APPS-016 no longer takes `data-alt` for alt text.
- APPS-019 no longer blames the UI extension for a tool that is also missing from a fresh full-capability connection.

### Changed
- APPS-006 lists `claude: info` among its platforms, matching the public-CDN hint it already emitted for Claude.
- APPS-016 also reports Google Tag Manager, Google Analytics, Hotjar and Segment as trackers.

### Added
- APPS-007 checks origins of ES module imports and `<script type="importmap">` targets (warning, as other script-derived origins).
- APPS-005 warns about CSP keys the hosts ignore (for example camelCase `connectDomains` inside `openai/widgetCSP`) and suggests the known field.
- APPS-017 reports a `_meta.ui` that is not an object.
