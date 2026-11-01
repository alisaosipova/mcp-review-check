# W3B-probe-rules remediation report (wave 3)

Package: `src/probe/*.ts`, `src/rules/server.ts`, `src/rules/apps.ts`, `src/rules/util/text.ts`, `src/rules/types.ts`, `src/rules/engine.ts`, `src/report/*.ts`.
Branch: `worktree-wf_a7e88476-bcc-2`. New tests: `test/remediation-w3b-probe-rules.test.ts` (10 tests).

Verification: `npm run typecheck`, `npm run build`, `npx vitest run test/remediation-w3b-probe-rules.test.ts`, and the existing subsystem files `test/rules/*`, `remediation-wp2-connect`, `remediation-wp3-probe`, `remediation-wp4-protocol`, `remediation-wp5-apps`, `remediation-wp6-inj-data-pol`, `remediation-wp7-auth-spec-srv`, `e2e-http`, `e2e-stdio`, `auth-probe`, `limits`, `report`, `util`. All green except one pre-existing failure in `test/e2e-stdio.test.ts` (see Notes). The full suite was not run (D1).

## Done

| ID | Commit | What changed |
|---|---|---|
| F025 (wiring) | 42bae7e | The six `modern.request` wire probes (badVersion, unknownMethod, resourceMissing, headerMismatch none/wrong, unknownTool) pass `fullBody: false`: their bodies are read under the probes' 256 KB / 10 s cap. |
| R027 | d3da3d3 | APPS-014 does not report "never calls connect()" for a UI resource listed in `snap.limits.truncated` (`UI resource <uri>` or its `(blob)` entry): `app.connect()` may sit past the 2 MB cut. "sendSizeChanged reports height 0" still applies. |
| C003 (follow-up) | 73b983c | SRV-018 counts `transport.stdio.nonJsonTotal` (falls back to the kept lines) and says "N non-JSON-RPC line(s) on stdout". |
| C-imp-2 (rest) | fd23488 | SRV-009 reports each signal (cf-mitigated, "Just a moment..." page, 403/429 from Cloudflare/Akamai) once, at the first exchange that shows it, and merges the signals of one exchange into one finding: one Cloudflare challenge page now gives one warning, not three. The "every endpoint returns 403 text/plain" finding is unchanged. |
| F109 | fb8e365 | `locationOf()` names the prompt: `prompt "summarize" description`, `prompt "login" argument creds description`. Every corpus rule (INJ, DATA, POL, TOOL) gets it; `injection.ts` does not add the name itself, so it is not duplicated. Entries without a prompt name keep the old `prompt.description`. |
| R012 (rest) | 5391b0f (wave 1, F030) | Already done: `closeProbeSession()` in `src/probe/network.ts` sends a best-effort `DELETE` with the received `Mcp-Session-Id` after the preflight, the initialize-mode Origin probes and the auth invalid-token probe. No new commit. |

## Deferred

| ID | Reason |
|---|---|
| R003 (rest) | needs src/connect.ts: publishing partial results of `runActive` / `runWireProbes` needs a sink in `Progress` and `stoppedSnapshot()` reading it (both in `connect.ts`); marking rules of the stopped phase as skipped also needs the phase-to-rule mapping fed from there. feature: partial results of the active and wire phases on `--max-duration`. |

## Existing tests changed

- `test/remediation-wp2-connect.test.ts`: the SRV-018 pino expectation now reads `6 non-JSON-RPC line(s) on stdout` (C003 follow-up).

## Notes for the merge

- Pre-existing failure, not from this package: `test/e2e-stdio.test.ts` "an 80 000-character description is truncated and reported" expects the markdown notice `tool run_sql`, but since 4ad7d4e (F127, markdown emphasis escaping) markdown prints `tool run\_sql`. The test expectation needs updating (owner of `test/e2e-stdio.test.ts` / WP9).
- `docs/design/spec.md` (§ corpus) could mention that prompt locations now carry the prompt name (F109); the SRV-018 wording change touches no docs.
