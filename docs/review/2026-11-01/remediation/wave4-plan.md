# Wave 4 — close the deferred items with default decisions and release 0.2.0

Written 2026-11-01 after the user asked to finish what was left "with the default options" and to release to npm.
Decisions below are the defaults taken for each open question; the maintainer can revisit any of them in a later minor.

## Decisions (spec §8 Q5–Q8 and REMEDIATION §6)

| Item | Decision | Rationale |
|---|---|---|
| F011 / Q5 | **Exit 4** when `limits.stopped && !fatal` (run cut off by `--max-duration`). Ships in 0.2.0 (minor), documented in `--help`, README Exit codes, spec §3.2. | CI must tell "too slow" from "unreachable"; a minor release may change the contract. |
| R013 / Q6 | **Opt-in** `--fail-on-incomplete`: exit 3 when the check is partial (`auth-required`, `token-rejected`, stopped). Without the flag the exit code still follows `--fail-on`. The GitHub reporter always emits a `::warning::` annotation for a partial check. | Default stays backwards compatible; the annotation makes a green job with skipped checks visible. |
| F122 / Q7 | Keep (a): SARIF level = highest severity over all platforms. No option. | Spec §5.3 already defines it; arbiter called it a format inconsistency, not a contract break. |
| F102 / Q8 | Keep (a): APPS-013 scoped to `openExternal` / `ui/open-link`. | Not verified that ChatGPT gates plain anchors. |
| F151 | Keep `engines.node >=20.19`; matrix unchanged (20.19 on Linux only). Revisit in 0.3.0. | Raising engines drops users for no functional gain in this release. |
| F150 | Stay CLI-only. Add `exports` that exposes only `./package.json`, so deep imports of `dist/*` are not an accidental public API. Keep `bin`; drop `main`. | README already states "no programmatic API yet". |
| F153 | Leave the 0.1.0 section as is. | Released sections are immutable. |
| F148 | 0.1.0 **is** published on npm (`npm view mcp-review-check version` → 0.1.0 on 2026-11-01). Reword README line about "before its first npm release" to keep only the offline case. | Verified. |
| Catalog date | Keep `CATALOG_DATE` 2026-10-22: no new source documents were read; rule changes come from code fixes. | Date means "sources as of". |
| F081 | Keep the global `seen` set in `walkSchema`. | Per-stack dedup duplicates findings and risks exponential walks. |
| F077 part 1 | Keep the `url` token in TOOL-015. | Drops true positives otherwise. |
| F131 | Keep one annotation per finding; the step-summary size guard is enough. | Documented contract; tests rely on it. |
| F036 | Minimal variant only: scrub `text.slice(0, SNIPPET + maxSecretLen)` for the snippet; the snapshot model is unchanged. | Full retention change alters connect/probe/rules. |
| F146 | Lite variant: apply existing caps (`capStrings`) to `active.calls`, `modernResults`, `rawPages`; record in `snap.limits.truncated`. No new global budget. | A global byte budget is a design change. |
| F168 | Do the two P0 items: composite `action.yml` (runs the CLI, writes SARIF, optional upload) and `--baseline <report.json>` (suppress findings present in a previous JSON report, report new ones). Config file, `--listing`, `--format junit`, `--oauth` stay on the MARKET.md roadmap. | MARKET.md priority. |
| F159 rest | Move `npm audit` out of PR CI into a scheduled workflow (weekly) and keep it on `main` pushes. No linter introduced in this release. | A linter over 8k LOC is its own change. |
| F145 rest | After `npm publish`, verify provenance: `npm view <name>@<version> --json` must list `dist.attestations`; fail the job otherwise. Keep the `NPM_TOKEN` first-release branch (cannot verify from here whether the trusted publisher is configured). | — |
| F156 | Measure coverage once, set `coverage.thresholds` 5 points below the measured lines/functions/statements/branches, enforce in `test:coverage` only (not in `npm test`). | Guards regressions without flaking CI. |
| F024 / R010 | `collectErrors` records an `ObservedError` for a successful modern response whose id differs (`idMismatch`); SPEC-016 skips the code check for that record and reports the mismatch. | — |
| R003 rest | Partial results survive `--max-duration`: `runActive` / `runWireProbes` publish into an accumulator on `Progress`; the engine marks rules whose phase did not finish as `skipped` with reason `stopped by --max-duration`. | — |
| spec-sync | `docs/design/spec.md` updated for every behaviour change of waves 1–4 (exit codes, new rules, baseline, `--fail-on-incomplete`, Q5–Q8 answered). Done by the docs step after integration. | — |
| F076 | New rule `TOOL-033` (claude: error, chatgpt: error): tool name must match `^[A-Za-z0-9_-]{1,64}$`; sources are the Anthropic tool-use and OpenAI function-calling docs (verify the pattern online before writing it). TOOL-002 gains a chatgpt variant. | Both vendor APIs reject other names deterministically → error is allowed by the severity principle. |
| F080 | New info rule `TOOL-034` "tool list budget": more than 40 tools or `JSON.stringify(tools)` over 64 KiB. Thresholds in `src/limits.ts`. | — |
| F079 rest | New info rule `TOOL-035` schema lint: `required` naming properties that do not exist (unless `additionalProperties`/`patternProperties`), keyword typos at Levenshtein distance 1 of known keywords, unknown `format`. Also run TOOL-020 over `outputSchema` if not yet. | — |

## Packages (disjoint files; worktree per package; model opus)

| Package | Owns | Items |
|---|---|---|
| W4A-cli | `src/cli.ts`, `src/baseline.ts` (new), `src/report/github.ts`, `package.json` (exports/main only), `README.md`, `test/remediation-w4a-*.test.ts` | F011, R013, F148, F150, F168-baseline |
| W4B-rules | `src/rules/tools.ts`, `src/rules/schema.ts`, new rule modules, `src/rules/index.ts` registration, `src/limits.ts`, `docs/RULES.md` (regenerated), `test/remediation-w4b-*.test.ts` | F076, F080, F079-rest |
| W4C-connect | `src/connect.ts`, `src/probe/active.ts`, `src/probe/wire.ts`, `src/rules/engine.ts`, `src/rules/spec.ts`, `src/protocol/trace.ts`, `src/protocol/modern.ts`, `src/snapshot.ts`, `test/remediation-w4c-*.test.ts` | F024/R010, R003-rest, F146-lite, F036-lite |
| W4D-ci | `.github/**`, `action.yml` (new), `vitest.config.ts`, `CONTRIBUTING.md`, `test/remediation-w4d-*.test.ts` | F145-rest, F159-rest, F156, F168-action |
| W4E-docs (after integration) | `CHANGELOG.md`, `docs/design/spec.md`, README cross-check, `docs/review/2026-11-01/REMEDIATION.md` §8 | spec-sync, Q5–Q8 answers, CHANGELOG lines from the four reports |

Rules for implementers: as REMEDIATION §3, plus: do **not** edit `CHANGELOG.md` or `docs/design/spec.md`; write the proposed CHANGELOG lines and the spec paragraphs into your report `docs/review/2026-11-01/remediation/W4?-report.md`. W4B regenerates README counts with `npm run readme:rules`; nobody else touches README except W4A.

## Release

0.2.0 (minor: new rules, raised severities, exit-code change). Steps per CONTRIBUTING.md: move `[Unreleased]` → `## [0.2.0] - 2026-11-01`, `npm version minor --no-git-tag-version`, `npm run build && npm run readme:rules`, commit, tag `v0.2.0`, push `main` and the tag (plain pushes). `release.yml` publishes through trusted publishing or the `NPM_TOKEN` first-release step.
