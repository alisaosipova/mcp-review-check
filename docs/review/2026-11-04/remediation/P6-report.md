# P6 Listings: remediation report (1.0.1)

Base: `origin/main` at 5c521cb. Files changed: `src/listing/load.ts`, `src/listing/image.ts`, `src/listing/index.ts`,
`src/listing/types.ts`, `src/rules/listing.ts`, `src/rules/manual.ts`; new test `test/r3-p6-listings.test.ts`.
No existing test was edited. All items were reproduced first: 20 of the 21 new tests fail on 5c521cb; the remaining
one is a positive control (a declared mcpServers file that exists is read).

Patch-policy notes: no rule was added and no severity was raised. Some fixes put a **warning** where there was none
before, in cases that used to give a wrong pass: a file read through a linked folder (A06-03), and a declared
`mcpServers` file that is missing (A06-09). Those findings were kept at warning, never error, so a default
`--fail-on error` gate cannot turn red. The integrator should confirm this is acceptable for a patch.

## Fixed

| Id | What changed | Test (`test/r3-p6-listings.test.ts`) |
|---|---|---|
| A06-01 | `manualChecklist` drops or shortens an item only when every rule in `LISTING_MANUAL[id].rules` ran (its `needs` are met, checked with the engine's `unmetNeed`) **and** could check (new `listingRuleChecked` in `src/rules/listing.ts`). The field rules need the interface object, LST-023 needs a parsed manifest that is not a bare MCP config, and LST-014 needs a parsed plugin.json. An MCP config only, a manifest that does not parse, or a manifest without an interface now keeps MAN-015..024 whole. A plugin.json that does not parse keeps MAN-002 whole. | `A06-01 …` (4 tests) |
| A06-02 | `LISTING_MANUAL` entries can have `parts` (the manual text for a rule that did not run). MAN-020 has a part for LST-025: when LST-025 is skipped (listing-only run, no tools), MAN-020 stays as "tools_triggered names exist in tools/list (run with the server as the target to check them) (the rest is checked by LST-022)". | `A06-02 …` |
| A06-03 | `readCapped` checks that the file's real path is inside the real root (new `within()`), so a linked folder on the way (`.claude-plugin -> ../outside`, `cfg/ -> ../outside`) is refused with "is behind a symbolic link that leads out of the folder (not followed), so it was not checked". The README and package configs are covered too. The resulting `ListingJson` has `level: 'warning'`, so LST-001/006/016/024 report it as a warning instead of parsing the outside file. Nothing from the outside file reaches findings or the `--verbose` dump. A `./` icon whose real path leaves the package now says "behind a symbolic link…" (warning) instead of "is not a ./ path". | `A06-03 …` (2 tests) |
| A06-04 | `loadPluginDir` and `loadOpenAiManifest` resolve the path the user gave with `realpathSync` once (a linked folder or linked manifest is followed). The package root is the real folder of the manifest. Links *inside* the package are still not followed. This removes the false "the plugin folder is not a directory" / "is a symbolic link (not followed)" errors. | `A06-04 …` (2 tests) |
| A06-05 | `unmeasured()` now knows whether it is checking an icon. For icons, `not-a-path`, ref-based `outside`, and `unknown-format` when the extension already fails LST-021 return nothing, because LST-021 owns those cases: one finding at LST-021's level (warning for a URL or `../`, error for `.gif`). For screenshots, which LST-021 does not check, a ref that is not a `./` path inside the package is now a warning, as in LST-021 (it was an error). | `A06-05 …` (2 tests) |
| A06-10 | Icons over the 64 MiB read cap: only the 5 MiB error remains (no second read-cap error). Screenshots over it: a warning, "over this tool's 64 MiB read cap, so it was not opened and its size was not checked". A manifest or MCP config over the 1 MiB JSON cap: `level: 'warning'`, "…read cap; not parsed, so not checked (a limit of this tool, not of the directory)", reported as a warning by LST-001/006/016/024. The `LISTING_JSON_CAP` comment is corrected. | `A06-10 …` (2 tests) |
| A06-06 | New `svgRootAt()` skips the BOM, whitespace, `<?…?>`, comments and `<!DOCTYPE …>`, including an internal subset with `>` in quotes or declarations. It searches the whole header read (256 KiB), not just 4 KiB. `sniffFormat` and `svgSize` use the root element, so a long licence prologue is an SVG, and an `<svg>` inside a comment no longer sets the size. | `A06-06 …` (3 tests) |
| A06-07 | `dumpValue` hides a key when `SECRET_KEY` **or** the shared `isSecretName` matches it (`privateKey`, `x-auth`, …). Arrays use the stdio-argv flag logic: the element after a secret-named flag (`--api-key <v>`), the part after `=` in `--auth=<v>` / `TOKEN=<v>`, the value of a secret-named `Name: value` header element, and a whole known-format token. Plain flags (`--port 8080`) stay. | `A06-07 …` |
| A06-08 | New `listingDump(l, esc)` in `src/listing/index.ts` stringifies `describeListing` and runs `esc` (the CLI's `visibleText`) **per line**, so the pretty-print newlines stay. **cli.ts still needs a one-line change (integrator, see below).** | `A06-08 …` |
| A06-09 | A string `mcpServers` in the manifest is now the only MCP file read. If it is missing, empty, or not a `./` path inside the package, a ListingError is recorded and `mcp = { path, error, level: 'warning' }`. LST-024 reports it as a warning ("config/missing.json does not exist in the package (declared in mcpServers), so no MCP configuration was checked"). The root `mcp.json` / `.mcp.json` fallback is used only when `mcpServers` is not a string. A URL value is shown through `displayUrl`. | `A06-09 …` (3 tests) |
| improvement | "Share one secret-key predicate": the dump now uses the shared `isSecretName` from `src/rules/util/net.ts`, the predicate that LST-011 and the redactor already use, plus its own block list (headers, env). A single exported predicate that also replaces `SECRET_HEADER` in `src/redact.ts` and `src/rules/listing.ts` is outside P6's files (see integrator notes). | covered by `A06-07` |

## Not fixed / partly fixed

- A06-06, reverse case (a non-SVG file such as text named `.png` that contains `<svg width=512 height=512>` somewhere in its first 4 KiB): left as before, so it is still accepted as SVG. Reporting it as `unknown-format` would add an error to a package that passed on 1.0.0, which a patch must not do. The 1.0.x compatibility branch in `sniffFormat` is marked in a comment. Proposal for 1.1.0: delete that branch so such a file is `unknown-format`.
- A06-08 needs the integrator to change `src/cli.ts` (P6 does not own it).

## Integrator notes

1. **A06-08, `src/cli.ts` line 548.** Replace
   `if (snap.listing) stderr += \`[listing]\n${visibleText(JSON.stringify(describeListing(snap.listing), null, 2))}\n\`;`
   with
   `if (snap.listing) stderr += \`[listing]\n${listingDump(snap.listing, visibleText)}\n\`;`
   and import `listingDump` from `./listing/index.js` (`describeListing` may then go from the import). Optional end-to-end assertion: the stderr line after `[listing]` is `{` and the dump has more than one line.
2. **Shared secret predicate (improvement).** Move one `isCredentialKey(name)` into `src/rules/util/net.ts` (`isSecretName` plus the header names in `SECRET_HEADER` from `src/redact.ts` and `src/rules/listing.ts`), then use it in `redact.ts`, LST-011 and `src/listing/index.ts`. Separately, `displayUrl` keeps a `sig=` query value (reported under A06-07). That is in `util/net.ts`, which P6 does not own.
3. A file behind a linked folder (A06-03) and a missing declared `mcpServers` file (A06-09) are now **warnings** where 1.0.0 parsed the wrong file without a message. Only `--fail-on warning` can turn red on them. Confirm this is acceptable for the patch.
4. `manualChecklist(snap)` decides whether a rule ran from its `needs`, as the engine does. It does not see `--ignore` or a `--max-duration` stop. If exact parity is wanted later, pass `runRules(...).skipped` into `manualChecklist` (signature change in `src/rules/manual.ts` and `src/cli.ts`).
5. `test/cta.test.ts` (end-to-end `--stdio` case) hit its 60 s timeout on this machine when run with other files. It passes alone with `--testTimeout=240000`. It does not use listing inputs, so the timeout is load, not P6.

## Proposed CHANGELOG lines (1.0.1)

### Fixed
- Listing checklist: a manual item (MAN-002, MAN-015 to MAN-024) is dropped or shortened only when the LST rules that cover it ran and found the listing object. An MCP configuration alone, a manifest that does not parse or has no interface, and a listing-only run (for the `tools_triggered` part of MAN-020) keep the item.
- `--plugin-dir` and `--openai-manifest` given as a symbolic link are followed once, instead of failing with "is not a directory" or "is a symbolic link". Links inside the package are still not followed.
- An icon given as a URL or a `../` path is reported once, as an LST-021 warning; a `.gif` icon once, as an LST-021 error. LST-027 no longer repeats either. A screenshot that is not a `./` path inside the package is a warning (LST-028).
- This tool's own read caps (64 MiB per image, 1 MiB per manifest or MCP configuration) are warnings saying the file was not checked, not directory errors. An oversized icon gets only the 5 MiB error.
- SVG icons are recognised by their root element after the XML declaration, comments and doctype, however long the prologue is. An `<svg>` tag inside a comment no longer sets the size.
- A string `mcpServers` path in the ChatGPT manifest is the only MCP configuration read. A missing path, or one outside the package, is reported (LST-024 warning) instead of silently falling back to `mcp.json`.

### Security
- Listing files (plugin.json, .mcp.json, README, package-manager configs, a declared mcpServers file) are no longer read through a linked folder that leads out of the plugin folder or package. Before, such a file was parsed and its server names and URLs could appear in findings and in the `--verbose` dump.
- The `--verbose` listing dump redacts every credential-named key the report redaction knows (`privateKey`, `x-auth`, …), and the values of credential flags in `args` (`--api-key <value>`, `--auth=<value>`, `Authorization: …`).

### Changed
- The `--verbose` `[listing]` dump is printed as indented JSON over several lines (needs the `src/cli.ts` change in integrator note 1).

## Proposed spec paragraph (docs/design/spec.md, listing inputs)

> The path given to `--plugin-dir` or `--openai-manifest` is resolved once (it may be a link). Inside the folder or
> package no link is followed: neither a linked file nor a linked folder on the way. A file whose real path leaves the
> root is not read and is reported at warning level as not checked. A manual checklist item covered by LST rules is
> dropped only when each covering rule ran and found the listing object it reads; otherwise the item stays, or keeps
> the part of the rule that did not run. This tool's read caps (1 MiB JSON, 64 MiB images) produce warnings, never
> errors. A string `mcpServers` in the manifest names the only MCP configuration that is read.

## Tests run

- `npm run typecheck`: pass. `npm run build`: pass.
- `npx vitest run test/r3-p6-listings.test.ts`: 21 passed (on 5c521cb: 20 failed, 1 passed).
- `npx vitest run test/rules/listing.test.ts test/unit-manual.test.ts test/p6-listing-offline.test.ts test/remediation-w6b-listing.test.ts test/remediation-w6f-listing-cli.test.ts test/remediation-w6h-review-fixes.test.ts test/r3-p6-listings.test.ts`: 120 passed. One message was reworded so that `remediation-w6b` still matches without edits.
- `npx vitest run test/cta.test.ts test/report.test.ts test/sarif.test.ts test/root-causes.test.ts test/redact.test.ts test/incomplete.test.ts test/remediation-wp9-report-redact.test.ts test/remediation-wp7-auth-spec-srv.test.ts test/p5b-docs.test.ts`: 159 of 163 passed. The 4 failures were `--stdio`/HTTP end-to-end timeouts under parallel load. Rerun with `--no-file-parallelism`: incomplete and sarif pass, cta passes with `--testTimeout=240000` (3/3). None of them uses listing inputs.

## Review fixes

Fixes for the adversarial review of this branch (`.claude/review-r3/p6-review.json`). Only `src/listing/**`,
`src/rules/listing.ts` and `test/r3-p6-listings.test.ts` were changed. No error was added and no severity was raised
against 1.0.0. Each new test failed before its fix and passes after it (the A06-08 contract test is the exception, see below).

| Finding | Fix | Commit | Test (`test/r3-p6-listings.test.ts`) |
|---|---|---|---|
| HIGH, A06-04 moves the package root when `.codex-plugin`/`.agent-plugin` or `plugin.json` is a link | `loadOpenAiManifest` now takes the root from the path the user gave: `realRoot = realpath(packageRoot(given))`. Only the named manifest is followed to its real path. The declared `mcpServers` file, `mcp.json`/`.mcp.json`, the root listing and the icons are still read inside `realRoot` with the A06-03 guard. With `.codex-plugin -> meta` and `.codex-plugin -> ../shared/manifest` the result is the same as on 1.0.0 again: no LST-027, no LST-024, exit 0. | a456f13 | `A06-04 review …` (4 tests: link inside, link to `../shared`, linked `plugin.json`, the A06-03 guard still refuses icons through `assets -> ../elsewhere/assets`) |
| MEDIUM, A06-07 dump misses `--header=Name: value` | `dumpArray` removes a leading `--flag=` before it checks for a `Name: value` header, as `argvSecrets` does (`--header=Authorization: [redacted]`, `--header=X-Api-Key: [redacted]`). It also masks a known-format token anywhere in an element (`--keys=ghp_…`, up to three dot pieces for a JWT), with the same scan as `argvSecrets`. Plain `--mode=fast` and `mcp-remote@1.2.3` are kept. | 89e2332 | `A06-07 review …` |
| LOW, LST-027 says "behind a symbolic link" for `.//etc/logo.png` | New `refLeavesPackage()` in `src/rules/listing.ts` uses the same test as `examineImage`: a scheme, a leading `/` or `\` after `./`, or `..` split on `[\\/]`. When the ref itself leaves the package, LST-027 says "is not a ./ path inside the package, so it was not read" (warning). This covers icons that LST-021's own test misses (`.//etc/x.png`, `./..\x.png`) and screenshots. The "behind a symbolic link" text is kept only for a `./` ref whose real path leaves the package. | f1c8903 | `A06-05 review …` |
| MEDIUM, A06-08 not wired end to end | `src/cli.ts` was not edited (it is the integrator's). The exported signature is `listingDump(l: Listing, esc: (s: string) => string = (s) => s): string` in `src/listing/index.ts` (re-exported from `src/listing/index.js`). A contract test calls `listingDump(snap.listing, visibleText)` with the real `visibleText` from `src/report/index.ts`. It checks the call type-checks, the output has several lines with no `\u{A}`, and a U+202E in the manifest still comes out as `\u{202E}`. It passes before and after, because it checks the interface, not a behaviour change. | 8b7f5e9 | `A06-08 review …` |

Behaviour change to note: a linked `plugin.json` (for example `dir/plugin.json -> other/pkg/plugin.json`) now uses
`dir` as the package root, not the link target's folder. 1.0.0 refused such a file ("is a symbolic link"), so this adds
no error against 1.0.0. The earlier A06-04 test was changed to put the package's assets next to the link.

Integrator step (unchanged): in `src/cli.ts` line 548 replace
`visibleText(JSON.stringify(describeListing(snap.listing), null, 2))` with `listingDump(snap.listing, visibleText)`,
import `listingDump` from `./listing/index.js`, and add an end-to-end `--verbose` assertion that the line after
`[listing]` is `{`, not `{\u{A}  "plugin": …`.

Verification: `npm run typecheck` pass, `npm run build` pass,
`MCP_REVIEW_CHECK_SKIP_BUILD=1 npx vitest run test/rules/listing.test.ts test/unit-manual.test.ts test/p6-listing-offline.test.ts test/remediation-w6b-listing.test.ts test/remediation-w6f-listing-cli.test.ts test/remediation-w6h-review-fixes.test.ts test/r3-p6-listings.test.ts test/redact.test.ts`:
8 files, 150 tests passed.
