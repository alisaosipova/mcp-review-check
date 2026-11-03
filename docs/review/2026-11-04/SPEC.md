# Review round 3 — mcp-review-check 1.0.0 (2026-11-04)

## 1. Goal

A whole-codebase review of mcp-review-check at 1.0.0 for **bugs, security problems, performance and user experience**, with every finding verified before it enters the remediation plan. Round 1 (`docs/review/2026-11-01/`) covered 0.1.0; since then waves 4–7 and 1.0.0 added about 5.5k lines in `src/` (now about 12.3k), each package reviewed by a single agent only.

## 2. Scope

| # | Area | Main files |
|---|---|---|
| 1 | CLI, config, input files, baseline/drift | `src/cli.ts`, `src/config.ts`, `src/input-file.ts`, `src/baseline.ts`, `src/report/drift.ts` |
| 2 | Connection and transport | `src/connect.ts`, `src/protocol/**`, `src/proxy.ts`, `src/diagnose.ts` |
| 3 | Probes | `src/probe/**` |
| 4 | Protocol, auth, server and runtime rules, engine | `src/rules/spec.ts`, `auth.ts`, `server.ts`, `runtime.ts`, `engine.ts` |
| 5 | Content rules | `src/rules/tools.ts`, `schema.ts`, `annotations.ts`, `injection.ts`, `data.ts`, `policy.ts`, `apps.ts`, `util/**` |
| 6 | Listings | `src/listing/**`, `src/rules/listing.ts`, `src/rules/manual.ts` |
| 7 | Reports and redaction | `src/report/**`, `src/redact.ts`, `schema/report.schema.json`, `src/limits.ts` |
| 8 | Supply chain and pipeline | `package.json`, lockfile, `.github/workflows/**`, `action.yml`, `Dockerfile`, `.pre-commit-hooks.yaml` |
| 9 | Performance and scale (cross-cutting) | regex and schema-walker complexity, memory on large servers, byte budget, timeouts, startup |
| 10 | Newcomer UX (cross-cutting) | the built CLI against `test/fixtures/*` and common failure modes: messages, exit codes, report readability, `--help`, `explain` |

Out of scope: README, `docs/guide/**` and `docs/launch/**` content (another session owns the user-value and launch work); findings there are recorded as proposals only.

## 3. Dimensions and severity

| Dimension | Covers |
|---|---|
| bug | wrong result, crash, hang, false positive or negative, broken contract (exit codes, JSON report, SARIF/JUnit, stability policy) |
| security | secret leak in any output, unsafe file or path handling, unsafe network behaviour (probes that change state, SSRF-like redirects, proxy credential exposure), supply-chain risk |
| perf | super-linear work on server-controlled input, unbounded memory or time, avoidable startup cost |
| ux | unclear or misleading messages, missing next step, confusing defaults, inconsistent output across formats |

Severity: **high** wrong result, crash, leak or contract break on realistic input; **medium** real defect in an edge case, or a claimed behaviour with no test; **low** minor or cosmetic.

## 4. Method

1. **Find**: ten Opus agents, one per area, read-only; each may build and run the CLI in its own detached scratch worktree. Known items from round 1 (`docs/review/2026-11-01/FINDINGS.md`, refuted and deferred lists, and the remediation records) are not re-reported unless the code regressed.
2. **Verify**: each high or medium finding gets two independent Opus skeptics, a code reader and a reproducer that runs the repro against the built CLI. Both confirm → confirmed; split → one arbiter; otherwise refuted. Low findings get one batched verifier per area.
3. **Critic**: one Opus agent asks what area, dimension or claim was missed; its findings go through the same verification.
4. **Render**: `FINDINGS.md` from the evidence (confirmed, disputed, refuted, improvements); then `REMEDIATION.md` with work packages and the release mapping (1.0.x for fixes, 1.1.0 for UX/perf features, 2.0 only as a note).

## 5. Decisions

| ID | Decision | Why |
|---|---|---|
| D1 | Agents never run the whole vitest suite; the integrator does, before each release. | A full run takes minutes and load-flakes under parallel agents. |
| D2 | All agents on Opus. | User choice, 2026-11-04. |
| D3 | Nobody switches branches or commits in the shared checkout; work in worktrees from `origin/main`, land by fast-forward push. | Another session uses that checkout. |
| D4 | No co-author trailers; no force push; repository identity via environment. | Maintainer rules. |

## 6. Evidence layout

`evidence/01-find/<area>.json` (finder output), `evidence/02-verify/<id>.json` (votes), `evidence/03-critic/critic.json`, `evidence/workflow-result.json`.

## 7. Status log

| When | Event |
|---|---|
| 2026-11-04 | Spec written. 1.0.0 CI failed on Windows in `test/repo-config.test.ts` (`git check-attr` argument list over the Windows command-line limit); fixed by passing paths on stdin (`1f24aba`). |
| 2026-11-04 | CI on `1f24aba` green; tag `v1.0.0` pushed. Review workflow `wf_d789777f-6bf` launched against `1f24aba` (10 finders, two-lens verification, critic, all Opus). |
| 2026-11-04 | Review finished (80 agents, 74 findings: 73 confirmed, 1 disputed, 0 refuted). Evidence under `evidence/`; FINDINGS.md and REMEDIATION.md written. |
