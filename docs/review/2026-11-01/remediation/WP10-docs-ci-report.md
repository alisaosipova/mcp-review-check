# WP10-docs-ci: remediation report

Branch `worktree-wf_1bdb1e6c-787-1`, owned files `README.md`, `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `.github/**`, `scripts/*.mjs`, `package.json` (and its lockfile), `tsconfig*.json`, `vitest.config.ts`, `.gitignore`, `test/pack.test.ts`, `docs/design/spec.md`, `docs/RULES.md`. Base: `main` with the nine wave-1 packages merged (cdfd53f).

Checks run: `npm ci`, `npm run typecheck`, `npm run build` (green before and after), `npm run readme:rules` (no diff after the last commit), `npx vitest run test/docs.test.ts test/catalog.test.ts test/catalog-stale.test.ts test/pack.test.ts test/workflows.test.ts` (5 files, 18 tests, all green), `npx vitest run --coverage test/catalog.test.ts` (the coverage provider loads), `python3 -c 'import yaml'` parse of `ci.yml`, `release.yml`, `dependabot.yml`. The full suite was not run (D1).

## Done

| Id | Commit | What changed |
|---|---|---|
| F152 | bd18ea5, 69d896c | `docs/RULES.md` regenerated (APPS-006 now lists `claude: info`, from WP5). `scripts/rules-table.mjs --write` fills `<!-- RULE_COUNT -->` and `<!-- MANUAL_COUNT -->` spans from `RULES.length` / `MANUAL_ITEMS.length` and the `CATALOG_DATE` span, in README and `docs/design/spec.md` too (README line 7, spec header). The CI docs step diffs `docs/design/spec.md` as well, so a new rule without regeneration fails CI. Checked by setting the README count to 999: the script restores 144. |
| F164 | 69d896c | The example report header gets the version from `package.json` as well as the catalog date; the success message names every file it rewrites. CONTRIBUTING's release steps run `npm run readme:rules` after `npm version`. |
| F148 | 280ef3a | README: the "not published to npm yet" sentence is replaced by "if `npx` cannot find the package … run from a checkout", and it covers the `npx -y mcp-review-check@0.1` lines in CI recipes and Docker Compose. CHANGELOG 0.1.0 ("First public release") was not touched (task rule). |
| F149 | 280ef3a | README (`--active` option row, "What the tool sends") and SECURITY.md ("With `--active`") list: at most the first 50 qualifying tools, the 3 call kinds, the duplicate-name rule, the write-verb exclusion, and the up to three fresh connections with `clientInfo.name` `mcp-review-check` / `claude-ai` / `Anthropic` (RT-012). Also added the wave-1 traffic changes: session `DELETE`s (F030 and the SDK sessions), GET Origin probes on legacy SSE (R009), same-host redirect following (F019). |
| F138-docs (wave 1) | 280ef3a | README "Input caps" and a SECURITY.md threat-model bullet: 64 MiB per HTTP body (per SSE event), 64 MiB and 100 pages per listing, 64 MiB per stdio message, 50 UI resources, 50 stray stdout lines, 1 MB for identifiers. |
| R006 | 280ef3a | README exit-code table: `128+N` row (130/143/131/129, Windows sets the same code, no report written), verified against `src/cli.ts` signal handling. `--help` part deferred (needs `src/cli.ts`). |
| R019 | 280ef3a | README exit-code table and FAQ: exit 3 also for an unexpected internal error (`fatal:` and stack). `--help` part deferred (needs `src/cli.ts`). |
| R020 | 280ef3a | README `--ignore` option row, score paragraph and FAQ: ignored rules are left out of the score and root-cause count; compare scores only with the same `--ignore` list. |
| F150 (partial) | 280ef3a | README states the package is CLI-only with no supported programmatic API. A real API is deferred (see below). |
| WP9 notes | 280ef3a | README Redaction: common `--env` settings not masked (F118), Cookie pairs and decoded Basic (F116/F117); score paragraph names `summary.rootCauses` (F129); new "Server text in reports" paragraph on `\u{..}` (F115/F147). |
| F155 | c47fca2 | `tsconfig.json` `lib: ["ES2022"]` (DOM and DOM.Iterable removed); `npm run typecheck` and `npm run build` pass without them. |
| F034-spec (wave 1) | ba4165e | spec §4.4 renamed "Node compatibility", with the current facts (engines `>=20.19`, vitest 4, `@types/node` 20, no DOM lib, CI publishing) above the historical Node 18 plan; §0 intro says Node 20.19+. |
| F061 (wave 1) | ba4165e | spec §2.8 AUTH-002: legacy discovery is chatgpt error, spec warning, claude warning; no discovery is info pointing to AUTH-004; unquoted `resource_metadata` gets a spec warning (WP7). |
| WP3 notes | ba4165e | spec §2.9: argument synthesis follows format/length/bounds/minItems/nested required/anyOf/oneOf/`$ref`, wrong-type value outside every allowed type, duplicate names; RT-002 covers the invalid-missing call. §4.3: close-session DELETE row, legacy SSE Origin mode, same-host redirect, reuse of the SDK GET. Spec header points to CHANGELOG for the other narrowed patterns. |
| F011, R013, F122, F102 (wave 1) | ba4165e | Not implemented: written down as spec §8 Q5–Q8 and listed under Open questions below. spec §3.2 updated to the current exit-code contract (max-duration, internal error, 128+N, token-rejected follows `--fail-on`). |
| F158 | c135c58 | `test/pack.test.ts`: `describe.skipIf(!existsSync(join(ROOT, '.git')))`, as `repo-config.test.ts`. |
| F166 | 4bc5e7e | `.gitignore`: `*.tgz`. |
| F159 | c2759f7 | `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`; `npm audit` step has `continue-on-error` on pull requests only (main still fails). The linter part is deferred. |
| F145 | c2759f7 | `npm ci --ignore-scripts` in both CI jobs and the release build job (only esbuild and fsevents have install scripts; locally npm 11 already skipped them and vitest ran). The token part: see F160. |
| F160 | c2759f7 | The publish job computes `HAS_NPM_TOKEN: ${{ secrets.NPM_TOKEN != '' }}` (a boolean, never the value). Two steps: without the secret, `npm publish` runs with no `NODE_AUTH_TOKEN` in the step env (npm's documented trusted-publishing setup); with it, a separate step publishes with the token and prints a `::warning::` to delete it. `test/workflows.test.ts` passes (no install/test/build in the write jobs). Not verifiable offline: whether npm prefers OIDC over the placeholder token `setup-node` writes when `registry-url` is set; this matches npm's own example. |
| F151 (partial) | c2759f7 | CI matrix: Node 20.19 (EOL 2026-04-30) on ubuntu only via `exclude`, 22 and 24 on every OS (7 jobs instead of 9). CONTRIBUTING and spec §4.4 updated. Raising `engines` is an open question. |
| F156 (partial) | 5ec37ed | `@vitest/coverage-v8@^4.1.12` (dev), `coverage` block in `vitest.config.ts` (`include: ['src/**/*.ts']`, text-summary/html/lcov into the ignored `coverage/`), `npm run test:coverage`, README Development line. A comment says that spawned `dist/cli.js` runs are not counted. |
| F153 | 1263774 | `[Unreleased]` and `[0.1.0]` link definitions at the end of CHANGELOG.md. Rewriting the 0.1.0 "Changed" section is not done (task rule: 0.1.0 is not changed); see Open questions. |
| CHANGELOG | 1263774 | `## [Unreleased]` built from the "CHANGELOG lines" of WP1–WP9 plus WP10: Added (with **Severity raised**), Changed, Fixed (with **Severity lowered / false positives fixed**), Security; 128 one-sentence entries, duplicates merged (SRV-010 WP4/WP7, session DELETE WP2/WP3, redirect WP3, usage errors WP1), no finding IDs. A lead line says the release adds findings and so is a minor release. |

## Deferred

| Id | Reason |
|---|---|
| F168 | feature: market features, each its own minor release (MARKET.md): `action.yml` (composite, npx + SARIF upload; needs `test/docs.test.ts`, which forbids `upload-sarif` in README), `--baseline report.json`, `.mcp-review-check.json` config file, `--listing`/`--plugin` manifest lint (spec §8 Q3), `--format junit`, `--oauth` helper, MCP Registry `server.json` validation. |
| F156 (rest) | needs test/*: unit tests for `protocol/legacy.ts` (listAll caps), `rules/manual.ts`, `probe/wire.ts` with a mocked fetch, `catalog.ts`, `rules/lexicon.ts`, `rules/util/{ui,access}.ts`. Coverage thresholds and a CI coverage artifact need a full-suite run to calibrate (D1 forbids it here). |
| F150 (rest) | feature: a library entry point (`src/index.ts` exporting runCli, buildSnapshot, runRules, RULES, buildReport, renderers), `declaration: true`, `exports`/`types` in package.json; needs src/index.ts and a maintainer decision (see Open questions). `main` still points at `dist/cli.js`. |
| F151 (rest) | Raising `engines` to `>=22.12`, `@types/node` 22 and dropping the dependabot ignore changes the support contract; maintainer decision for 0.2.0 (Open questions). |
| F159 (rest) | feature: a linter/formatter (biome or eslint) with `npm run lint` in CI touches every source file's style. |
| F145 (rest) | A post-publish provenance check (`npm view … dist.attestations`) can race registry propagation and cannot be tried without a real release. |
| R006, R019 (rest) | needs src/cli.ts: the `Exit codes:` block of `--help` should get the 128+N row and "or an unexpected internal error" for exit 3 (README is done). |
| spec sync (WP5–WP8 notes) | spec §2.4–§2.8 and §2.3/§2.7 quote detection patterns verbatim (INJ-001..009, DATA-001..005, POL-001/002, APPS-001/005/006/015..019, `extractOrigins`, SPEC-001/005/006/010/011/016..018, SRV-006/010/015, AUTH-006/007/012/013/017/020, §1.4/§1.5 helpers, TOOL-004/018/020/026, RT-010/011). Rewriting each is large and the document is marked non-authoritative; its header now says the code and CHANGELOG win. Left for a dedicated spec pass. |
| Catalog date | needs src/catalog.ts: wave 1 changed severities (APPS-006 claude info, AUTH-002/013 info, AUTH-017, DATA-001, INJ-003, SPEC-011, SRV-006) without moving `CATALOG_DATE`; CONTRIBUTING step 6 bumps it only for newer documentation, so it stays unless the maintainer decides otherwise. |

## Open questions

| Id | Question and options |
|---|---|
| F011 | `--max-duration` stop shares exit 3 with "could not connect" and internal errors. (a) keep 3 and rely on `Result: INCOMPLETE (stopped at --max-duration …)` and JSON `limits.stopped`; (b) a new exit 4 for a deadline stop in 0.2.0 (README table, `--help`, spec §3.2, GitHub annotation); (c) an opt-in `--deadline-exit-code <n>`. Recorded as spec §8 Q5. |
| R013 | A rejected token (`token-rejected`) exits by `--fail-on` (often 0) with tool checks skipped. (a) keep, documented; (b) exit 3 always, as an incomplete check; (c) opt-in `--fail-on-incomplete` that turns any `INCOMPLETE` verdict into exit 3, plus a `::warning` annotation (WP9 `src/report/github.ts`). Spec §8 Q6. |
| F122 | SARIF `level` comes from the highest severity over every platform. (a) keep (spec §5.3); (b) the gated platforms' level (a spec-only error becomes `note` without `--fail-on-spec`); (c) `--sarif-level gated|max`, default max. Spec §8 Q7. |
| F102 | Should APPS-013 count every `<a href>` as navigation that needs `redirect_domains`? (a) no, keep `openExternal` / `ui/open-link`; (b) yes, as a chatgpt info first, warning after ChatGPT's anchor gating is verified. Spec §8 Q8. |
| F151 | Node 20 is EOL since 2026-04-30. (a) 0.2.0 raises `engines` to `>=22.12`, `@types/node` 22, matrix 22/24, drops the dependabot ignore (Changed entry); (b) keep `>=20.19` until 0.3.0 with 20.19 tested on Linux only (current state). |
| F150 | Programmatic API. (a) stay CLI-only (README now says so) and later add `exports: {"./package.json": …}` to close deep imports; (b) add `src/index.ts`, `declaration: true`, `exports`/`types` and declare the API in the stability policy. |
| F153 | CHANGELOG 0.1.0 has ~35 "Changed" and severity entries relative to a pre-release baseline. (a) keep as history; (b) fold them into a short 0.1.0 "Added" summary and move the detail to `docs/design`. Not done because this package must not change the 0.1.0 section. |
| F148 | Is 0.1.0 actually on npm? If yes, drop the "if `npx` cannot find the package" sentence; if not, the CHANGELOG's "First public release" for 0.1.0 is premature. |
| Catalog date | Should a release whose rule changes are code fixes (no newer source documents) move `CATALOG_DATE`? CONTRIBUTING step 6 says no today. |
