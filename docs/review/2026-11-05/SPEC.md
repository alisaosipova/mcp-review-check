# Review round 4: mcp-review-check 1.1.0 (2026-11-04/05)

## 1. Goal

A whole-codebase review of mcp-review-check at 1.1.0 (`bc7090d`). It covers **security, UX and usability, the engine, and feature expansion**, as well as bugs and performance. Every finding is verified before it enters the improvement plan. The user's request (2026-11-04): run the review again, plan improvements in security, user experience and usability, the engine and new functionality, then implement everything that is found.

## 2. Scope

The ten areas of round 3 ([../2026-11-04/SPEC.md](../2026-11-04/SPEC.md) §2) plus three cross-cutting areas:

| # | Area | Focus |
|---|---|---|
| 11 | Feature gaps against the directories and the MCP spec | The rule catalog and the manual checklist compared with the current Claude and OpenAI directory pages and MCP 2025-11-25 / 2026-07-28, read from the public pages |
| 12 | Usability for CI integrators and power users | First run, config, baseline, Action, SARIF/JUnit, monorepos, upgrades, suppression |
| 13 | Engine architecture | Rule metadata vs behaviour, determinism, caching, error isolation, budgets, extension points |

## 3. Dimensions

bug, security, perf, ux as in round 3. New dimensions:

- **engine**: rule-engine defects such as wrong needs or skips, isolation and determinism.
- **feature**: a missing check or capability, recorded as an improvement with value, effort, release level and source.

Severity is defined as in round 3.

## 4. Method

Same as round 3: one Opus finder per area; two independent Opus verifiers per high or medium finding (a code reader and a reproducer) with an arbiter on a split; one batched verifier per area for low findings; then a completeness critic whose findings go through the same verification. Finders could read public documentation with WebFetch. Servers were local fixtures and 127.0.0.1 only.

## 5. Decisions

D1–D4 as in round 3: no whole-suite runs by agents; all agents on Opus; worktrees only and fast-forward pushes; no co-author trailers and no force push.

## 6. Evidence

`evidence/01-find/<area>.json`, `evidence/02-verify/<id>.json`, `evidence/03-critic/critic.json`, `evidence/workflow-result.json`. `FINDINGS.md` is rendered by `evidence/render_findings.py`.

## 7. Status log

| When | Event |
|---|---|
| 2026-11-04 | Workflow `wf_b3edd7dc-711` against `bc7090d`: 102 Opus agents (13 finders, verifiers, arbiters, critic). 92 findings: 88 confirmed (3 high, 32 medium, 53 low), 1 disputed, 3 refuted; 92 improvement ideas. |
