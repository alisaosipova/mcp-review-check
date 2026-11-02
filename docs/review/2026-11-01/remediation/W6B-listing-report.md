# W6B-listing — step 1 report (wave 6, 0.4.0)

Package W6B-listing, step 1: listing loader, LST rules, manual checklist filtering, fixtures and tests. The CLI wiring (`--plugin-dir`, `--openai-manifest`, config keys, README) is step 2 and is specified at the end. `src/cli.ts`, `README.md`, `CHANGELOG.md` and `docs/design/spec.md` were not edited.

## Done

| Item | Files |
|---|---|
| (a) Loader: `loadPluginDir(dir)` reads `.claude-plugin/plugin.json`, `.mcp.json`, README*, LICENSE*, package-manager configs and the file list; `loadOpenAiManifest(path)` parses the package manifest and reads the companion `mcp.json` / `.mcp.json` and the root entries. Both return a `Listing` `{ plugin?, openai?, errors[], truncated[] }`. `attachListing(snap, listing)` stores it as `snap.listing` (additive) and adds the cut strings to `snap.limits.truncated`; `mergeListings(...)` combines the two inputs. | `src/listing/{types,load,index}.ts`, `src/snapshot.ts` (`listing?: Listing`) |
| (b) Rules LST-001..LST-026: platform `claude` for plugin checks, `chatgpt` for the package manifest; the message names the MAN item where there is one; skipped without input through two new needs; cross-checks with the live server. | `src/rules/listing.ts`; needs in `src/rules/types.ts`, `src/rules/engine.ts` (`unmetNeed`), `src/explain.ts` (`NEED_LABEL`) |
| (c) Manual checklist: with the input given, fully automated MAN items are dropped and partly automated ones keep only their manual rest plus "(the rest is checked by LST-0xx)". No renderer change was needed. | `src/rules/manual.ts`, `LISTING_MANUAL` in `src/rules/listing.ts` |
| (d) Registration (`CATEGORY_ORDER` gets `LST` last), frozen range `...range('LST', 26)`, pos/neg case for every rule, regenerated `docs/RULES.md`, fixtures. | `src/rules/index.ts`, `test/catalog.test.ts`, `test/rules/listing.test.ts`, `docs/RULES.md`, `test/fixtures/listing/**` |

Bounded reading: links are listed (`kind: 'symlink'`) but never followed (lstat, then `O_NOFOLLOW`); `.git` is skipped; JSON over 1 MiB (`LISTING_JSON_CAP`) is not parsed; README and configs are read up to 256 KiB (`LISTING_TEXT_CAP`); at most 10,000 entries (`LISTING_FILES_CAP`, the directory's repository limit), depth 32; parsed strings over `TEXT_CAP` are cut with `capStrings` from `src/limits.ts` (read-only use). Errors are recorded with relative paths and an error code (`could not be read (ENOENT)`), never with an absolute path, and are never thrown.

Redaction: the report redactor does not know values from the plugin files, so no rule quotes a header, env, `clientSecret`, `test_credentials` or `reviewer_instructions` value ("value not shown"). URLs go through `displayUrl` (userinfo and secret parameters removed). A test checks that no `SYNTH` string from the fixtures and no `user:` userinfo reaches any finding.

### Files outside the owned list (minimal, necessary)

- `src/rules/types.ts` (+2 `Need` values), `src/rules/engine.ts` (+4 lines in `unmetNeed`), `src/explain.ts` (+1 line in `NEED_LABEL`, which is a `Record<Need, string>` and would not typecheck otherwise). The task asks for the "existing needs mechanism", and that mechanism lives in these three files. No other package owns them in wave 6.
- `test/catalog.test.ts`: as well as `...range('LST', 26)`, `LST` was added to the ID regex on line 17. The test fails without it. The SPEC number was not touched.
- `npm run readme:rules` also rewrites the `RULE_COUNT` spans in `README.md` and `docs/design/spec.md` (147 → 173). I reverted those two files because they are not mine. **The integrator (or W6E) must run `npm run build && npm run readme:rules` again after the merge.** The CI "generated docs are current" check fails until then. `test/docs.test.ts` only compares `docs/RULES.md` and passes.

## Rule table

Sources: C-PSC = https://claude.com/docs/plugins/pre-submission-checklist, C-REF = https://code.claude.com/docs/en/plugins-reference, O-SUB = https://developers.openai.com/plugins/deploy/submission, O-ERR = https://developers.openai.com/plugins/deploy/submission-errors.

| ID | Platform | Severity (finding-level lowering) | MAN item | Needs | Source |
|---|---|---|---|---|---|
| LST-001 | claude | error (info: skills-only folder) | — | plugin-dir | C-PSC, C-REF |
| LST-002 | claude | error for non-ASCII / reserved; warning for other pattern breaks | — | plugin-dir | C-PSC, C-REF#name |
| LST-003 | claude | warning | — | plugin-dir | C-PSC, C-REF |
| LST-004 | claude | error for no README; warning for <40 words (approximate count) | — | plugin-dir | C-PSC |
| LST-005 | claude | error | — | plugin-dir | C-PSC |
| LST-006 | claude | error | — | plugin-dir | C-PSC, https://code.claude.com/docs/en/mcp |
| LST-007 | claude | error | — | plugin-dir | C-PSC |
| LST-008 | claude | error | — | plugin-dir | C-PSC |
| LST-009 | claude | error | — | plugin-dir | C-PSC |
| LST-010 | claude | warning (error: bundle fetched from a URL) | — | plugin-dir | C-PSC, C-REF#mcpservers |
| LST-011 | claude | error for a known token format; warning for a literal under a credential name or `${ENV}` from the user's machine | — | plugin-dir | C-PSC, C-REF#user-configuration |
| LST-012 | claude | error | — | plugin-dir | C-PSC |
| LST-013 | claude | warning | — | plugin-dir | C-PSC |
| LST-014 | claude | warning (info: field missing) | MAN-002 (part) | plugin-dir | C-REF#directory-listing-fields, connectors/building/submission |
| LST-015 | claude | warning | — | plugin-dir, http | C-PSC |
| LST-016 | chatgpt | error (warning: bare mcp.json given) | MAN-015 | openai-manifest | O-SUB, O-ERR |
| LST-017 | chatgpt | error (info: developerName / category missing) | MAN-015 | openai-manifest | O-ERR, O-SUB |
| LST-018 | chatgpt | error | MAN-016 (format part) | openai-manifest | O-SUB, O-ERR |
| LST-019 | chatgpt | error (warning: duplicate after normalization, @mention; both heuristic) | MAN-017 | openai-manifest | O-ERR, O-SUB |
| LST-020 | chatgpt | error | MAN-018 | openai-manifest | O-ERR, O-SUB |
| LST-021 | chatgpt | error (warning: logo/composerIcon missing in Agent Plugins format, non-`./` path) | MAN-019 (part) | openai-manifest | O-SUB, O-ERR |
| LST-022 | chatgpt | error (warning: test_cases / demo_recording_url / release_notes omitted, because omission keeps saved dashboard values) | MAN-020, MAN-021 (part) | openai-manifest | O-SUB, O-ERR |
| LST-023 | chatgpt | error | MAN-023 | openai-manifest | O-SUB, O-ERR |
| LST-024 | chatgpt | warning (error: mcp.json does not parse) | MAN-020 (one-server part) | openai-manifest | O-SUB, O-ERR |
| LST-025 | chatgpt | warning | MAN-020 | openai-manifest, tools | O-SUB |
| LST-026 | chatgpt | warning | — | openai-manifest, http | O-SUB |

Manual items with input given: `--openai-manifest` drops MAN-015, 017, 018, 020, 023. MAN-016 keeps "publicly accessible and identify the same publisher", MAN-019 keeps "square, 48–4096 px, ≤5 MiB" and MAN-021 keeps "covers web, iOS and Android". `--plugin-dir` cuts MAN-002 to the connector-form part (name/one-liner/description limits, categories, support contact, permanent slug). MAN-022 and MAN-024 stay unchanged: they need image decoding or a live UI.

## Verified facts (fetched 2026-11-02)

**https://claude.com/docs/plugins/pre-submission-checklist**
- The plugin folder contains `.claude-plugin/plugin.json`. Without it the folder is blocked, except a folder with no plugin.json and `skills/<name>/SKILL.md`, which passes with a note (Claude Code only).
- `name`: lowercase letters, digits and hyphens, up to 64 characters, starts and ends with a letter or digit. It is blocked for non-ASCII and gets a warning for other breaks. Reserved whole names (`claude`, `anthropic`, `official`, `plugin`, `mcp`, `test`) are blocked ("Name is taken").
- `description`, `author` and `version` missing gives a warning.
- README of at least 40 words in the plugin folder, with words in code blocks not counted: blocks ("README missing", "README too short"). A `LICENSE` file or the `license` field: blocks ("License missing").
- `.DS_Store`, `Thumbs.db`, `desktop.ini`, `__MACOSX`: blocks.
- Non-image/font files over 256 KiB, more than 512 files, or binaries other than images and fonts are held for a reviewer. Symlinks, submodules and LFS pointers are blocked where the plugin loads them.
- MCP servers are declared with `command` and `args` or with `url`, not `.mcpb`/`.dxt`: held, and blocked for a bundle fetched from a URL.
- Launchers (`npx`, `bunx`, `pnpm dlx`, `yarn dlx`, `uvx`, `pipx run`, `uv run`) must pin an exact version (`npx <package>@1.2.3`, `uvx <package>==1.2.3`, not a range or `@latest`), and `uv run` needs `--locked`/`--frozen`: blocks.
- With a launcher, a package-manager config that sets a registry, index or proxy (`.npmrc`, `bunfig.toml`, `uv.toml`) blocks.
- Real credentials in any file block ("Secret in MCP headers"). Use `userConfig` with `sensitive: true` and `${user_config.KEY}`. Reading a credential from the user's environment (`$GITHUB_TOKEN`) is held.
- `.mcp.json` must be valid JSON matching the schema: blocks.
- A remote server needs `type` `http`/`sse`/`ws` and a `url` that is absolute `https://`/`wss://`, `${user_config.KEY}` or `""`: blocks ("MCP server URL is not https").

**https://code.claude.com/docs/en/plugins-reference**
- `name` is the only required key. `claude plugin validate` errors on names starting `claude-`, `anthropic-`, `anthropics-`, `cc-plugin-`, on `claude-code` and `claude-mods`, and on `official` beside `claude`/`anthropic`.
- `mcpServers` can be a path, an `.mcpb`/`.dxt` bundle path or URL, an inline map, or an array.
- The directory reads `icon`, `documentationUrl`, `supportUrl`, `privacyPolicyUrl` and `termsOfServiceUrl` from plugin.json. Each URL is `https://`, and `icon` is an image path inside the plugin.
- `${user_config.KEY}` resolves in MCP `url`, `headers`, `command`, `args` and `env`.

**https://claude.com/docs/connectors/building/submission**
- The connector listing (name ≤100, one-liner ≤200, description ≤2000, 1–5 categories, docs URL, privacy URL, support contact, icon, permanent slug) is entered in the portal, not in plugin files. This is why MAN-002 stays mostly manual.
- Local servers are submitted inside a plugin; MCPB is no longer accepted.

**https://developers.openai.com/apps-sdk/deploy/submission** redirects to **https://developers.openai.com/plugins/deploy/submission**
- The listing lives in **plugin.json**: `extensions.com.openai.interface` in the Agent Plugins format, or root `interface` in a Codex manifest `.codex-plugin/plugin.json`. Review and publication go under `extensions.com.openai.{review,publication}`. **`mcp.json` only holds the MCP configuration** (`mcpServers`, auth). MARKET §3.10 and the plan call the input "ChatGPT app mcp.json". The loader therefore accepts the package plugin.json (either format) and reads the companion `mcp.json`/`.mcp.json` from the package root. A bare `mcp.json` is accepted, and LST-016 then warns that the listing was not checked.
- Limits: displayName ≤30, shortDescription ≤30, longDescription ≤4000, developerName ≤80, capabilities ≤20 × ≤120. The four listing URLs (`websiteURL`, `supportURL`, `privacyPolicyURL`, `termsOfServiceURL`) are required for MCP review, HTTPS, without embedded credentials, ≤1024 characters. `defaultPrompt` has ≤3 prompts of ≤128 characters, unique, with no @mentions. `brandColor` is `#RRGGBB` with ≥2:1 contrast against white, and `brandColorDark` ≥2:1 against #212121. Icons are PNG/JPEG/WebP/SVG, ≤5 MiB, square, 48–4096 px, at `./` paths; logo and composerIcon are required in the Codex format, and a primary icon is required before submission.
- `review.test_cases.positive`/`negative` need exactly 5 and 3 cases for initial MCP review. A case has `description` and `prompt`. Positive cases also have `tools_triggered` (a **String**, comma-separated in the examples) and `expected_behavior`. `review.demo_recording_url` is required for MCP review. Omitting `test_cases` or the scalars keeps saved dashboard values. Skills-only plugins need no cases.
- The manifest rejects `clientSecret`. ZIP metadata rejects `test_credentials` and `reviewer_instructions`. Public submission rejects non-empty server headers. ZIPs with `apps`/`.app.json` cannot be submitted. Hooks must be removed before public submission.

**https://developers.openai.com/plugins/deploy/submission-errors**
- Categories: Productivity, Creativity, Developer Tools, Business & Operations, Data & Analytics, Communication, Education & Research, Security, Finance, Healthcare, Travel, Entertainment, Other. Category is optional on this page (omitted means Other) but "Required" on the submission page, so a missing category is info and an unknown one is an error.
- Final submission requires 5 positive, 3 negative test cases and release notes. Local MCP configuration is excluded unless the organization is approved (`mcp_configuration_excluded`). Prompts must be unique "after normalization", which is not defined, so the duplicate check is a heuristic warning.

Heuristic limits (no limit or method stated by the vendor; marked warning/info): the README word count (whitespace/Intl segmentation after removing code), credential-looking literals in headers/env, prompt normalization, @mention detection, and the host match against the target (LST-015/026, linter-defined).

## Deferred

- MAN-024 screenshots (706 px wide, one per starter prompt) and MAN-019 dimensions and size need image decoding. Reason: `feature: image metadata reading`.
- Following `mcpServers` paths in plugin.json other than `.mcp.json` (for example `./mcp/servers.json`), and scanning hook/server scripts for launchers (held by the checklist). Reason: `feature: follow plugin component paths`.
- Repository-level checks (`.gitattributes` filters, file-name portability, archive size). Reason: they need the git repository rather than the plugin folder (`feature: repository checks`).
- Translations (`publication.translations.<locale>.subtitle ≤30`) are not checked. Reason: low value, not in MAN items.
- Updating `CATALOG_DATE` in `src/catalog.ts` to 2026-11-02 (the vendor pages were read today). Reason: `needs src/catalog.ts`. Proposed for the integrator, followed by `npm run readme:rules`.
- Listing errors other than an unreadable plugin root (an unreadable subfolder, for example) are kept in `snap.listing.errors` but produce no finding. Step 2 should print them on stderr.

## Tests

- `npm run typecheck`: pass.
- `npm run build`: pass.
- `npx vitest run test/remediation-w6b-*.test.ts test/rules/*.test.ts test/catalog.test.ts test/docs.test.ts test/engine*.test.ts`: 13 files, 367 tests passed.
- `npx vitest run test/unit-manual.test.ts test/unit-catalog-lexicon.test.ts test/cli-rules.test.ts test/limits.test.ts`: 4 files, 23 tests passed.
- New: `test/rules/listing.test.ts` (27 tests, pos/neg for every LST rule), `test/remediation-w6b-listing.test.ts` (21 tests: fixtures, target filtering, needs/skip reasons, additivity, manual checklist, missing/invalid/oversized/long-string inputs, links not followed (skipped on win32), Codex layout, launcher parser, WCAG contrast, README prose).
- Fixtures: `test/fixtures/listing/{plugin-valid,plugin-invalid,openai-valid,openai-invalid,openai-mcp-only}`. Token-shaped strings contain `SYNTH`. `.DS_Store` is in `.gitignore`, so the invalid plugin uses `Thumbs.db`.

## Proposed CHANGELOG lines (`## [Unreleased]` → Added)

- Manifest linting (spec Q3): `--plugin-dir <dir>` checks a Claude plugin folder (`.claude-plugin/plugin.json`, `.mcp.json`, README, LICENSE, launcher pins, package sources, bundles, credentials in headers, system files, file limits, directory listing fields), and `--openai-manifest <file>` checks a ChatGPT plugin package manifest (listing text limits, the four HTTPS listing URLs, starter prompts, brand color contrast, icons, review test cases, forbidden fields, the MCP server). 26 new rules LST-001..LST-026 follow the Claude plugin pre-submission checklist and the OpenAI submission pages. With a URL or stdio target they cross-check against the live server (`tools_triggered` in `tools/list`, remote URL host). Without the new options nothing changes.
- The manual checklist drops MAN-015, MAN-017, MAN-018, MAN-020 and MAN-023 when `--openai-manifest` is given, and keeps only the manual rest of MAN-016, MAN-019 and MAN-021 (and of MAN-002 with `--plugin-dir`).

## Proposed spec paragraphs (`docs/design/spec.md`)

**§2.x LST: listing and plugin manifests.** Two optional inputs are read from disk before the rules run and stored as `snap.listing`: `--plugin-dir <dir>`, a Claude plugin folder (the folder containing `.claude-plugin/plugin.json`), and `--openai-manifest <file>`, a ChatGPT plugin package manifest (`plugin.json` with `extensions.com.openai`, or a Codex `.codex-plugin/plugin.json`), whose companion `mcp.json`/`.mcp.json` is read from the package root. Reading is bounded (no link is followed, JSON ≤1 MiB, text ≤256 KiB, ≤10,000 entries, strings cut at TEXT_CAP and reported with the other input caps), and read or parse problems are recorded, not thrown. LST rules need `plugin-dir` or `openai-manifest` and are skipped with "needs --plugin-dir" / "needs --openai-manifest" otherwise. Plugin rules have platform `claude` and package rules `chatgpt`. Severity follows the vendor result: "Blocks" or "rejects" with deterministic detection is an error, "held for a reviewer" a warning, and heuristics (word count, credential-looking literals, prompt normalization, @mentions) at most a warning. Values that may be credentials are never quoted.

**§8 Q3 (decided).** Yes, in 0.4.0: LST-001..LST-026 automate MAN-015, MAN-017, MAN-018, MAN-020 and MAN-023 fully and MAN-002, MAN-016, MAN-019 and MAN-021 in part. The manual checklist drops or shortens those items when the corresponding input is given. MAN-022 and MAN-024 stay manual (they need a live UI or image decoding). The OpenAI listing fields live in plugin.json, not in mcp.json.

## What step 2 needs (CLI wiring, after W6A is integrated)

- **Flags** in `src/cli.ts` (`parseArgs` options and `--help` under Options):
  - `--plugin-dir <dir>`: "Also lint a Claude plugin folder (.claude-plugin/plugin.json, .mcp.json, README, LICENSE) against the plugin directory checklist (LST rules)."
  - `--openai-manifest <file>`: "Also lint a ChatGPT plugin package manifest (plugin.json with extensions.com.openai, or .codex-plugin/plugin.json; its mcp.json is read from the package root) (LST rules)."
- **Config keys** in `src/config.ts`: `pluginDir` (string) and `openaiManifest` (string). Paths are resolved relative to the config file's folder, like the other path keys, and a flag overrides the key.
- **Wiring**: after `buildSnapshot` and before `runRules`, call `attachListing(snap, mergeListings(opts.pluginDir && loadPluginDir(opts.pluginDir), opts.openaiManifest && loadOpenAiManifest(opts.openaiManifest)))` (from `./listing/index.js`). A path that does not exist should be a usage error (exit 2) before connecting; the loaders themselves only record it. Print `snap.listing.errors` on stderr as `warning: <source> <path> <message>`. `manualChecklist(snap)` already filters by `snap.listing`.
- **Redaction**: the rules never quote credential values. If step 2 adds a `--verbose` dump of the listing, pass literal header/env values from `.mcp.json` to the redactor first.
- **Tests for step 2**: the `--help` options and README options table must match (`test/docs.test.ts`). Add an e2e run of `--stdio good-server --plugin-dir test/fixtures/listing/plugin-invalid` that expects exit 1 and LST findings, and one with `--target chatgpt --openai-manifest test/fixtures/listing/openai-valid/plugin.json` that expects no LST finding and MAN-015 missing from the JSON `manual`.
- **README text** (new section "Listing and plugin manifests", and rows in the Options table):

  > ### Listing and plugin manifests
  >
  > Pass the files you submit and the same run lints them against the directory checklists. `--plugin-dir ./my-plugin` checks a Claude plugin folder: `.claude-plugin/plugin.json` (name, description, author, version, listing URLs and icon), a README of at least 40 words, a LICENSE, `.mcp.json` (schema, `https://`/`wss://` remote URLs, exact `npx pkg@x.y.z` / `uvx pkg==x.y.z` pins, no `.mcpb`/`.dxt` bundles, no credentials in headers), no `.npmrc` registry next to a launcher, and no system files. `--openai-manifest ./package/plugin.json` checks a ChatGPT plugin package: listing text limits (displayName and shortDescription ≤30, longDescription ≤4000), the four HTTPS listing URLs, starter prompts, brand color contrast, icons, exactly 5 positive and 3 negative review test cases, and no `clientSecret`, reviewer credentials, server headers, apps or hooks. With a server target, the test cases' `tools_triggered` must exist in `tools/list` and the manifest's server URL should point at the server you checked. The manifest checks are offline: nothing is fetched. The manual checklist then leaves out the items these rules cover. Replace "Listing and plugin manifests are not linted yet" wherever the README says so.
  >
  > | `--plugin-dir <dir>` | Claude plugin folder to lint (LST rules) | — |
  > | `--openai-manifest <file>` | ChatGPT plugin package manifest to lint (LST rules) | — |
