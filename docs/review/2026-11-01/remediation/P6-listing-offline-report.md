# P6-listing-offline report (0.6.0)

## Done
1. Listing-only run: `--plugin-dir` and/or `--openai-manifest` without `<url>`/`--stdio` (or config `pluginDir`/`openaiManifest` without url/stdio) checks only the files. New snapshot target kind `{ kind: 'listing' }` (additive); nothing connects. Rules without a listing need, and every server need (tools, http, auth, active ...), are skipped with `no server target (listing-only run)` (`LISTING_ONLY_REASON`), never passed; LST-015/025/026 cross-checks are skipped the same way. Text, markdown, JSON (`server.listingOnly: true`, no url/command; `summary.score` null), SARIF and JUnit say "listing-only"; exit code follows `--fail-on`. `--bearer/--header/--env/--cwd/--active/--active-auth/--tool-args` without a target are usage errors (exit 2).
2. Image sizes: `src/listing/image.ts` reads PNG (IHDR), JPEG (SOF), WebP (VP8/VP8L/VP8X) and SVG (width/height in px or unitless, else viewBox) headers without dependencies, by signature rather than extension. Bounded: 256 KiB read per file, files over 64 MiB not opened, 32 images per package, `./` paths inside the package only, links and `..`/absolute/URL refs not read. Unreadable cases are deterministic `problem` codes (missing, link, outside, not-file, too-large, unreadable, unknown-format, no-dimensions) on `openai.images`.
   - LST-027 (error): icons logo/logoDark/composerIcon/composerIconDark square, 48-4096 px, at most 5 MiB (MAN-019); a missing or unrecognised file is an error, a recognised file whose header cannot be parsed is a warning, an SVG without numeric size is info.
   - LST-028 (error): screenshots PNG or JPEG, exactly 706 px wide, 400-860 px tall (MAN-024); more screenshots than starter prompts is a warning. Sources: https://developers.openai.com/plugins/deploy/submission and https://developers.openai.com/plugins/deploy/submission-errors. The numbers come from the W6B verified facts and the MAN-019/MAN-024 texts; not re-fetched online (token budget).
   - Manual checklist: MAN-019 is dropped with `--openai-manifest`; MAN-024 keeps "Screenshots are optional and allowed only with custom UI (the rest is checked by LST-028)".
3. `--verbose` prints `[listing]` (parsed listing as JSON) to stderr: manifests and MCP config with values under headers/env/secret/token/password/authorization/api-key/credential/cookie/reviewer_instructions keys replaced by `[redacted]`, URLs through `displayUrl`, README by length, file lists by count; then the report redactor scrubs stderr.

## Files
Changed: `src/cli.ts`, `src/snapshot.ts`, `src/listing/{index,load,types}.ts`, `src/rules/{listing,engine}.ts`, `src/report/{index,json,markdown,text}.ts` (target label and listing-only wording; outside the owned list but required by the new target kind), `schema/report.schema.json` (`server.listingOnly`), `docs/RULES.md` (regenerated), `test/catalog.test.ts` (LST range 28). New: `src/listing/image.ts`, `test/p6-listing-offline.test.ts`, `test/fixtures/listing/openai-valid/assets/{icon,logo}.png` (64x64).
Existing tests adjusted for the new behaviour: `test/remediation-w6b-listing.test.ts` (invalid package also trips LST-027; MAN-019 now dropped), `test/remediation-w6f-listing-cli.test.ts` (no target is now a listing-only run), `test/rules/listing.test.ts` (pos/neg for LST-027/028).

## Deferred
- `--save-baseline` in a listing-only run is not specially handled (it works on an empty tool list).
- Claude plugin `icon` (no vendor size limit stated) and MAN-005 carousel screenshots (portal upload) are not measured.
- External resources referenced from an SVG are not followed.

## Tests
- `npm run typecheck`, `npm run build`: pass.
- `npx vitest run test/p6-*.test.ts test/remediation-w6b-*.test.ts test/remediation-w6f-*.test.ts test/rules/listing.test.ts test/catalog.test.ts test/docs.test.ts`: 6 files, 85 tests passed.
- Also `test/engine.test.ts test/report.test.ts test/remediation-w5a-json-output.test.ts test/remediation-w6a-schema.test.ts test/remediation-wp9-report-redact.test.ts`: 5 files, 75 tests passed.
- `npm run readme:rules` was run; the README.md and docs/design/spec.md changes were reverted (not owned). The integrator must run `npm run build && npm run readme:rules` after merging (RULE_COUNT 178).

## Proposed CHANGELOG lines (0.6.0)
### Added
- Listing-only runs: `--plugin-dir` and `--openai-manifest` (or the config keys `pluginDir`/`openaiManifest`) work without a `<url>` or `--stdio` target and check only the files, before deploy. Rules that need a server are skipped with "no server target (listing-only run)"; reports say "listing-only"; JSON has `server.listingOnly` and a null score.
- LST-027 (icon size: square, 48-4096 px, at most 5 MiB) and LST-028 (screenshots: PNG/JPEG, 706 px wide, 400-860 px tall), reading PNG, JPEG, WebP and SVG headers without dependencies; they automate MAN-019 and part of MAN-024.
- `--verbose` prints the parsed listing (header, env and credential values removed) to stderr.
### Changed
- With `--openai-manifest` the manual checklist drops MAN-019 and shortens MAN-024.
- `--plugin-dir`/`--openai-manifest` without a target no longer exit 2 ("give exactly one of ...").

## README / --help text not placed
README, section "Listing and plugin manifests" (replace the "needs a server target" wording):
> Without a `<url>` or `--stdio`, `--plugin-dir` and `--openai-manifest` run a listing-only check: nothing connects, rules that need a server are skipped ("no server target (listing-only run)"), and the report says listing-only. Use it before deploy; add the server target later to cross-check `tools_triggered` and the server URL. Icons and screenshots named in the ChatGPT manifest are measured from their file headers (LST-027, LST-028).

`--help` for both flags is already updated in `src/cli.ts`.

## Proposed spec paragraph
**§2.x Listing-only run.** With a listing input and no server target the snapshot target is `{ kind: 'listing' }`. The engine skips every rule without a `plugin-dir`/`openai-manifest` need, and every server need, with the reason "no server target (listing-only run)"; the score is null and the verdicts follow the findings. **Image sizes.** The loader reads at most 256 KiB of each image named in the package manifest (PNG IHDR, JPEG SOF, WebP VP8/VP8L/VP8X, SVG width/height or viewBox), never follows links, and records `problem` codes for what cannot be measured; LST-027 and LST-028 judge the sizes (MAN-019, MAN-024).
