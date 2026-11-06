// Report model shared by all formats.
import { VERSION } from '../version.js';
import { CATALOG_DATE, catalogAgeDays } from '../catalog.js';
import { activePlatforms, authReason, type EngineResult } from '../rules/engine.js';
import type { ManualItem } from '../rules/manual.js';
import { platformSeverity, type Finding } from '../rules/types.js';
import { displayUrl } from '../rules/util/net.js';
import { hasUi, isStr } from '../rules/util/access.js';
import { uiResources } from '../rules/util/ui.js';
import type { Snapshot } from '../snapshot.js';
import { gate, gatedPlatforms, rootCauses, score, SCORE_VERSION, verdict, type FailOn, type Gate, type Verdict } from './score.js';

export interface Report {
  tool: { name: string; version: string; catalogDate: string; catalogAgeDays: number };
  startedAt: string;
  durationMs: number;
  snap: Snapshot;
  findings: Finding[];
  ignored: Finding[];
  /** Root causes on the score's basis, every platform, not the --target findings; JSON summary.rootCauses. */
  rootCauses: { errors: number; warnings: number };
  skipped: EngineResult['skipped'];
  rulesRun: number;
  manual: ManualItem[];
  failOn: FailOn;
  /** --fail-on-incomplete took effect: a partial check (not a failed connect, not a --max-duration stop) failed the
   *  run, so summary.failed is true, gate.reason names it, JUnit has an <error type="incomplete"> per suite and the
   *  GitHub partial-check annotation is an ::error (A10-01). */
  incompleteFails?: boolean;
  /** --fail-on-drift took effect (A01-01): a tool definition changed since --baseline, or the definitions could not be
   *  compared. summary.failed is true, gate.reason names it, the Result line reads FAIL, JUnit has a <failure
   *  type="drift"> per suite and GitHub an ::error naming the changed tools. Set by applyDrift. */
  driftFails?: { reason: string; tools: string[] };
  /** With --baseline: how many findings the baseline already had. Text and markdown then say that the score covers
   *  every finding and the counts and verdicts only the new ones (C-06); JSON and SARIF have summary.baselined. */
  baselined?: number;
  summary: {
    errors: number;
    warnings: number;
    info: number;
    /** null when the check is partial (coverage.toolLevel is not 'ok'). */
    score: number | null;
    /** Version of the score formula (2: per unique broken rule). */
    scoreVersion: number;
    verdicts: Partial<Record<'claude' | 'chatgpt', { verdict: Verdict; errors: number; warnings: number }>>;
    failed: boolean;
    /** Which platforms decided `failed` and why (spec is gated only with --fail-on-spec). */
    gate: Omit<Gate, 'failed'>;
    /** Since 1.2: how many rules threw (A13-02); absent when none. The verdicts are then those of a partial check and
     *  the score null, but coverage.toolLevel, `failed` and the exit code do not change (until 1.4). */
    internalErrors?: number;
  };
}

/** The --fail-on-drift outcome the CLI passes on (A01-01): whether the flag is set, the number of tool changes, why no
 *  comparison could be made, and the changed tools' names (the redacted report's). */
export interface DriftOutcome {
  failOn: boolean;
  changes: number;
  notCompared?: string;
  tools?: string[];
}

export const DRIFT_CHANGED = 'tool definitions changed since baseline (--fail-on-drift)';
export const DRIFT_NOT_COMPARED = 'tool definitions not compared (--fail-on-drift)';

/**
 * --fail-on-drift (A01-01): a change, or a comparison that could not be made, fails the report as it fails the exit
 * code (1): summary.failed, a gate.reason part, and `driftFails` for the Result line, JUnit and GitHub. A failed
 * connect (exit 3) or a --max-duration stop (exit 4) already says more and is left as it is. Returns the report.
 */
export function applyDrift(r: Report, d: DriftOutcome | undefined): Report {
  if (!d?.failOn || (!d.changes && !d.notCompared) || r.snap.fatal || r.snap.limits?.stopped) return r;
  const reason = d.changes ? DRIFT_CHANGED : DRIFT_NOT_COMPARED;
  const g = r.summary.gate;
  g.reason = g.reason ? `${g.reason}; ${reason}` : reason;
  r.summary.failed = true;
  r.driftFails = { reason, tools: d.changes ? d.tools ?? [] : [] };
  return r;
}

/** In a listing-only run, why a platform was not checked: its listing input was not given (A10-02). */
export function uncheckedPlatform(snap: Snapshot, p: 'claude' | 'chatgpt'): string | undefined {
  if (snap.target.kind !== 'listing') return undefined;
  if (p === 'claude') return snap.listing?.plugin ? undefined : 'not checked: no --plugin-dir';
  return snap.listing?.openai ? undefined : 'not checked: no --openai-manifest';
}

export interface BuildOptions {
  /** --fail-on-drift and the comparison with --baseline (A01-01); the CLI calls applyDrift itself once it has compared. */
  drift?: DriftOutcome;
  /** With --baseline: the number of known findings (C-06). */
  baselined?: number;
}

export function buildReport(snap: Snapshot, result: EngineResult, manual: ManualItem[], failOn: FailOn, startedAt: Date, durationMs: number, failOnSpec = false, failOnIncomplete = false, opts: BuildOptions = {}): Report {
  const f = result.findings;
  const { failed, ...gated } = gate(f, failOn, gatedPlatforms(snap.options.target, failOnSpec));
  // A failed connect is exit 3 whatever the gate says: "add --fail-on-spec" would be advice for a run that already failed (A10-07).
  const g = snap.fatal ? { ...gated, notGated: null } : gated;
  const complete = snap.coverage.toolLevel === 'ok';
  // A rule that threw checked nothing (A13-02): the report is partial, as when tool-level checks could not run, but
  // coverage.toolLevel, `failed`, --fail-on-incomplete and the exit code stay as they are (1.2; gating comes in 1.4).
  const internalErrors = result.internalErrors ?? 0;
  const verdicts: Report['summary']['verdicts'] = {};
  // A failed connect (exit 3) checked nothing, a --max-duration stop or an exhausted snapshot budget not everything: INCOMPLETE whatever the findings say.
  // In a listing-only run a platform whose listing input was not given checked nothing either (A10-02).
  for (const p of activePlatforms(snap.options.target)) {
    if (p !== 'spec') verdicts[p] = verdict(f, p, complete && !internalErrors && !uncheckedPlatform(snap, p), !!snap.fatal || !!snap.limits?.stopped || !!snap.limits?.budgetExhausted);
  }
  // --fail-on-incomplete: a partial check that still finished fails the run, and the gate says why (A10-01). Exit 3
  // (no connect) and exit 4 (a stop) already fail it with their own cause.
  const incompleteFails = failOnIncomplete && !complete && !snap.fatal && !snap.limits?.stopped;
  if (incompleteFails) {
    const why = `partial check: ${snap.coverage.toolLevel} (--fail-on-incomplete)`;
    g.reason = g.reason ? `${g.reason}; ${why}` : why;
  }
  const report: Report = {
    tool: { name: 'mcp-review-check', version: VERSION, catalogDate: CATALOG_DATE, catalogAgeDays: catalogAgeDays(startedAt) },
    startedAt: startedAt.toISOString(), durationMs, snap,
    findings: f, ignored: result.ignored, rootCauses: rootCauses(result.scored ?? f), skipped: result.skipped, rulesRun: result.rulesRun, manual, failOn, incompleteFails,
    ...(opts.baselined ? { baselined: opts.baselined } : {}),
    summary: {
      errors: f.filter((x) => x.severity === 'error').length,
      warnings: f.filter((x) => x.severity === 'warning').length,
      info: f.filter((x) => x.severity === 'info').length,
      // Exit 3 (no connect) and exit 4 (a --max-duration stop) are failed runs whatever the gate says. An exhausted snapshot
      // budget is a partial check like a missing token: `failed` follows the --fail-on gate (--fail-on-incomplete is the CLI's).
      score: complete && !internalErrors && snap.target.kind !== 'listing' ? score(result.scored ?? f) : null, scoreVersion: SCORE_VERSION, verdicts, failed: failed || incompleteFails || !!snap.fatal || !!snap.limits?.stopped, gate: g,
      ...(internalErrors ? { internalErrors } : {}),
    },
  };
  return applyDrift(report, opts.drift);
}

/** The target for display: secret query values and URL userinfo are redacted. */
export function targetLabel(snap: Snapshot): string {
  if (snap.target.kind === 'listing') return 'listing-only (no server checked)';
  return snap.target.kind === 'http' ? displayUrl(snap.target.urlAsEntered) : `stdio:${[snap.target.command, ...snap.target.args].join(' ')}`;
}

/** "claude, spec, chatgpt: warning": platforms whose own severity is below the finding's are annotated. */
export function platformLabel(f: Finding): string {
  return f.platforms.map((p) => (platformSeverity(f, p) !== f.severity ? `${p}: ${platformSeverity(f, p)}` : p)).join(', ');
}

/** Control and format characters, and the Unicode line and paragraph separators, except tab. */
const HIDDEN = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/**
 * Text for a terminal, a CI log or a markdown file: every control or format character but a tab (ESC, CR, LF, BEL,
 * C1, bidi overrides, zero-width) shown as \u{..}, so text the server chose can not recolour, erase or reorder the
 * report, add a hyperlink, or start a line of its own (a GitHub workflow command).
 */
export function visibleText(s: string): string {
  return s.replace(HIDDEN, (ch) => (ch === '\t' ? ch : `\\u{${ch.codePointAt(0)!.toString(16).toUpperCase()}}`));
}

/**
 * A line of a CI log with no GitHub workflow command in it: a leading `::` (the v2 syntax) becomes `\u{3A}:` and every
 * legacy `##[` (the v1 syntax, which the runner finds anywhere in a line) becomes `#\u{23}[`. For whole report lines
 * that may already hold ANSI colour; server text inside them must have gone through visibleText first.
 */
export function neutralizeCommands(line: string): string {
  return line.replace(/^(\s*):(?=:)/, '$1\\u{3A}').replace(/##\[/g, '#\\u{23}[');
}

/** Server text for a CI log or a workflow-command field: visibleText, and no legacy `##[` command anywhere. */
export function ciSafeText(s: string): string {
  return visibleText(s).replace(/##\[/g, '#\\u{23}[');
}

/** Server text printed as one line of its own on stdout or stderr (e.g. --verbose server stderr): ciSafeText, and no leading `::`. */
export function ciSafeLine(s: string): string {
  return neutralizeCommands(visibleText(s));
}

/** Above this many findings a JSON or SARIF report is printed without indentation: about half the size and memory (A09-05). */
export const COMPACT_FINDINGS = 10_000;

/** Characters JSON.stringify leaves raw that a terminal or a CI log acts on or reorders (A07-03). A format character
 *  outside the BMP (a tag character) is written as its two escaped UTF-16 code units. */
const JSON_HIDDEN = /[\u007F-\u009F\p{Cf}\u2028\u2029]/u;
const JSON_HIDDEN_ALL = new RegExp(JSON_HIDDEN.source, 'gu');
const jsonEscape = (ch: string) => [...Array(ch.length).keys()].map((i) => `\\u${ch.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')}`).join('');

/** A JSON or SARIF report too large for one string (V8 caps a string at about 512 MiB): a clear message, not a crash. */
export class ReportTooLargeError extends Error {
  override name = 'ReportTooLargeError';
}

/**
 * A JSON document of the report (`--format json`, `--format sarif`), indented unless it has more than
 * COMPACT_FINDINGS findings. A RangeError of JSON.stringify (a server with some 100 000 tools) becomes a
 * ReportTooLargeError that says how to narrow the report. A legacy `##[` workflow command (which the runner finds
 * anywhere in a stdout line) can only sit inside a JSON string, so it is written `#\u0023[`: the same string to
 * every JSON parser, but no command in a CI log.
 */
export function stringifyReport(doc: unknown, format: 'json' | 'sarif', findings: number): string {
  try {
    const out = JSON.stringify(doc, null, findings > COMPACT_FINDINGS ? undefined : 2) + '\n';
    // DEL, C1 controls (U+009B is CSI to a terminal that honours C1), format characters (bidi overrides, zero-width) and
    // the line and paragraph separators can only sit inside a JSON string: written \uXXXX, the same value (A07-03).
    const shown = JSON_HIDDEN.test(out) ? out.replace(JSON_HIDDEN_ALL, jsonEscape) : out;
    return shown.includes('##[') ? shown.replace(/##\[/g, '#\\u0023[') : shown;
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    throw new ReportTooLargeError(`the ${format} report (${findings} findings) is too large to write as one document (${e.message}); `
      + 'narrow it with --ignore <rule id> or --target, or use --format text, which groups repeated findings');
  }
}

/** The name in the plugin.json of --plugin-dir, else of --openai-manifest, in a listing-only run (I-A10-5). */
function listingName(snap: Snapshot): string | undefined {
  const name = (j: unknown) => (j && typeof j === 'object' && !Array.isArray(j) && isStr((j as Record<string, unknown>).name) && (j as Record<string, unknown>).name !== '' ? (j as Record<string, string>).name : undefined);
  return name(snap.listing?.plugin?.manifest?.json) ?? name(snap.listing?.openai?.manifest?.json);
}

/** The server's title or name and version; in a listing-only run "Plugin <name>" from the manifest (I-A10-5). */
export function serverName(snap: Snapshot): string {
  if (snap.target.kind === 'listing') return `Plugin ${listingName(snap) ?? '(no name)'}`;
  const si = snap.serverInfo ?? {};
  const name = isStr(si.title) ? si.title : isStr(si.name) ? si.name : 'MCP server';
  return isStr(si.version) ? `${name} ${si.version}` : name;
}

export function authSummary(snap: Snapshot): string {
  const a = snap.authProbe;
  if (!a) return snap.target.kind === 'stdio' ? 'n/a' : 'none';
  if (!a.prm && !a.legacyDiscovery) return `${a.challenge?.status ?? 401} without OAuth discovery`;
  const m = a.as[0]?.json ?? {};
  const bits: string[] = a.prm ? [] : ['legacy discovery, no PRM'];
  if (m.client_id_metadata_document_supported === true) bits.push('CIMD');
  if (isStr(m.registration_endpoint)) bits.push('DCR');
  if (Array.isArray(m.code_challenge_methods_supported) && m.code_challenge_methods_supported.includes('S256')) bits.push('S256');
  return `OAuth${bits.length ? ` (${bits.join(', ')})` : ''}`;
}

export function counts(snap: Snapshot): string {
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
  const ui = hasUi(snap) ? uiResources(snap).length : 0;
  return [n(snap.tools.length, 'tool'), n(snap.resources.length, 'resource'), n(snap.prompts.length, 'prompt'), n(ui, 'UI resource')].join(' · ');
}

export function skippedSummary(skipped: EngineResult['skipped']): string {
  const by = new Map<string, number>();
  for (const s of skipped) by.set(s.reason, (by.get(s.reason) ?? 0) + 1);
  const parts = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, c]) => `${c} ${r}`);
  return `${skipped.length} skipped${parts.length ? ` (${parts.join('; ')}${by.size > 3 ? '; …' : ''})` : ''}`;
}

export function eraLine(snap: Snapshot): string {
  return `${snap.era}${snap.protocolVersion ? ` (${snap.protocolVersion})` : ''}`;
}


export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** "87/100", or "n/a (partial check: auth-required)" when tool-level checks did not run, or "n/a (internal error: 1
 *  rule threw)" when only a rule that threw made the check partial (A13-02). */
export function scoreLabel(r: Report): string {
  if (r.snap.target.kind === 'listing') return 'n/a (listing-only)';
  if (r.summary.score !== null) return `${r.summary.score}/100`;
  if (r.snap.coverage.toolLevel === 'ok' && r.summary.internalErrors) return `n/a (internal error: ${plural(r.summary.internalErrors, 'rule')} threw)`;
  return `n/a (partial check: ${r.snap.coverage.toolLevel})`;
}

/** Text and markdown (C-06): with known findings from --baseline the score covers every finding while the counts and
 *  verdicts are of the new ones, so the score says so: "0/100 (all findings, 50 known)". */
export function scoreText(r: Report): string {
  return `${scoreLabel(r)}${r.baselined && r.summary.score !== null ? ` (all findings, ${r.baselined} known)` : ''}`;
}

/** "1 error · 2 warnings · 3 info" for the text and markdown summary (I-A07-4); "new" before each count with known
 *  findings from --baseline (C-06). */
export function countsText(r: Report, info = true): string {
  const s = r.summary;
  const nw = r.baselined ? 'new ' : '';
  return [plural(s.errors, `${nw}error`), plural(s.warnings, `${nw}warning`), ...(info ? [`${s.info} ${nw}info`] : [])].join(' · ');
}

/**
 * A platform's verdict for text and markdown: "BLOCKED (1 error)", "NEEDS ATTENTION (2 warnings)", "INCOMPLETE (not
 * checked: no --openai-manifest)" (A10-02). With known findings from --baseline a clean verdict reads "NO NEW
 * AUTOMATED BLOCKERS" (C-06); the JSON and SARIF value stays "NO AUTOMATED BLOCKERS" (a closed enum).
 */
export function verdictText(r: Report, p: 'claude' | 'chatgpt'): string | undefined {
  const x = r.summary.verdicts[p];
  if (!x) return undefined;
  const label = x.verdict === 'NO AUTOMATED BLOCKERS' && r.baselined ? 'NO NEW AUTOMATED BLOCKERS' : x.verdict;
  const count = x.errors ? plural(x.errors, 'error') : x.warnings ? plural(x.warnings, 'warning') : '';
  const unchecked = x.verdict === 'INCOMPLETE' ? uncheckedPlatform(r.snap, p) : undefined;
  const why = [count, unchecked].filter(Boolean).join('; ');
  return `${label}${why ? ` (${why})` : ''}`;
}

/** "FAIL (--fail-on error) · claude: 2 errors (TOOL-006, TOOL-011)", then the not-gated spec note; `causes` (--quiet
 * drops the header notices) adds the connect failure cause or why the check is partial. */
export function resultLine(r: Report, fail = (x: string) => x, causes = false): string {
  const cov = r.snap.coverage;
  // Exit 3: nothing could be checked, so the run never reads PASS, whatever the gate says.
  if (r.snap.fatal) return `${fail('FAIL')} (could not connect${causes ? `: ${cov.reason ?? r.snap.fatal}` : ''})`;
  // A stop after the handshake (exit 3): the phase, then the findings that reached the threshold before it.
  const stop = r.snap.limits?.stopped;
  if (stop) return [`${fail('INCOMPLETE')} (stopped at --max-duration during ${stop.phase})`, r.summary.gate.reason, r.summary.gate.notGated].filter(Boolean).join(' · ');
  const budget = r.snap.limits?.budgetExhausted;
  if (budget) return [`${fail('INCOMPLETE')} (snapshot budget exhausted (during ${budget.phase}))`, r.summary.failed ? r.summary.gate.reason : null, r.summary.gate.notGated].filter(Boolean).join(' · ');
  const s = r.summary;
  const why = authReason(r.snap);
  // --fail-on-incomplete puts the partial check in gate.reason (A10-01), and --fail-on-drift its drift (A01-01): each is
  // said there once, and when no finding reached the gate the head names the flags that failed the run, not --fail-on.
  const incomplete = `partial check: ${cov.toolLevel} (--fail-on-incomplete)`;
  let reason = s.failed ? s.gate.reason : undefined;
  const flags = [r.incompleteFails ? '--fail-on-incomplete' : '', r.driftFails ? '--fail-on-drift' : ''].filter(Boolean);
  const byFlags = s.failed && flags.length > 0 && !gate(r.findings, r.failOn, s.gate.platforms).failed;
  const head = byFlags
    ? `${fail('FAIL')} (${flags.join(', ')})`
    : `${s.failed ? fail('FAIL') : 'PASS'} (--fail-on ${r.failOn}${s.gate.platforms.includes('spec') ? ', --fail-on-spec' : ''})`;
  const said = !!reason?.includes(incomplete);
  if (said) {
    const cause = causes && why ? why : '';
    reason = byFlags
      ? reason!.replace(incomplete, `partial check: ${cov.toolLevel}${cause ? ` (${cause})` : ''}`)
      : reason!.replace(incomplete, `partial check: ${cov.toolLevel} (${cause ? `${cause}; ` : ''}--fail-on-incomplete)`);
  }
  // The head already names --fail-on-drift: the reason keeps what drifted.
  if (byFlags && r.driftFails) reason = reason!.replace(r.driftFails.reason, r.driftFails.reason.replace(/ \(--fail-on-drift\)$/, ''));
  const partial = causes && cov.toolLevel !== 'ok' && !said ? `partial check: ${cov.toolLevel}${why ? ` (${why})` : ''}` : null;
  return [head, reason, s.gate.notGated, partial].filter(Boolean).join(' · ');
}
