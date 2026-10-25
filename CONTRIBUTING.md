# Contributing

Thanks for helping. The most useful contributions are **false-positive reports** with a JSON report attached, **rejections the tool did not predict**, and new rules backed by a public source. Please use the [issue templates](https://github.com/alisaosipova/mcp-review-check/issues/new/choose).

## Setup

Node 20.19 or newer.

```bash
npm install
npm run build        # tsc -> dist/, adds the CLI shebang
npm run typecheck    # tsc --noEmit over src/ and test/ (CI runs this)
npm test             # vitest; builds dist/ first because e2e tests spawn the CLI
node dist/cli.js --stdio "node test/fixtures/good-server.mjs"
```

`MCP_REVIEW_CHECK_LIVE=1 npm test` adds smoke tests against public servers; they are not part of CI. `MCP_REVIEW_CHECK_SKIP_BUILD=1` skips the build in the vitest global setup when `dist/` is already fresh.

CI (`.github/workflows/ci.yml`) runs build, typecheck and tests on Node 20.19, 22 and 24 on Linux, macOS and Windows, checks that `docs/RULES.md` and the catalog date in the README are regenerated, and packs and smoke-tests the tarball.

## Ground rules for rules

- **Every rule cites a public source.** A directory's published review criteria, policy, submission guide or the MCP specification. Put the most specific URL first in `sources`; it becomes the `docs` link and the SARIF `helpUri`.
- **Severity principle.** `error` only when the source states a MUST or a rejection criterion *and* detection is deterministic. Heuristics (word lists, regexes, shape guesses) are at most `warning`; use `info` for advice.
- **Severity is per platform.** `severity: { claude: 'error', chatgpt: 'warning' }`: the keys are the platforms the rule applies to (`claude`, `chatgpt`, `spec`). Do not add a platform whose documents do not support the rule.
- **Rule IDs are never reused.** New IDs take the next free number in their category. A retired rule keeps its ID in the frozen list in `test/catalog.test.ts`.
- **Stability policy.** New rules and severity increases ship only in a minor release; a false-positive fix or a severity decrease may ship in a patch. Note the change in [CHANGELOG.md](CHANGELOG.md) under the matching heading.
- **Read-only by default.** A rule reads the snapshot; it never makes requests. A new probe that sends traffic must be listed in the README section "What the tool sends" and in [SECURITY.md](SECURITY.md), and anything that may change state must be opt-in behind `--active` or `--active-auth`.
- **No LLM calls, no telemetry.** Findings must be reproducible offline from the same snapshot.

## How to add a rule

1. **Pick the file and ID.** Rules live in `src/rules/<category>.ts` (`server`, `spec`, `tools`, `annotations`, `schema`, `injection`, `data`, `policy`, `apps`, `auth`, `runtime`). Take the next free ID for the category (for example `TOOL-033`).

2. **Write the rule** with `defineRule(meta, check)`. `check` is a small pure function from the `Snapshot` to findings; helpers live in `src/rules/util/`.

   ```ts
   export const TOOL_033 = defineRule(
     {
       id: 'TOOL-033', title: 'Short title (heuristic)', severity: { chatgpt: 'warning' }, needs: ['tools'],
       rationale: 'Why the directory cares, in one sentence, paraphrasing the source.',
       fix: 'What to change, concretely.',
       sources: ['https://developers.openai.com/...'],
     },
     (snap) => snap.tools.flatMap((t): RawFinding[] => (isBad(t) ? [{ tool: toolName(t), message: 'what is wrong, with the offending value' }] : [])),
   );
   ```

   - `needs` lists what the rule requires (`tools`, `resources`, `prompts`, `ui`, `http`, `stdio`, `auth`, `legacy`, `modern`, `active`, `active-auth`). The engine skips the rule, with a reason, when a need is not met; do not re-check those conditions inside `check`.
   - A finding may lower its own severity (`severity: 'info'`) or narrow `platforms` for a weaker signal. Quote the evidence with `snippet()` so long descriptions stay readable.

3. **Register it** in the category's exported array at the bottom of the file (for example `toolRules`). The catalog in `src/rules/index.ts` picks it up.

4. **Test it.** In `test/rules/<category>.test.ts`, add a case with at least one positive snapshot (`pos`, must produce a finding) and one negative snapshot (`neg`, must be clean). The negative case must be a realistic near miss (wording a legitimate server uses), not an empty snapshot. Heuristic rules also need negative cases for the false positives you know about, such as the documented guards in the existing tests. The "has a case for every rule" test fails until you do. Add the ID to the frozen list in `test/catalog.test.ts`. If the BAD fixture (`test/fixtures/bad-server.mjs`) should trigger it, update `BAD_STDIO_RULES` in `test/e2e-stdio.test.ts`.

5. **Regenerate the docs**: `npm run build && npm run readme:rules` rewrites the rule table in [docs/RULES.md](docs/RULES.md) and the catalog date in `docs/RULES.md` and the README. The table comes from the same generator as `mcp-review-check --list-rules --format markdown` (`rulesMarkdown` in `src/explain.ts`), and `test/docs.test.ts` and CI fail if you forget.

6. **Update the catalog date** in `src/catalog.ts` when the change reflects documentation newer than the current date, then run `npm run readme:rules` again.

7. **Add a CHANGELOG entry** under `## [Unreleased]`.

## Reporting a false positive

Run the check with `--format json --output report.json`, remove anything private, and attach the relevant findings to a [False positive](https://github.com/alisaosipova/mcp-review-check/issues/new?template=false-positive.yml) issue. Tell us whether the server is already listed in a directory; a false positive on a listed server is treated as a bug with priority. A fix for a false positive on a public no-auth server should freeze its listing as a regression fixture (`node scripts/capture-real.mjs <name> <url>` writes `test/fixtures/real/<name>.json`) and add an assertion to `test/real-servers.test.ts`.

## Pull requests

- Keep changes focused and match the existing style: small pure rule functions, short comments that explain why.
- `npm run build && npm run typecheck && npm test` must pass.
- Do not commit `dist/`; the package is built by `prepack` and published from CI with npm provenance.

## Releasing (maintainers)

1. Move the `## [Unreleased]` entries in CHANGELOG.md under the new version and date. New rules or raised severities mean a minor bump (see the stability policy).
2. `npm version <patch|minor> --no-git-tag-version`, commit, then tag `vX.Y.Z` and push the tag.
3. `.github/workflows/release.yml` checks that the tag matches `package.json`, builds, tests and publishes with `npm publish` through npm trusted publishing (OIDC, with provenance), then creates the GitHub release. Never publish from a laptop: provenance needs CI, and trusted publishing needs npm 11.5.1+.

One-time setup: on npmjs.com, add a trusted publisher for this repository with workflow `release.yml` and environment `npm`. npm only allows this once the package exists, so the very first tag needs a short-lived granular token in the `NPM_TOKEN` repository secret; delete it after configuring the trusted publisher.

By contributing you agree that your contributions are licensed under the MIT license of this project.
