# Review 2026-11-01: full code, security and market review of mcp-review-check 0.1.0

> **Living review document.** Status and evidence are appended as the review proceeds; nothing is rewritten after the fact.
> Target: commit `8b0f41e` on `main` (CHANGELOG dates 0.1.0 as 2026-10-25). Reviewer: Claude (Fable 5.1 orchestrating, Opus 5.5 subagents) driven by the maintainer.

## 1. Goal

Answer three questions about the codebase as it stands, with evidence for every claim:

1. **Bugs.** Where does the tool produce a wrong verdict, crash, leak, hang or mis-handle an edge case?
2. **Improvements.** What should change in design, DX, reports, tests or docs even if it is not a bug?
3. **Market.** Which features would move the tool against competitors and the current directory / spec requirements (as of 2026-11)?

## 2. Scope

| In scope | Out of scope |
|---|---|
| `src/**` (8403 LOC), `scripts/*.mjs`, `.github/**`, `package.json`, docs (`README.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/RULES.md`, `docs/design/spec.md`) | Running the full vitest suite (maintainer declined: slow, hits the network) |
| Static reading, grep, mini-repros with `node` against the built `dist/` | Changing project code during the review |
| Supply-chain posture of the tool itself | Auditing upstream deps beyond `npm audit` (0 vulnerabilities at `npm ci`) |

Baseline established before review: `npm ci` ok, `tsc -p tsconfig.test.json --noEmit` clean, `npm run build` ok.

## 3. Method

### 3.1 Phase Find (done, first run, Fable 5.1 agents)
Nine parallel reviewers, each owning one subsystem, each required to read its files completely and attach code quotes or `node` repro output as evidence:

| Reviewer | Files | Raw findings |
|---|---|---|
| cli-connect | `src/cli.ts`, `src/connect.ts`, `src/limits.ts`, `src/diagnose.ts`, `src/version.ts`, `src/explain.ts`, `src/catalog.ts` | 17 |
| protocol-probe | `src/protocol/*`, `src/probe/*`, `src/rules/util/net.ts`, `src/rules/util/wwwAuth.ts` | 20 |
| rules-server-spec-auth | `src/rules/server.ts`, `src/rules/spec.ts`, `src/rules/auth.ts` | 24 |
| rules-tools-schema | `src/rules/tools.ts`, `annotations.ts`, `schema.ts`, `util/schemaWalk.ts`, `util/text.ts`, `util/access.ts`, `lexicon.ts` | 20 |
| rules-injection-data-policy-apps | `src/rules/injection.ts`, `data.ts`, `policy.ts`, `apps.ts`, `runtime.ts`, `util/html.ts`, `util/ui.ts`, `util/obs.ts` | 33 |
| report-redact-engine | `src/report/*`, `src/redact.ts`, `src/snapshot.ts`, `src/rules/engine.ts`, `src/rules/manual.ts` | 20 |
| security-lens | whole `src/`, `package.json`, `.github/workflows/*`, `scripts/*` (tool-as-victim threat model) | 13 |
| docs-tests-ci | docs, `package.json`, tsconfig, vitest config, `.github/**`, `scripts/*`, `test/*` structure (not run) | 21 |
| market-analysis | README, spec, RULES.md + web research (competitors, directory requirements, MCP spec 2026-07-28+) | 19 ideas |

Dedup key: `file + normalised title`. Result: **168 unique findings** (76 bug, 13 security, 12 docs-mismatch, 67 improvement; 5 high, 58 medium, 105 low). Raw output: `evidence/01-find-raw/F001..F168.json`, `_all.json` (per-reviewer, undeduped), `_market.json`.

### 3.2 Phase Verify (Opus 5.5 agents)
Every `bug`, `security` and `docs-mismatch` finding is adversarially checked; `improvement` items are not verified, only triaged by the maintainer.

| Finding severity | Verifiers | Confirmation rule |
|---|---|---|
| high, medium | 2 independent skeptics: *code-reader* (trace callers/callees, tests, spec intent) and *reproducer* (must try a `node` repro against `dist/`) | both say not refuted, or one confirms with confidence ≥ 0.8 while the other refutes with confidence < 0.6 |
| low | 1 *code-reader*, batched up to 4 findings per file so one read of the file settles several claims | not refuted with confidence ≥ 0.6 |

Default stance given to every verifier: *when in doubt, refuted = true.* Verifiers may correct severity and description. Verdicts: `evidence/02-verify/<id>.json`.

### 3.3 Phase Critic
One completeness critic walks eight end-to-end scenarios (crashing stdio server, 401 without `WWW-Authenticate`, 500 tools / 2 MB descriptions, `--output` into a missing directory, `--active` without `--tool-args`, Cloudflare challenge, IPv6-only host, Windows paths in `--stdio`) and names areas the review did not touch. Its new findings go through the same verification.

### 3.4 Decisions during the review
| # | Decision | Why |
|---|---|---|
| D1 | Full test suite not executed | Maintainer stopped it: slow, network-bound tests (`real-servers`, `live`, `e2e-*`) |
| D2 | Subagents moved from Fable 5.1 to Opus 5.5 after Phase Find | Maintainer: usage limits were being consumed too fast |
| D3 | Phase Find results recovered from the first run's journal instead of re-running | Changing the model invalidates the resume cache; re-running 9 reviewers would have been pure waste |
| D4 | Low-severity findings get one batched verifier instead of two | Cost; a single careful read of one file is enough to settle cosmetic claims |
| D5 | After the VM crash, resume the same run id instead of restarting | Completed agent() calls return from the journal cache; only the ~45 unfinished verifiers and the critic run again |

## 4. Acceptance criteria

- [x] Every confirmed finding has: file, line, failure scenario, evidence (code quote or repro output), suggested fix, severity after verification.
- [x] Every refuted finding keeps its refutation reasoning (so it is not re-reported next time).
- [x] Disputed findings (verifiers disagree) are listed separately with both arguments; the maintainer decides.
- [~] Improvements and market ideas are prioritised (P0/P1/P2, effort S/M/L) with sources. *Market ideas: done in MARKET.md. Code improvements (70): listed in FINDINGS.md §4 with reviewer severity only; final priority is the maintainer's call.*
- [x] `FINDINGS.md` and `MARKET.md` in this directory are the human-readable outputs; `evidence/` is the audit trail.

## 5. Evidence layout

```
docs/review/2026-11-01/
  SPEC.md                 this file
  FINDINGS.md             confirmed / disputed / refuted, improvements  (written after Verify)
  MARKET.md               competitors and prioritised ideas             (written after Verify)
  evidence/
    01-find-raw/_all.json      per-reviewer raw output, first run (undeduped)
    01-find-raw/_market.json   market reviewer raw output
    01-find-raw/F###.json      one deduped finding per file (id, kind, severity, file, line, evidence, fix, confidence, dimension)
    02-verify/F###.json        verifier votes per finding (lens, refuted, confidence, reasoning, repro, corrected_*)
    03-critic/                 critic findings and their verification
    workflow-result.json       final structured return of the Verify+Critic workflow
    render_findings.py         the script that renders FINDINGS.md from evidence/ (re-run after editing verdicts)
```

## 6. Status log

| When (UTC) | Event |
|---|---|
| 2026-11-01 ~06:45 | Baseline: `npm ci`, typecheck, build ok. Workflow run 1 launched (Fable agents). |
| 2026-11-01 ~07:42 | Run 1 stopped after all 9 Find agents and 17 Verify agents completed (D2). |
| 2026-11-01 ~07:47 | Find results recovered from journal (D3); 168 unique findings written to `evidence/01-find-raw/`. |
| 2026-11-01 ~07:50 | Verify+Critic workflow launched on Opus 5.5 with the file index as `args`. |
| 2026-11-01 ~07:55 | 22 Verify verdicts from run 1 (Fable verifiers, `cli.ts`/`connect.ts`/`spec.md`/`wire.ts` findings) saved to `evidence/02-verify/run1-fable/` as supplementary evidence. |
| 2026-11-01 ~07:57 | `MARKET.md` rendered from `evidence/01-find-raw/_market.json` (14 competitors, 19 ideas). |
| 2026-11-01 (later) | Host VM crashed mid-Verify. Journal held 84 of ~130 verifier results (81 finding ids). Saved as `evidence/02-verify/F###.json`; workflow resumed from cache (D5). |
| 2026-11-01 (later) | Verify workflow resumed from journal cache (task `wva88p041`). Partial `FINDINGS.md` rendered from the 81 saved verdicts (53 confirmed / 5 disputed / 23 refuted / 20 pending) by `render_findings.py` (scratchpad); re-rendered as final when the run completes. |
| 2026-11-01 (later) | Verify+Critic finished: 135 Opus agents, 2.05M tokens, 0 errors. 101 findings → 69 confirmed / 9 disputed / 23 refuted; critic added 4 (3 confirmed, 1 disputed) and 3 improvements, named 12 untouched areas. All 5 originally "high" findings were downgraded to medium by verifiers. Final `FINDINGS.md` rendered; `evidence/02-verify`, `03-critic`, `workflow-result.json` written. |

## 7. Outcome

| Metric | Value |
|---|---|
| Unique findings from Find | 168 |
| Verified (bug / security / docs-mismatch) | 101 + 4 from critic |
| Confirmed | 72 (0 high, 21 medium, 51 low) |
| Disputed | 10 |
| Refuted | 23 |
| Improvements (unverified) | 70 |
| Areas not covered (critic, SPEC §3.3) | 12, listed in FINDINGS.md §5 |

Next step proposed to the maintainer: fix the 21 medium findings first (false positives in POL/TOOL/INJ/DATA heuristics, same-host redirect breaking raw probes, GET-probe session reuse, terminal escape injection in the text report, cookie/short-secret redaction), then triage the 10 disputed items.

## 8. Round 2 (started after §7)

Trigger: maintainer asked to continue the review. Input: the 12 untouched areas named by the critic (FINDINGS.md §5) and the 10 disputed findings (FINDINGS.md §2).

| Stage | Agents (Opus 5.5) | Output |
|---|---|---|
| Find-2 | 5 reviewers, one per area group: (a) `--max-duration`, signals, process tree; (b) SSE fallback, legacy era, `modern.ts` pagination/sessions; (c) `score.ts`, `report/index.ts` gate/exit codes vs README, `github.ts` escaping, `explain.ts`, `--list-rules`; (d) `limits.ts` `capStrings` side effects on rules, `apps.ts` APPS-001..019; (e) `--bearer` preflight path, auth-probe with valid token, SDK `ReadBuffer` limits, stdio `nonJson` buffer growth | `evidence/04-round2/find/R###.json` |
| Arbiter | 1 arbiter per disputed finding; reads the raw finding, both round-1 votes and the code; returns a final verdict with reasoning | `evidence/04-round2/arbiter/<id>.json` |
| Verify-2 | same rules as §3.2 | `evidence/04-round2/verify/R###.json` |

Dedup against round 1: Find-2 agents receive the list of round-1 finding titles for their files and must not re-report them.

Round-2 status: workflow `wf_9544269d-620` launched (5 area reviewers, 10 arbiters, then verification). On crash: resume with the same run id; partial results are in the run's `journal.jsonl` and can be extracted the same way as in D3.

### 8.1 Round-2 outcome

Workflow `wf_9544269d-620`: 56 Opus agents, 2.79M tokens, 0 errors, 15 min.

| Metric | Value |
|---|---|
| New findings from the 5 area reviewers | 48 (41 bug/security/docs, 7 improvements) |
| Confirmed / disputed / refuted | 36 / 3 / 2 |
| Round-1 disputed settled by arbiters | 10: 1 confirmed (F087, medium), 8 partially confirmed at low (F043, F085, F086, F089, F092, F118, F122, F141), 1 refuted (C004: SDK spawns via cross-spawn on win32, so `npx`/`.cmd` do work) |
| Areas checked and found clean | signals/exit codes 129-143, double SIGINT with grandchildren, `--max-duration` orphan processes, `withDeadline` race, score formula and gate vs README, `github.ts` escaping (matches actions/toolkit), clientCaps, era selection, modern-only sessions, cursor loops, APPS-002/009/010/011/018, `originMatches` (details: `evidence/04-round2/area-notes.json`) |

Notable round-2 medium findings: SSE-fallback error swallowed so legacy SSE+OAuth is reported as "HTTP 404 not an MCP endpoint" and the auth probe never runs (R007); Origin probes skipped for legacy HTTP+SSE so SRV-008 silently passes on local SSE servers (R009, security); SRV-010 latency measured to headers, invisible for SSE responses (R008); `--max-duration` stop during stdio connect drops the server's stderr that SRV-003's fix text promises (R002); APPS-006 wildcard on multi-level public suffixes (R032); 100 MB of non-JSON stdout crashes the linter with heap OOM, exit 134, no report (R046, re-evaluation of F141+F033).

### 8.2 Final totals (both rounds)

| Verdict | Count |
|---|---|
| Confirmed | 117 (0 high, 28 medium, 89 low) |
| Disputed (left to maintainer: R014, R029, R031) | 3 |
| Refuted | 26 |
| Improvements (unverified) | 77 |

Acceptance criteria in §4 hold for both rounds. The review is complete; the next step is remediation, which is a separate piece of work and is not started here.

## 9. Remediation

The maintainer asked to fix all confirmed findings and apply all improvements. That work, its waves, integration, test results and the remaining deferred items are documented in [REMEDIATION.md](REMEDIATION.md). The review directory (`docs/review/2026-11-01/`, including `evidence/`) is committed to the repository as the audit trail so nothing from the review or the remediation is lost.
