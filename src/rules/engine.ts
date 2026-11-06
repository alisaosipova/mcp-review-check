// Rule engine: needs evaluation, platform filtering, severity, ignore, sorting (§1.2, §4.2).
import { PHASES, type Platform, type Severity, type Snapshot, type TargetOpt } from '../snapshot.js';
import { hasUi, safeStr } from './util/access.js';
import { LISTING_NEEDS, maxSeverity, NO_TRANSPORT_NEEDS, SEVERITY_RANK, type Finding, type Need, type Rule } from './types.js';

export function activePlatforms(target: TargetOpt): Platform[] {
  if (target === 'claude') return ['claude', 'spec'];
  if (target === 'chatgpt') return ['chatgpt', 'spec'];
  return ['claude', 'chatgpt', 'spec'];
}

const LEGACY_ERAS = new Set(['legacy', 'dual', 'sse-legacy']);
const MODERN_ERAS = new Set(['modern', 'dual']);

function listOk(snap: Snapshot, key: string): boolean {
  const m = snap.listMeta[key];
  return !!m && !m.error;
}

export function authReason(snap: Snapshot): string | undefined {
  if (snap.coverage.toolLevel === 'auth-required') return 'server requires auth; pass --bearer <token>';
  if (snap.coverage.toolLevel === 'token-rejected') return 'token rejected (401)';
  if (snap.coverage.toolLevel === 'connect-failed') return CONNECT_REASON;
  if (snap.coverage.toolLevel === 'list-failed') return snap.coverage.reason ?? 'tools/list failed';
  if (snap.coverage.toolLevel === 'stopped') return snap.limits?.budgetExhausted ? `${BUDGET_REASON} (during ${snap.limits.budgetExhausted.phase})` : STOPPED_REASON;
  return undefined;
}

/** The skip reason of a rule that needs the server's answers when no transport worked (A10-05). */
export const CONNECT_REASON = 'could not connect';

/** The skip reason of every rule that needs a server in a listing-only run. */
export const LISTING_ONLY_REASON = 'no server target (listing-only run)';

/** The skip reason of a rule that throws (A13-02), followed by the error message. */
export const INTERNAL_REASON = 'internal error';

/** No transport worked: nothing the server would have answered is there (A10-05). */
export const noTransport = (snap: Snapshot): boolean => !!snap.fatal || snap.coverage.toolLevel === 'connect-failed';

/** Needs about the server's answers: on a run without a working transport they all read "could not connect" (or the
 *  auth reason), not a need-specific reason such as "server did not request auth" or "era unknown" (A04-06). An auth
 *  probe that ran is evidence of its own (a 403 challenge with no handshake): `auth` is then met. */
const SERVER_NEEDS: ReadonlySet<Need> = new Set(['auth', 'legacy', 'modern', 'ui', 'tools', 'resources', 'prompts', 'handshake']);

const isListingNeed = (n: Need) => LISTING_NEEDS.includes(n);

/** Returns undefined when the need is met, otherwise the skip reason. */
export function unmetNeed(snap: Snapshot, need: Need): string | undefined {
  const isHttp = snap.target.kind === 'http';
  if (snap.target.kind === 'listing' && !isListingNeed(need)) return LISTING_ONLY_REASON;
  if (need === 'auth' && !isHttp) return 'stdio target';
  if (SERVER_NEEDS.has(need) && noTransport(snap) && !(need === 'auth' && snap.authProbe)) return authReason(snap) ?? CONNECT_REASON;
  switch (need) {
    case 'handshake':
      return snap.initializeRaw !== undefined || snap.discoverRaw !== undefined ? undefined : authReason(snap) ?? 'no handshake result';
    case 'url':
      return isHttp ? undefined : 'stdio target';
    case 'transport':
      // A stdio target is judged only when it did not start (the failure is the finding); one that ran has no HTTP transport to judge.
      return isHttp || snap.fatal ? undefined : 'stdio target';
    case 'tools':
    case 'resources':
    case 'prompts':
      return listOk(snap, need) ? undefined : authReason(snap) ?? `${need}/list not available`;
    case 'ui':
      return hasUi(snap) ? undefined : authReason(snap) ?? 'no UI resources';
    case 'http':
      return isHttp ? undefined : 'stdio target';
    case 'stdio':
      return isHttp ? 'HTTP target' : undefined;
    case 'auth':
      return snap.authProbe ? undefined : isHttp ? 'server did not request auth' : 'stdio target';
    case 'legacy':
      // By the era alone, for stdio too: a stdio connect is an initialize handshake, so its era is 'legacy'.
      return LEGACY_ERAS.has(snap.era) ? undefined : `era ${snap.era}`;
    case 'modern':
      return MODERN_ERAS.has(snap.era) ? undefined : `era ${snap.era} (not 2026-07-28)`;
    case 'active':
      if (!snap.options.active) return 'needs --active';
      // Calls made before a --max-duration stop are evidence: the rule runs on them (and cannot pass, see runRules).
      if (snap.active && snap.coverage.toolLevel === 'stopped') return undefined; // also after a budget stop
      return snap.active ? authReason(snap) : authReason(snap) ?? 'no active calls made';
    case 'active-auth':
      if (!snap.options.activeAuth) return 'needs --active-auth';
      return snap.authProbe?.active ? undefined : 'auth probe did not run';
    case 'plugin-dir':
      return snap.listing?.plugin ? undefined : 'needs --plugin-dir';
    case 'openai-manifest':
      return snap.listing?.openai ? undefined : 'needs --openai-manifest';
  }
}

/** The skip reason of a rule with these needs, or undefined when it runs. In a listing-only run a rule without a
 *  listing need reads the server, so it is skipped whatever its other needs (also with none); computed here only (I-A13-3). */
export function needsReason(snap: Snapshot, needs: readonly Need[]): string | undefined {
  if (snap.target.kind === 'listing' && !needs.some(isListingNeed)) return LISTING_ONLY_REASON;
  for (const n of needs) {
    const r = unmetNeed(snap, n);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** The skip reason of a rule that read data of a phase a --max-duration stop cut short and found nothing in it. */
export const STOPPED_REASON = 'stopped by --max-duration';
/** The same for a run whose snapshot byte budget ran out (limits.budgetExhausted, F146). */
export const BUDGET_REASON = 'snapshot budget exhausted';

/** Data gathered over the whole run (from every exchange): partial whenever the run was stopped. */
const RUN_WIDE = 'whole run';
type Unfinished = Set<string>;

/** The phases a stopped run (--max-duration, or the snapshot budget) did not finish (limits.stopped.unfinished, or for an older snapshot the stop phase and
 *  every later one), plus RUN_WIDE; undefined for a run that was not stopped. */
export function unfinishedPhases(snap: Snapshot): Unfinished | undefined {
  const s = snap.limits?.stopped ?? snap.limits?.budgetExhausted;
  if (!s) return undefined;
  const at = PHASES.indexOf(s.phase as (typeof PHASES)[number]);
  return new Set([...(s.unfinished ?? (at < 0 ? [s.phase] : PHASES.slice(at))), RUN_WIDE]);
}

const LISTS: Record<string, string> = { tools: 'tools', resources: 'resources', resourceTemplates: 'resourceTemplates', prompts: 'prompts' };
/** Set as a whole when their step finished: missing means not observed (yet). */
const ATOMIC: Record<string, string> = { toolsRelist: 'tools re-list', toolsFreshConnection: 'tools re-list', toolsWithoutUi: 'text-only tools/list' };
/** Filled step by step: partial while their phase runs. */
const GROWING: Record<string, string> = { active: 'active tool calls' };
/** On the snapshot while their phase runs, but judged only once it finished: a rule that reads one of an unfinished
 *  phase is skipped even when it found something (a partial auth probe has no PRM yet, which is no AUTH-004 finding). */
const PARTIAL: Record<string, string> = { authProbe: 'auth probe' };
/** notifications (SPEC-024) and stdio (SRV-018: non-JSON-RPC stdout) are collected from every exchange too (A04-02). */
const GROWING_TRANSPORT: Record<string, string> = { observedErrors: RUN_WIDE, modernResults: RUN_WIDE, notifications: RUN_WIDE, stdio: RUN_WIDE, tls: 'auth probe' };

/**
 * A read-only view of a stopped run's snapshot that notes in `hit` every unfinished phase whose data a rule reads:
 * a list, probe, listing entry or UI read that is missing, an enumeration of those maps, or data that grows over a
 * phase (active calls, observed errors, 2026-07-28 results). Only the top level, `transport` and the keyed maps are
 * wrapped; everything below them is the snapshot's own objects. The exchange log and the latency samples are left out:
 * the rules judge them on the requests that were made.
 */
function tracked(snap: Snapshot, unfinished: Unfinished, hit: Set<string>, partial: Set<string> = new Set()): Snapshot {
  const note = (phase: string) => { if (unfinished.has(phase)) hit.add(phase); };
  /** A map filled entry by entry during `phase`: a missing entry or a walk over all of them depends on it. */
  const keyed = <T extends object>(target: T, phase: string): T => new Proxy(target, {
    get(t, k, r) { const v = Reflect.get(t, k, r); if (typeof k === 'string' && v === undefined) note(phase); return v; },
    has(t, k) { const v = Reflect.has(t, k); if (!v) note(phase); return v; },
    getOwnPropertyDescriptor(t, k) { const d = Reflect.getOwnPropertyDescriptor(t, k); if (!d) note(phase); return d; },
    ownKeys(t) { note(phase); return Reflect.ownKeys(t); },
  });
  const transport = new Proxy(snap.transport, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (k === 'probes') return keyed(v as object, 'wire probes');
      if (typeof k === 'string' && GROWING_TRANSPORT[k]) note(GROWING_TRANSPORT[k]);
      return v;
    },
  });
  return new Proxy(snap, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (typeof k !== 'string') return v;
      if (k === 'transport') return transport;
      if (k === 'listMeta') return keyed(v as object, 'listing');
      if (k === 'resourceReads') return keyed(v as object, 'UI resource reads');
      if (LISTS[k] && !t.listMeta[LISTS[k]]) note('listing');
      else if (ATOMIC[k] && v === undefined) note(ATOMIC[k]);
      else if (GROWING[k]) note(GROWING[k]);
      else if (PARTIAL[k] && unfinished.has(PARTIAL[k])) { note(PARTIAL[k]); partial.add(PARTIAL[k]); }
      return v;
    },
  });
}

export interface EngineResult {
  findings: Finding[];
  ignored: Finding[];
  skipped: Array<{ ruleId: string; reason: string }>;
  rulesRun: number;
  /** Findings (not ignored) over every platform whatever --target: the score basis, one number per server. */
  scored?: Finding[];
  /** Set when `deadline` passed during the rules (A09-04): the first rule not run and how many were not run. */
  stopped?: { atRule: string; rulesNotRun: number };
  /** How many rules threw (A13-02), whatever --target: each is skipped with "internal error: <message>", not counted
   *  as run, and leaves an INTERNAL info finding. Set only when not 0. buildReport makes a report with it partial (the
   *  verdicts of a partial check, score null, JSON summary.internalErrors) without changing coverage.toolLevel,
   *  summary.failed or the exit code (spec §5.2). */
  internalErrors?: number;
}

export interface EngineOptions {
  ignore?: string[];
  /** --max-duration (A09-04): a time on the `now` clock; the rules not started by then are skipped with STOPPED_REASON.
   *  Checked between rules, so a rule that is running when it passes runs to its end. */
  deadline?: number;
  /** The clock of `deadline` (default performance.now, the clock the CLI starts the run on). */
  now?: () => number;
}

/** The finding a rule that throws becomes, with the text SARIF gives its rule entry. */
export const INTERNAL = { id: 'INTERNAL', title: 'Internal rule error', fix: 'Please report this bug.' } as const;

/** The tool or resource a finding is about, "(empty name)" for one the server named "", or "server". */
export function subjectOf(f: Pick<Finding, 'tool' | 'resource'>): string {
  const s = f.tool ?? f.resource;
  return s === undefined ? 'server' : s || '(empty name)';
}

/** By UTF-16 code units: the same order on every machine, whatever the locale or the ICU build of Node. */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Severity first, then rule, subject and message; the order of JSON and SARIF results and of the SARIF repeat numbers. */
export function sortFindings(list: Finding[]): Finding[] {
  return list.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      byCodeUnit(a.ruleId, b.ruleId) ||
      byCodeUnit(subjectOf(a), subjectOf(b)) ||
      byCodeUnit(a.message, b.message),
  );
}

/** The message of anything a rule threw, without throwing itself (a thrown object can be hostile too). */
function errorMessage(err: unknown): string {
  try {
    return err instanceof Error ? safeStr(err.message) : safeStr(err);
  } catch {
    return 'unprintable error';
  }
}

export function runRules(snap: Snapshot, rules: Rule[], opts: EngineOptions = {}): EngineResult {
  const active = activePlatforms(snap.options.target);
  const ignore = new Set((opts.ignore ?? []).map((s) => s.toUpperCase()));
  const findings: Finding[] = [];
  const ignored: Finding[] = [];
  const scored: Finding[] = [];
  const skipped: EngineResult['skipped'] = [];
  let rulesRun = 0;
  const unfinished = unfinishedPhases(snap);
  const now = opts.now ?? (() => performance.now());
  let stopped: EngineResult['stopped'];
  let internalErrors = 0;

  for (const rule of rules) {
    const rulePlatforms = Object.keys(rule.severity) as Platform[];
    // A rule outside --target still runs for the score, but is reported as skipped and lists no findings.
    const applies = rulePlatforms.some((p) => active.includes(p));
    if (!applies) skipped.push({ ruleId: rule.id, reason: `not applicable to --target ${snap.options.target}` });
    // --max-duration ran out during the rules (A09-04): this rule and every later one did not run.
    if (!stopped && opts.deadline !== undefined && now() >= opts.deadline) stopped = { atRule: rule.id, rulesNotRun: 0 };
    if (stopped) {
      stopped.rulesNotRun++;
      if (applies) skipped.push({ ruleId: rule.id, reason: STOPPED_REASON });
      continue;
    }
    // `handshake` is a soft need: the rule runs without it, since some of its data exists before a handshake (observed
    // JSON-RPC errors, an SSE-only transport); finding nothing then is skipped with the need's reason, not passed.
    const reason = needsReason(snap, rule.needs.filter((n) => n !== 'handshake'));
    const soft = rule.needs.includes('handshake') ? unmetNeed(snap, 'handshake') : undefined;
    if (reason) {
      if (applies) skipped.push({ ruleId: rule.id, reason });
      continue;
    }
    let raw;
    const hit = new Set<string>();
    const partial = new Set<string>();
    try {
      raw = rule.check(unfinished ? tracked(snap, unfinished, hit, partial) : snap);
    } catch (err) {
      // A rule that threw checked nothing: skipped, not run (A13-02). Counted also for a rule outside --target, whose
      // findings the score is then short of; the INTERNAL finding stays for visibility (spec is always active).
      internalErrors++;
      const message = errorMessage(err);
      if (applies) skipped.push({ ruleId: rule.id, reason: `${INTERNAL_REASON}: ${message}` });
      findings.push({
        ruleId: INTERNAL.id, title: INTERNAL.title, severity: 'info', platforms: ['spec'],
        message: `${rule.id} threw: ${message}`, fix: INTERNAL.fix, docs: [],
      });
      continue;
    }
    // After a --max-duration stop a rule that read data of an unfinished phase keeps what it found, but finding nothing
    // there is no pass: it is skipped instead of counted as run.
    if ((hit.size && raw.length === 0) || partial.size) {
      if (applies) skipped.push({ ruleId: rule.id, reason: snap.limits?.budgetExhausted ? BUDGET_REASON : STOPPED_REASON });
      continue;
    }
    if (soft && raw.length === 0) {
      if (applies) skipped.push({ ruleId: rule.id, reason: soft });
      continue;
    }
    // Without a working transport only the rules that judge the URL, its DNS or the transport itself can pass (a `url` or
    // `transport` need): any other rule found nothing because it saw nothing.
    if (noTransport(snap) && raw.length === 0 && !rule.needs.some((n) => NO_TRANSPORT_NEEDS.includes(n))) {
      if (applies) skipped.push({ ruleId: rule.id, reason: authReason(snap) ?? CONNECT_REASON });
      continue;
    }
    if (applies) rulesRun++;
    for (const r of raw) {
      const platforms = r.platforms ?? rulePlatforms;
      // An explicit finding severity applies to all of its platforms; otherwise each platform keeps the rule's own level.
      const severityByPlatform: Partial<Record<Platform, Severity>> = {};
      for (const p of platforms) severityByPlatform[p] = r.severity ?? rule.severity[p] ?? 'info';
      const severity = maxSeverity(Object.values(severityByPlatform)) ?? 'info';
      const finding: Finding = {
        ruleId: rule.id, title: rule.title, severity, platforms, severityByPlatform, message: r.message,
        tool: r.tool, resource: r.resource, path: r.path, evidence: r.evidence,
        fix: r.fix ?? rule.fix, docs: r.docs ?? rule.sources,
      };
      if (!ignore.has(rule.id)) scored.push(finding);
      const mine = platforms.filter((p) => active.includes(p));
      if (mine.length === 0) continue;
      const own: Partial<Record<Platform, Severity>> = Object.fromEntries(mine.map((p) => [p, severityByPlatform[p]]));
      (ignore.has(rule.id) ? ignored : findings).push({ ...finding, platforms: mine, severityByPlatform: own, severity: maxSeverity(Object.values(own)) ?? 'info' });
    }
  }
  return {
    findings: sortFindings(findings), ignored: sortFindings(ignored), skipped, rulesRun, scored,
    ...(stopped ? { stopped } : {}), ...(internalErrors ? { internalErrors } : {}),
  };
}
