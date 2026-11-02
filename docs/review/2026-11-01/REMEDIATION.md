# Remediation plan 2026-11-01: fix confirmed findings and apply improvements

> Follows [SPEC.md](SPEC.md) and [FINDINGS.md](FINDINGS.md). Living document: status rows are appended, not rewritten.
> Scope decided by the maintainer: **all 117 confirmed findings and all 77 improvements** (194 work items). Items that turn out to be out of reach in this pass are *deferred with a written reason*, never silently dropped.

## 1. Work breakdown

Items are grouped into packages with **disjoint file ownership**, so packages can be implemented in parallel git worktrees and merged without conflicts. Each package file (`remediation/WP*.json`) lists its items with pointers to the raw finding and the verifier votes.

| Package | Owned files | Items (fixes / improvements) | Medium |
|---|---|---|---|
| WP1-cli | `src/cli.ts`, `src/explain.ts`, `src/version.ts`, `src/catalog.ts`, `test/compat.test.ts` | 20 (13 / 7) | 0 |
| WP2-connect | `src/connect.ts`, `src/limits.ts`, `src/snapshot.ts`, `src/protocol/recording.ts`, `src/diagnose.ts` | 27 (19 / 8) | 4 |
| WP3-probe | `src/probe/*.ts` | 10 (6 / 4) | 5 |
| WP4-protocol | `src/protocol/{trace,modern,legacy,stdioArgs,clientCaps}.ts` | 15 (9 / 6) | 4 |
| WP5-apps | `src/rules/apps.ts`, `src/rules/util/{ui,html,access}.ts` | 19 (12 / 7) | 4 |
| WP6-inj-data-pol | `src/rules/{injection,data,policy,lexicon}.ts` | 20 (17 / 3) | 5 |
| WP7-auth-spec-srv | `src/rules/{auth,spec,server,manual}.ts`, `src/rules/util/{wwwAuth,net}.ts` | 23 (11 / 12) | 7 |
| WP8-tools-schema-rt | `src/rules/{tools,schema,annotations,runtime}.ts`, `src/rules/util/{schemaWalk,text,obs}.ts` | 23 (13 / 10) | 6 |
| WP9-report-redact | `src/report/*.ts`, `src/redact.ts`, `src/rules/{engine,types}.ts` | 19 (9 / 10) | 3 |
| WP10-docs-ci | `README.md`, `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `.github/**`, `scripts/*.mjs`, `package.json`, `tsconfig*.json`, `vitest.config.ts`, `.gitignore`, `test/pack.test.ts`, `docs/design/spec.md`, `docs/RULES.md` | 18 (8 / 10) | 4 |

## 2. Execution order

1. **Wave 1 (parallel):** WP1–WP9, one Opus agent per package, each in its own git worktree and branch `fix/<package>`. Agents edit only owned files. New tests go to `test/remediation-<package>.test.ts` (unique per package) to avoid merge conflicts; existing tests are touched only when a fix changes their expectation. Each agent writes `docs/review/2026-11-01/remediation/<package>-report.md` (done / deferred with reasons / changelog lines) and commits it on its branch.
2. **Merge:** maintainer-side (this session) merges `fix/*` into `main` one by one; `npm run typecheck && npm run build` after each merge.
3. **Wave 2:** WP10-docs-ci on the merged tree: README/SECURITY/CHANGELOG (assemble fragments from all reports under `## [Unreleased]`), regenerate `docs/RULES.md` and the README rule table (`npm run readme:rules`), CI/release workflow items, packaging items.
4. **Verification:** typecheck, build, all `test/remediation-*.test.ts`, the existing test files for touched subsystems. The full suite is run only with the maintainer's go-ahead (D1 in SPEC.md).

## 3. Rules for implementers

- Read the finding JSON and the verifier votes before changing anything; the votes often narrow the real defect and carry a repro.
- Fix the root cause named by the verifiers, not the symptom; keep the project's severity principle (error only for MUST + deterministic detection).
- A fix that needs a file outside the package is **deferred** with reason `needs <file>`; the merge step reassigns it.
- Improvements are applied when local and clearly beneficial. Large features (new CLI modes, new rule families, architectural changes) are **deferred** with reason `feature: <one line>` so the maintainer can schedule them; they are not silently expanded into scope.
- Commit style follows the repo: one imperative sentence stating the behaviour change and why, ending with the finding ids in parentheses, e.g. `(review F064, F065)`, plus the `Co-Authored-By` trailer.
- Do not run the whole vitest suite (D1). Run `npm run typecheck`, `npm run build`, the package's new test file and the existing test files for its subsystem.

## 4. Status log

| When | Event |
|---|---|
| 2026-11-01 | Plan written; `remediation/WP*.json` generated from FINDINGS evidence (194 items, 0 unassigned). Wave 1 launched. |
| 2026-11-01 | Wave 1 finished: 9 agents, 1.8M tokens, 45 min, 0 errors. 165 items done, 30 deferred (see §5). Every branch green on its own (typecheck, build, own tests). |
| 2026-11-01 | Integration: each `worktree-wf_365c0c99-4d0-N` branch rebased onto `main` and fast-forwarded (no merge commits), typecheck + build after each; 126 commits. Two cross-package interactions fixed in one extra commit: WP3's probe "(close session)" DELETEs now excluded from rule evidence like WP2's SDK session ends (F030 vs R012); WP3 test updated for WP8's widened RT-002 (C-imp-3). |
| 2026-11-01 | Push to `origin/main` blocked by GitHub push protection: a WP8 test fixture matched the GitLab token pattern. The 5 affected unpushed commits were rewritten (`rebase --exec` sed) to the repo's `SYNTH` fixture convention; no pushed history touched. Then plain fast-forward push `8b0f41e..cdfd53f`. |
| 2026-11-01 | Wave 2 (WP10-docs-ci) launched on the pushed tree: CHANGELOG assembly from the 9 reports, RULES.md/README regeneration, docs/CI/packaging items, docs-only deferrals from wave 1. |
| 2026-11-01 | Wave 4 (see §8): default decisions in `remediation/wave4-plan.md`, four code packages (W4A–W4D) rebased and fast-forwarded on `main` without conflicts, nine existing tests updated for exit 4 (`21abf35`), docs step W4E (CHANGELOG, spec.md with Q5–Q8 answered, README action recipe and `@0.2` pins, this section). Release 0.2.0 prepared, not yet tagged. |

## 5. Wave 1 results

| Package | Branch | Done | Deferred | Typecheck | Build | Own tests |
|---|---|---|---|---|---|---|
| WP1-cli | `worktree-wf_365c0c99-4d0-1` | 17 | 3 | yes | yes | yes |
| WP2-connect | `worktree-wf_365c0c99-4d0-2` | 25 | 6 | yes | yes | yes |
| WP3-probe | `worktree-wf_365c0c99-4d0-3` | 11 | 2 | yes | yes | yes |
| WP4-protocol | `worktree-wf_365c0c99-4d0-4` | 15 | 7 | yes | yes | yes |
| WP5-apps | `worktree-wf_365c0c99-4d0-5` | 18 | 1 | yes | yes | yes |
| WP6-inj-data-pol | `worktree-wf_365c0c99-4d0-6` | 19 | 1 | yes | yes | yes |
| WP7-auth-spec-srv | `worktree-wf_365c0c99-4d0-7` | 22 | 1 | yes | yes | yes |
| WP8-tools-schema-rt | `worktree-wf_365c0c99-4d0-8` | 21 | 5 | yes | yes | yes |
| WP9-report-redact | `worktree-wf_365c0c99-4d0-9` | 17 | 4 | yes | yes | yes |

Verification on the integrated tree (before push): all `test/remediation-*.test.ts` plus `test/rules/`, `redact`, `engine`, `report`, `sarif`, `catalog`, `limits`, `cli-rules`, `output-modes`: **761 tests, all green after the two interaction fixes**. The full suite was not run (D1).

### 5.1 Deferred items (30) — each needs a decision or another package

| ID | Package | Reason |
|---|---|---|
| F003 | WP1-cli | needs src/connect.ts: правильное исправление — вырезать userinfo из URL до fetch и отправлять его как Authorization: Basic (с редакцией), сохранив urlAsEntered. Usage error в CLI превратил бы намеренные тесты редакции user:pass@ в test/e2e-redaction.test.ts и  |
| F011 | WP1-cli | feature: отдельный exit-код 4 для остановки по --max-duration меняет документированный контракт кодов выхода (spec §3.2, README, --help); нужно решение мейнтейнера и правка docs/design/spec.md и README.md (WP10). |
| R013 | WP1-cli | feature: ненулевой exit-код при token-rejected (или флаг --fail-on-incomplete) меняет контракт кодов выхода, который spec §3.2/§3.4 оставляет открытым; нужно решение мейнтейнера, правка spec.md и README (WP10) и src/report/github.ts для ::warning-аннотации (WP |
| R027 | WP2-connect | needs src/rules/apps.ts: APPS-014 должен учитывать snap.limits.truncated для обрезанного UI-ресурса |
| F146 | WP2-connect | feature: единый байтовый бюджет на snapshot с ранней остановкой при чтении (readBody/listAll/SDK reader); needs src/protocol/trace.ts, src/protocol/legacy.ts. Частично закрыт F013/F139 |
| R003-rest | WP2-connect | needs src/probe/active.ts, src/probe/wire.ts (публиковать частичные результаты через накопитель в Progress) и src/rules/engine.ts (правила незавершённой фазы помечать как skipped 'stopped by --max-duration') |
| C-imp-2-rest | WP2-connect | needs src/rules/server.ts: SRV-009 должен давать одну находку на exchange, а не три на одну страницу Cloudflare |
| R012-rest | WP2-connect | needs src/probe/network.ts, src/probe/wire.ts: сырые initialize-пробы (preflight и origin) должны отправлять DELETE с полученным Mcp-Session-Id |
| C003-followup | WP2-connect | needs src/rules/server.ts: SRV-018 должен брать счётчик из transport.stdio.nonJsonTotal (хранится не больше 50 строк) и писать 'non-JSON-RPC line(s)' |
| F019 | WP3-probe | needs src/connect.ts: the remaining part (server/discover for era detection, the auth trigger on a 401 behind the redirect, and the runAuthProbe URL) should use sameHostRedirect(url, pf) from src/probe/network.ts right after preflight() in buildHttp. The wire- |
| F031 | WP3-probe | needs src/connect.ts: pass { timeoutMs: connectTimeout, signal: progress?.abort.signal } to both tlsCheckWithRetry calls in buildHttp (the MCP host and the AS-host loop) and add a checkpoint between AS hosts. The API in network.ts is ready (7e28e4a). |
| F025-wiring | WP4-protocol | needs src/probe/wire.ts: передать fullBody: false в пять modern.request-проб (опция уже есть в ModernClient, b35b970) |
| R008-legacy-sse | WP4-protocol | needs src/protocol/recording.ts: для legacy HTTP+SSE (POST→202, ответ по GET-потоку) задержку нужно мерить в RecordingTransport от send(id) до record(id); tracer больше не пишет 202 как сэмпл |
| F024/R010-SPEC-016 | WP4-protocol | needs src/connect.ts: collectErrors должен записывать ObservedError для успешного modern-ответа с id другого типа или значения (ModernResponse.idMismatch), чтобы это отрепортил SPEC-016 |
| F137-rawPages-cap | WP4-protocol | needs src/limits.ts: capSnapshot не обрезает строки в listMeta[*].rawPages; память теперь ограничена бюджетом листинга, но regex-лимиты на rawPages не распространяются |
| F036-json-retention | WP4-protocol | feature: хранить в exchange только сниппет, а parsed JSON возвращать вызывающему — это меняет модель snapshot в connect, probe и rules (collectErrors и правила проб читают exchange.json) |
| F034-spec | WP4-protocol | needs docs/design/spec.md: §4.4 всё ещё требует совместимости с Node 18 (WP10) |
| F138-docs | WP4-protocol | needs README.md/SECURITY.md: описать лимит 64 MiB на SDK-пути и бюджет листинга 64 MiB (WP10) |
| F102 | WP5-apps | Contradicts spec.md §APPS-013, which is scoped to openExternal/ui/open-link. Counting every <a href> as navigate would widen the rule and add a chatgpt warning to most widgets that have links, and it is not verified that ChatGPT gates plain anchors by redirect |
| F109 | WP6-inj-data-pol | needs src/rules/util/text.ts (и, возможно, src/rules/types.ts + src/report/*): имя промпта теряется в locationOf(), которым пользуются все corpus-правила (INJ, DATA, POL, TOOL). Если чинить только в injection.ts, DATA/POL останутся без имени, а после фикса loc |
| F061 | WP7-auth-spec-srv | needs docs/design/spec.md: код намеренно согласован (spec=warning для AUTH-002, spec error несёт AUTH-004); формулировку в §2.8 AUTH-002 нужно исправить на 'chatgpt error, spec warning, claude warning' (WP10) |
| F076 | WP8-tools-schema-rt | feature: new platform rule for Claude/OpenAI tool-name characters plus a chatgpt variant of TOOL-002; vendor patterns must first be checked against current docs, and a new rule or severity needs RULES.md/README regeneration (WP10) |
| F080 | WP8-tools-schema-rt | feature: new tool-list-budget rule; its thresholds would live in src/limits.ts (needs src/limits.ts, WP2) and it needs RULES.md/README regeneration |
| F081 | WP8-tools-schema-rt | Changing walkSchema's dedup to per-stack duplicates findings at every $ref site and grows exponentially on DAG-shaped schemas without a node budget; it changes every walker-based rule, so the maintainer should decide |
| F079 (rest) | WP8-tools-schema-rt | feature: new schema-lint checks (keyword typos, required naming missing properties, unknown format) go beyond the TOOL-017 rule spec and need a new rule or a spec change |
| F077 (part 1) | WP8-tools-schema-rt | Dropping the 'url' token from TOOL-015 name matching also drops true positives (fetch_url) and gains little, because the free url/format:uri param check would still fire; whether shortening a URL is open-world is a judgment call |
| F122 | WP9-report-redact | Design decision. docs/design/spec.md §5.3 maps severity straight to SARIF level, and the arbiter called this a format inconsistency, not a contract break. Taking the level from the gated platforms would turn a spec-only error into a 'note' without --fail-on-sp |
| F132 | WP9-report-redact | needs src/rules/util/net.ts (displayUrl/isKnownToken), and it goes against the documented 'no entropy guess' design. It would be a feature: heuristic redaction of hex/base64 URL path segments and neutral-named query values, plus a --no-redact-heuristic opt-out |
| F131-annotations | WP9-report-redact | Capping or grouping annotations at about 10 per type would break the documented one-annotation-per-finding contract, and test/stderr-flush.test.ts relies on more than 1000 annotations. Needs a maintainer decision. Only the step-summary size guard was done. |
| F135-verbose-stderr | WP9-report-redact | needs src/cli.ts. The '[stdio stderr]' and '[http]' --verbose trace is printed raw there. visibleText() is exported from src/report/index.ts for that fix. |

Deferred items whose reason is `needs README/SECURITY/spec.md (WP10)` are picked up by wave 2. Items that change the exit-code contract (F011, R013) or the SARIF level mapping (F122) are maintainer decisions and are listed as open questions in the WP10 report. The remaining `needs <file>` items are candidates for a wave 3.

| 2026-11-01 | Wave 2 (WP10) finished: 23 done, 9 deferred, 9 open questions (spec §8 Q5–Q8 and `remediation/WP10-docs-ci-report.md`). CHANGELOG `[Unreleased]` assembled (128 entries). RULES.md/README/spec counts now generated by `scripts/rules-table.mjs`. Rebased onto `main`, fast-forwarded (11 commits), typecheck/build/docs tests green, pushed `cdfd53f..f0f06ea`. |
| 2026-11-01 | Wave 3 scoped: 18 deferred items whose only blocker was file ownership (`remediation/wave3-items.json`). Not included: 10 feature-sized items (tracked in MARKET.md) and 8 items awaiting a maintainer decision. |

## 6. Open questions for the maintainer (from WP10)

- F011: остановку по --max-duration выделить в отдельный exit-код? (a) оставить 3 + Result INCOMPLETE/limits.stopped; (b) новый exit 4 в 0.2.0; (c) opt-in --deadline-exit-code. Записано как spec §8 Q5
- R013: что делать при token-rejected? (a) оставить exit по --fail-on; (b) всегда exit 3; (c) opt-in --fail-on-incomplete + ::warning-аннотация (src/report/github.ts). spec §8 Q6
- F122: SARIF level — (a) максимум по всем платформам (сейчас); (b) уровень gated-платформ; (c) --sarif-level gated|max. spec §8 Q7
- F102: должен ли APPS-013 считать каждый <a href> навигацией, требующей redirect_domains? (a) нет; (b) да, сначала как chatgpt info. spec §8 Q8
- F151: Node 20 в EOL — поднять engines до >=22.12 в 0.2.0 или оставить >=20.19 с тестами 20.19 только на Linux (текущее состояние)?
- F150: оставаться только CLI (README теперь так и говорит; возможно, закрыть deep imports через exports) или добавить src/index.ts + declaration + exports/types?
- F153: свернуть ~35 записей Changed/severity в 0.1.0 (сравнение с pre-release baseline) в короткое Added? В этом пакете не сделано: раздел 0.1.0 менять нельзя
- F148: опубликован ли 0.1.0 в npm на самом деле? Если да — убрать фразу о запасном варианте в README; если нет — 'First public release' в CHANGELOG преждевременно
- Catalog date: сдвигать ли CATALOG_DATE для релиза, в котором правила изменились из-за исправлений кода, а не новых документов-источников?

Note: GitHub reported "Bypassed rule violations" on both pushes. The first push was blocked on a GitLab-token-shaped fixture, which was rewritten; the bypass message on the later pushes suggests another fixture (likely the 36-character `ghp_…` strings in `test/remediation-wp8-tools-schema-rt.test.ts`) still matches a secret-scanning pattern and went through only because the account has bypass rights. Wave 3 should convert those to the repo's `SYNTH` convention.

## 7. Wave 3 results and final verification

| Package | Branch | Done | Deferred | Deferred reasons |
|---|---|---|---|---|
| W3A-connect | `worktree-wf_a7e88476-bcc-1` | 6 | 1 | F024/R010-SPEC-016: needs src/rules/spec.ts: SPEC-016 проверяет code у каждого ObservedError. Запись для успешного ответа с чужим id выдала  |
| W3B-probe-rules | `worktree-wf_a7e88476-bcc-2` | 6 | 1 | R003-rest: needs src/connect.ts. Чтобы частичные результаты runActive/runWireProbes сохранялись, в Progress нужен накопитель, а sto |
| W3C-cli-tests | `worktree-wf_a7e88476-bcc-3` | 4 | 1 | F156-thresholds: Пороги покрытия и CI-артефакт coverage нельзя откалибровать без прогона полного набора тестов (это запрещено правилом D1 |

Integration: three branches rebased onto `main` and fast-forwarded (18 commits), typecheck and build green after each. Wave-3 changelog lines added to `[Unreleased]`; two hand-written catalog dates in `docs/design/spec.md` moved to 2026-11-01.

**Full test suite run** (D1 lifted for the final check, the maintainer having asked for fully autonomous completion; the suite is offline, `live` tests stay off without `MCP_REVIEW_CHECK_LIVE`): 59 files, **1153 passed, 3 failed, 4 skipped**, 164 s. The three failures and what was done:

| Test | Cause | Resolution |
|---|---|---|
| `e2e-stdio` 80 000-character description, markdown | WP9 now escapes `_` in markdown (`run\_sql`); the expectation predated that | Expectation updated |
| `max-duration` stopped during active tool calls | Under full-suite load the fresh re-list connections alone used the 4 s budget, so the stop landed in phase `tools re-list`; passes alone | Budget raised to 8 s (the 30 × 300 ms active calls still run far past it) |
| `remediation-wp2-connect` 70 MB stdio message | Pipe transfer over 60 s under load; passes alone | Test timeout raised to 180 s |

Follow-up from W3A's notes applied in the same commit: SRV-010 now samples `bodyMs` (or the recorded request-to-result timings on legacy SSE) instead of `durationMs`, completing R008. Re-run of the seven affected files: 192 tests green.

### 7.1 Totals across three waves

| | Count |
|---|---|
| Work items (confirmed findings + improvements) | 194 |
| Done (incl. items found already covered by another package) | 165 + 23 + 16 = 204 entries, covering 173 distinct items |
| Still deferred: feature-sized (MARKET.md backlog) | 10 (F011, R013, F146, F036, F076, F080, F079-rest, F168, F150-rest, F159-rest) |
| Still deferred: maintainer decision | 8 (F102, F081, F077-part1, F122, F131, F151-rest, F145-rest, spec-sync) + open questions in §6 |
| Still deferred: needs another change first | 3 (F024/R010 needs SPEC-016 to skip code checks for id-mismatch records; R003-rest partial results at `--max-duration`; F156 coverage thresholds) |
| After wave 4 (§8) | Done or decided: all 21 items above (16 implemented, 7 kept as they are by decision: F122, F102, F151, F153, F081, F077-part1, F131). Still deferred: the follow-ups listed in §8.3 |

Commits on `main` since `8b0f41e`: 127 (wave 1) + 11 (wave 2) + 18 (wave 3) + 2 (integration) = 158. All pushed with plain fast-forward pushes.

### 7.2 Post-push note on secret-scanning patterns

GitHub answered every push with "Bypassed rule violations", meaning some content matched a secret-scanning pattern and went through only because the account has bypass rights. Two sources were found and neutralised: a GitLab-token-shaped test fixture (rewritten before the first push, see §4) and a placeholder Anthropic key string (`sk-ant-api03-AbCd…`) quoted inside the review evidence for F085, which was replaced with a `SYNTH`-marked placeholder in a follow-up commit. The placeholder is still present in the pushed commit `7ee0e9b`; it was never a real key. If GitHub opens a secret-scanning alert for it, close it as a false positive. The remaining `ghp_…` strings in tests and evidence already carry the repo's `SYNTH` marker.

Verified afterwards with `gitleaks detect --no-git` over the working tree: the same rule families (gitlab-pat, stripe-access-token, aws-access-token, jwt, github-pat, generic-api-key) fire on fixtures that were already in `main` before this work (`test/redact.test.ts`, `test/e2e-redaction.test.ts`, `test/incomplete.test.ts`, `test/sarif.test.ts`, …), all `SYNTH`-marked by design because the project tests secret redaction. The bypass message is therefore the repository's normal state for any push touching those tests, not a regression introduced here. No real credential was found.

| 2026-11-01 | Wave 3 integrated, full suite green after three test adjustments, SRV-010 timing fix, review record committed. Final state: `origin/main` = `c1b5def`, 160 commits since `8b0f41e`, all fast-forward pushes. Remediation complete except the 21 deferred items listed in §7.1 and the open questions in §6. |

## 8. Wave 4

Wave 4 closed the 21 items left in §7.1 with the default decision for each open question, as the maintainer asked ("finish with the default options and release to npm"). The plan, the decision table and the package split are in [remediation/wave4-plan.md](remediation/wave4-plan.md); in short:

| Item | Decision |
|---|---|
| F011 / Q5 | Exit 4 for a `--max-duration` stop after the handshake, in 0.2.0 (minor). |
| R013 / Q6 | Opt-in `--fail-on-incomplete` (exit 3 on a partial check) and an always-on `::warning` for a partial check in GitHub Actions. |
| F122 / Q7 | Keep SARIF level = highest severity over all platforms; no option. |
| F102 / Q8 | Keep APPS-013 scoped to `openExternal` / `ui/open-link`. |
| F151 | Keep `engines.node >=20.19`; revisit in 0.3.0. |
| F150 | CLI-only: `exports` exposes only `./package.json`, `main` dropped. |
| F153 | 0.1.0 CHANGELOG section left as is. |
| F148 | 0.1.0 is on npm; README install note reworded. |
| Catalog date | Stays 2026-11-01 (moved in wave 2, `cae2189`; the plan row was corrected in `68d0361`). |
| F081, F077-part1, F131 | Kept as they are. |
| F036, F146 | Lite variants only. |
| F168 | P0 items only: `--baseline` and a composite `action.yml`. |
| F159, F145, F156 | `npm audit` off PRs (weekly + `main`), provenance check after publish, coverage thresholds in `test:coverage` only. |
| F024 / R010, R003 | SPEC-016 id-mismatch records; partial results kept on a `--max-duration` stop. |
| F076, F080, F079 | New rules TOOL-033, TOOL-034, TOOL-035; TOOL-002 on chatgpt. |
| spec-sync | `docs/design/spec.md` updated, Q5–Q8 answered (W4E). |

### 8.1 Results per package

| Package | Branch | Commits on `main` | Done | Deferred |
|---|---|---|---|---|
| W4A-cli ([report](remediation/W4A-report.md)) | `worktree-agent-a51f643012a337d9e` | `f5e539b`, `26780f5`, `3179d51`, `b9288b6`, `292e59b` | F011 (exit 4), R013 (`--fail-on-incomplete`, partial-check `::warning`; `list-failed` counts as partial), F148, F150, F168-baseline (`src/baseline.ts`) | `--save-baseline`, tool-definition drift, `--diff-only`; the existing exit-3 test expectations (done at integration, `21abf35`) |
| W4B-rules ([report](remediation/W4B-report.md)) | `worktree-agent-ad0b0ab4fe935a0b2` | `92820d6`, `361f2a6`, `7aa84d1`, `dcbdadb` | F076 (TOOL-033, TOOL-002 chatgpt), F080 (TOOL-034), F079-rest (TOOL-035; TOOL-020 already covered `outputSchema`) | none |
| W4C-connect ([report](remediation/W4C-report.md)) | `worktree-agent-abacd8763566a28b0` | `36f617a`, `4e8ddb2`, `ea90e70`, `1194618` | F024/R010 (SPEC-016), R003-rest (partial results, `limits.stopped.completed/unfinished`, `stopped by --max-duration` skips), F146-lite and F036-lite (already in place since wave 1; pinned with tests) | F146 beyond lite, F036 full, `clientInfoVariants` partial, Origin probes lost on a stop |
| W4D-ci ([report](remediation/W4D-report.md)) | `worktree-agent-ab4c99ea6296ff890` | `46e6f8f`, `0698836`, `a5412d6`, `39c955a`, `44b6aa8`, `7c46590` | F145-rest (provenance check), F159-rest (`audit.yml`), F156 (thresholds 88/82/89/92, `reportOnFailure`), F168-action (`action.yml`, CI `action` job) | action outputs `score` / `verdict-*`; `v0` moving tag |
| W4E-docs | `main` (no branch) | this commit series | CHANGELOG `[Unreleased]`, spec.md (§2.2, §2.3, §3.1–3.6, §4.1, §4.2, §5.3, §8 Q5–Q8), README action recipe and `@0.2` pins, this section | — |

Two edits outside the stated ownership, both minimal and reviewed at integration: W4B appended rule cases to `test/rules/tools.test.ts` and widened the frozen ID range in `test/catalog.test.ts` (required by the repo's own guards for any new rule); W4D added `audit.yml` and the `uses: ./` exemption to `test/workflows.test.ts`. W4E narrowed the README assertion in `test/docs.test.ts` that forbade any mention of `upload-sarif` / `codeql-action` (written before the action existed) to the README outside "CI recipes" (`b2c2b6f`).

### 8.2 Integration

The four branches were rebased onto `main` and fast-forwarded without conflicts (19 commits from `36f617a` to `292e59b`). The exit-4 change made nine existing tests fail on their old exit-3 expectation for a stopped run (`test/incomplete.test.ts`, `test/e2e-stdio.test.ts`, `test/e2e-http.test.ts`, `test/remediation-w3c-cli-tests.test.ts`, as W4A predicted); they were updated in `21abf35`, together with the `--help` regex for the wrapped "internal error" phrase. A follow-up commit (`68d0361`) moved the TOOL-033 source comments to point at `CATALOG_DATE`, gave the 70 MB stdio overflow test a 120 s request timeout for full-suite load, and corrected the catalog-date row of the plan.

### 8.3 Still deferred after wave 4

| Item | Origin | Why deferred |
|---|---|---|
| `--save-baseline`, tool-definition drift ("Changed tool definitions"), `--diff-only` | W4A, MARKET.md §3.3 | Separate CLI modes beyond the P0 `--baseline`; `--format json --output` already writes a baseline. |
| Action outputs `score`, `verdict-claude`, `verdict-chatgpt` | W4D | Needs a second run with `--format json` or parsing the SARIF run properties; best after `--baseline` so the outputs can count new findings. |
| `v0` moving action tag | W4D | Moving it needs a forced tag push (`git push origin refs/tags/v0 --force`), which the repository's no-force-push rule rejects; users pin a full tag or SHA. CONTRIBUTING.md still describes it as an optional maintainer step. |
| F146 beyond lite: cap `active.calls[].jsonRpcError` / `transportError` / `args` and `observedErrors[].message` | W4C | Needs `capStrings` exported from `src/limits.ts`; a global byte budget stays a design change. |
| F036 full | W4C | Stop keeping the whole parsed JSON of every exchange; changes the snapshot model. |
| R003: partial `clientInfoVariants` | W4C | Published only when all variants finish; partial sets would let RT-012 compare uneven lists. |
| R003: Origin probes lost on a stop | W4C | They come back from one `originProbes()` call in `src/probe/network.ts`; a stop inside it drops the ones already made. |
| Coverage job in CI; re-measure thresholds after the W4A–W4C code | W4D | `test:coverage` is not run in CI, and two timing tests (wp2 70 MB stdio, limits wall-clock) are flaky under instrumentation. |
| Action job on real macOS / Windows runners | W4D | The `action` CI job runs only once pushed; bash 3.2 and Git Bash behaviour are unverified locally. |
| MARKET.md roadmap: config file, `--listing`, `--format junit`, `--oauth` | wave4-plan F168 | Feature work for a later minor. |
| F151: raise `engines.node` | wave4-plan | Revisit in 0.3.0. |
| Open questions Q1–Q4 in spec §8, §6 items not covered above | — | Unchanged. |

### 8.4 Verification (W4E)

`npm run typecheck`, `npm run build`, `npm run readme:rules` (no drift: 147 rules, 31 manual items, catalog date 2026-11-01) and the docs sync tests `test/docs.test.ts test/catalog.test.ts test/remediation-w3c-cli-tests.test.ts test/remediation-w4d-action.test.ts test/workflows.test.ts`. The full suite was not run by W4E (another process was running it).

### 8.5 Full-suite runs, the CI failure since wave 1, and the 0.2.0 release

| Step | Result |
|---|---|
| Full suite after integrating W4A–W4D (`npx vitest run`, 14-core VM) | 1230 passed, 2 failed: `test/lifecycle.test.ts` (the TOOL-033 source comments spelled out the catalog date a second and third time in `src/`) and the 70 MB stdio overflow test in `test/remediation-wp2-connect.test.ts` (request timed out before the overflow). Both fixed in `68d0361`. |
| Full suite with the GitHub Actions environment (`CI=true GITHUB_ACTIONS=true GITHUB_STEP_SUMMARY=… MCP_REVIEW_CHECK_SKIP_BUILD=1`) | 1232 passed, 4 skipped, 0 failed. |
| CI on `main` | Red on every push since the wave-1 integration (`cdfd53f` … `14cce30`), on every OS and Node version, always in `npm test`. The public job pages show one failing assertion: the 70 MB stdio overflow test got `MCP error -32001: Request timed out` instead of the overflow message. The SDK read buffer re-concatenates on every 64 KB chunk, so 70 MB takes ~40 s on a loaded 14-core box and more on a 2-core runner; the test's 20 s request timeout expired first. Fixed by a 170 s request timeout and a 300 s test timeout (`52f1909`). CI run 41390270506 on `52f1909`: success. |
| Release | `[Unreleased]` → `## [0.2.0] - 2026-11-01`, `npm version minor`, docs regenerated (`e065cb1`). Annotated tag `v0.2.0` on `52f1909` pushed after the green CI run; `release.yml` builds, tests, publishes (trusted publishing or the `NPM_TOKEN` first-release step) and verifies `dist.attestations` before creating the GitHub release. The result is recorded in the status log. |
