# Round 4 remediation progress

The plan is [REMEDIATION-draft.md](REMEDIATION-draft.md); its critique issues are in `evidence/plan-critique.json`. Each block goes through one builder in a worktree and one reviewer, then the lead commits and fast-forward pushes to main.

| Release | Block | Items | Status |
|---|---|---|---|
| 1.1.1 | P5a: rule-phase performance | A09-01 (high), A09-03, A09-06, A09-07, A09-08, I-A09-3 | done |
| 1.1.1 | P5b: content false positives | A05-05, A05-06..09, A05-11, A05-12, A05-13 (disputed), A10-04 | done |
| 1.2.0 | P6: listings | A09-02 (high), A06-01 patch half (high), ... | done |
| 1.2.0 | P2: transport, diagnosis, auth probe | A02-01, A02-02, A02-04, A02-05, A03-02, A10-01, A10-03, A09-05, I-A02-3, I-A02-4, I-A03-6 | done |
| 1.2.0 | P1: CLI, config, baseline, outputs | A01-02..06, A07-01, A12-04, A12-08, C-05, I-A01-2, I-A01-3, I-A01-5, I-A07-1, I-A09-5, I-A10-1, I-A10-3, I-A10-6 | done |
| 1.2.0 | P8: active probes | A03-01, A03-03, A03-04, I-A03-1, I-A03-3 (RT-003 -32020 part handed to P4) | done |
| 1.2.0 | P3: rule engine | A04-03, A04-06, A10-06, A13-01, A13-02 (engine half), I-A13-1, I-A13-2, I-A13-3 (+ A13-03, I-A04-3) | done |
| 1.2.0 | P4, P7, P9 | see plan §2.1 | in progress |
| 1.2.0–1.8.0 | see plan §2.2–2.8 | | open |
