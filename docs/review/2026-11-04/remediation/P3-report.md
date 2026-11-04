# P3 Probes: remediation report (1.0.1)

Base: `5c521cb`. Files changed: `src/probe/active.ts`, `src/probe/wire.ts`, `src/probe/auth.ts`, new `test/r3-p3-probes.test.ts`. No existing test was changed.

## Fixed

### A03-01: the --active write-verb filter misses mutating verbs, inflections and glued names

- `src/probe/active.ts`: a new `hasWriteVerb(name)` is used by `isSafeToCall`.
  - It still skips every name that 1.0.0 skipped: the exact `WRITE_VERBS` token check runs first and is unchanged.
  - A name whose first token is a READ verb (`get_commit`, `list_commits`, `get_setting`) stops there, as in 1.0.0. That keeps read tools named after nouns callable.
  - Every other name gets three more checks:
    - (a) A probe-only verb set: exec, kill, stop, restart, reboot, shutdown, deploy, push, commit, apply, install, uninstall, rollback, clear, flush, unlink, rm, notify, reply, lock, unlock, grant, ban, block, enable, activate, subscribe, pause, resume, toggle.
    - (b) Inflected forms. `-ed` and `-ing` are stripped from any token, with an undoubled consonant and a restored `-e`. `-s` and `-es` are stripped only from the first token (`deletes_file`), because a later token with `-s` is usually a plural noun (`recent_posts`).
    - (c) A token that starts with a HARD_DESTRUCTIVE verb (`DELETEFILE`, `deletefile`). Glued nouns (`dropdown`, `droplet`, `dropbox`, `dropzone`) are exempt.
- The extra verbs are probe-local. `src/rules/lexicon.ts` is not touched, so no rule sees a bigger vocabulary, and the change can only make `--active` call fewer tools (patch-safe).
- Checked against every tool name in `test/fixtures`: no fixture name changes verdict.
- Tests: `A03-01 skips verbs missing from the rules vocabulary, inflected verbs and glued all-caps names`, `A03-01 keeps calling what 1.0.0 called when the name starts with a read verb, and plain read tools`, `A03-01 only narrows the 1.0.0 filter: a name 1.0.0 skipped is still skipped`.

### A03-02: the subscriptions/listen and GET probes wait a fixed 5 s

- `src/probe/wire.ts`: a new `STREAM_PROBE_MS = 5000` constant. Both probes now wait `Math.min(timeoutMs, STREAM_PROBE_MS)`.
- Patch-safety: an aborted probe has no `status`. SPEC-005, SPEC-015 and SRV-006 skip an exchange without a status, so a shorter wait can only remove an observation, never add a finding.
- Tests:
  - `A03-02 subscriptions/listen waits min(--timeout, 5 s)` (fake modern client).
  - `A03-02 a GET that never sends headers is cut off at --timeout 1000, not after 5 s` (a real local server that hangs on GET; it measured 5022 ms before the fix).

### A03-03: --active-auth never reports the client_id it registered (partly fixed, see integratorNotes)

- `src/probe/auth.ts`: a new `dcrClientNotice(probe, redactor?)` returns one stderr line:
  - `Notice: --active-auth registered DCR client client_id=<id> at <registration_endpoint>; delete it if your authorization server does not expire unused clients.`
  - When the registration answered 2xx without a client_id: `... answered <status> without a client_id; check your authorization server for a client named mcp-review-check.`
  - Nothing when there was no DCR or it was rejected.
- Safety of the line:
  - Only client_id and the recorded endpoint URL are printed. client_secret and registration_access_token never are.
  - The run's secret values are scrubbed (before escaping) when a redactor is passed.
  - Server-chosen text is limited to printable ASCII: everything else is shown as `\u{..}`, so there is no ESC, no newline and no bidi character, and no injected `::workflow-command` line.
  - Each value is capped at 200 characters.
- Tests: `A03-03 one notice line with the client_id and the registration endpoint` (auth-server fixture, `client-123`), `A03-03 no line without --active-auth or when the registration was rejected`, `A03-03 a server-chosen client_id cannot inject control characters or a line, and run secrets are scrubbed` (SYNTH token assembled at runtime).
- Not done here: printing the line. That needs `src/cli.ts` (owned by P1). See the integrator notes.
- Not done in 1.0.1: adding `authProbe.active.clientId` to the JSON report. Under the README stability policy, new JSON fields arrive in minor releases, so this is proposed for 1.1.0.

## notFixed

- None fully unfixed. The A03-03 wiring into `src/cli.ts` is outside P3's files (see below). The JSON field is deferred to 1.1.0 by the stability policy.

## Integrator notes

- `src/cli.ts`: add `import { dcrClientNotice } from './probe/auth.js';`. After `buildSnapshot` returns, and after the interrupted check (around the `unusedToolArgs` line), add:
  `if (values['active-auth']) stderr += dcrClientNotice(snap.authProbe, redactor) ?? '';`
  Use the strong `redactor` that the report uses.
- `SECURITY.md:38`: the docs can say the registered client_id is printed on stderr.
- 1.1.0: add `authProbe.active.clientId` (or `activeAuth.clientId`) to `src/report/json.ts`.

## Proposed CHANGELOG lines (1.0.1)

Security
- `--active` no longer calls a tool annotated `readOnlyHint: true` whose name has a mutating verb outside the rules' word list (exec, kill, restart, deploy, push, clear, unlink, rm, ...), an inflected write verb (`deletes_file`, `stopped_jobs`) or a glued destructive name (`DELETEFILE`). Names that start with a read verb are filtered as in 1.0.0. (A03-01)

Fixed
- The GET and `subscriptions/listen` probes wait at most `--timeout` (still capped at 5 s) instead of a fixed 5 s. (A03-02)
- `--active-auth` prints the `client_id` of the DCR client it registered, and the registration endpoint, on stderr, so you can delete it as SECURITY.md advises. (A03-03)

## Proposed spec paragraph (spec.md §2.9, under "Call only tools with ...")

> A tool name has a write verb when a token of it is in WRITE_VERBS. If the first token is not a READ verb, the name also has a write verb when a token is in the probe-only list (exec, kill, stop, restart, reboot, shutdown, deploy, push, commit, apply, install, uninstall, rollback, clear, flush, unlink, rm, notify, reply, lock, unlock, grant, ban, block, enable, activate, subscribe, pause, resume, toggle), when a token is an `-ed`/`-ing` form of such a verb (or an `-s`/`-es` form in the first token), or when a token starts with a HARD_DESTRUCTIVE verb (except dropdown, droplet, dropbox, dropzone). The GET and subscriptions/listen probes wait min(--timeout, 5 s) for the status line. With --active-auth, the CLI prints the registered client_id and the registration endpoint on stderr.

## Tests run

- `npm run typecheck`: passes. `npm run build`: passes.
- `npx vitest run test/r3-p3-probes.test.ts`: 8/8 pass. Against the unfixed `src/probe` (checked by reverting it), 7 of the 8 fail. The one that passes there only checks that the read-verb names stay callable.
- `npx vitest run test/r3-p3-probes.test.ts test/remediation-w3b-probe-rules.test.ts test/remediation-wp3-probe.test.ts test/rules/runtime.test.ts test/unit-wire.test.ts test/util.test.ts test/auth-probe.test.ts test/remediation-wp7-auth-spec-srv.test.ts`: 8 files, 159/159 pass.
- `npx vitest run test/e2e-http.test.ts test/max-duration.test.ts test/remediation-wp8-tools-schema-rt.test.ts`: 3 files, 97/97 pass.
