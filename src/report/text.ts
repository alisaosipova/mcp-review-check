// Default text report (§5.1).
import { subjectOf } from '../rules/engine.js';
import type { Finding } from '../rules/types.js';
import type { Severity } from '../snapshot.js';
import { AUTH_NOTICE, DISCLAIMER, LIST_FAILED_NOTICE, TOKEN_REJECTED_NOTICE } from './constants.js';
import { limitsNotice } from '../limits.js';
import { RULES } from '../rules/index.js';
import { DEPLOY } from '../rules/server.js';
import { annotations, isNonEmptyStr, toolName } from '../rules/util/access.js';
import { tokenize, toolKind } from '../rules/util/text.js';
import { driftCount, driftHeading, driftLines, driftSummary, type Drift } from './drift.js';
import { authSummary, counts, eraLine, neutralizeCommands, platformLabel, resultLine, scoreLabel, serverName, skippedSummary, targetLabel, visibleText, type Report } from './index.js';

export interface TextOptions {
  color: boolean;
  verbose: boolean;
  cta?: string; // ctaLine(), printed above the disclaimer
  checklist?: boolean; // the manual checklist in full
  quiet?: boolean; // findings (no info), Score, Result and the disclaimer
  drift?: Drift; // --baseline: the "Changed tool definitions" section after the findings
  failOnDrift?: boolean; // --fail-on-drift: the section says a change fails the run
}

const ANSI = { red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m', reset: '\x1b[0m' };
const MARK: Record<Severity, string> = { error: 'x', warning: '!', info: 'i' };
const COLOR: Record<Severity, keyof typeof ANSI> = { error: 'red', warning: 'yellow', info: 'cyan' };
const HEAD: Record<Severity, string> = { error: 'ERRORS', warning: 'WARNINGS', info: 'INFO' };

interface Group { first: Finding; items: Finding[] }

function subject(f: Finding): string {
  const s = subjectOf(f);
  return f.path && !f.message.includes(f.path) ? `${s} (${f.path})` : s;
}

/** Collapse 2 or more findings of the same rule and message into one line with a count. */
export function groupFindings(list: Finding[], verbose: boolean): Group[] {
  if (verbose) return list.map((f) => ({ first: f, items: [f] }));
  const map = new Map<string, Group>();
  for (const f of list) {
    const key = `${f.ruleId}|${platformLabel(f)}|${f.message}`;
    const g = map.get(key);
    if (g) g.items.push(f);
    else map.set(key, { first: f, items: [f] });
  }
  const out: Group[] = [];
  for (const g of map.values()) {
    if (g.items.length > 1) out.push(g);
    else for (const f of g.items) out.push({ first: f, items: [f] });
  }
  return out;
}

function line(g: Group): string {
  const f = g.first;
  if (g.items.length === 1) return `${f.ruleId} [${platformLabel(f)}] ${subject(f)}: ${f.message}`;
  const subjects = g.items.map(subjectOf);
  const shown = subjects.slice(0, 3).join(', ');
  const kind = g.items.every((x) => x.tool !== undefined) ? 'tools' : 'items';
  return `${f.ruleId} [${platformLabel(f)}] ${g.items.length} ${kind}: ${f.message}: ${shown}${subjects.length > 3 ? `, +${subjects.length - 3} more` : ''}`;
}

/** Text and markdown list no SRV-020 (it is in the header), TOOL-013 info only with --verbose; text drops info with --quiet. */
export function visibleFindings(list: Finding[], opts: { verbose?: boolean; quiet?: boolean }): Finding[] {
  return list.filter((f) => f.ruleId !== 'SRV-020' && !(f.severity === 'info' && (opts.quiet || (f.ruleId === 'TOOL-013' && !opts.verbose))));
}

const HINTS = ['readOnlyHint', 'destructiveHint', 'openWorldHint'];

/**
 * A JSON fragment to paste into each tool reported by TOOL-006 (no title), TOOL-011 or TOOL-012: the missing
 * title from the name, and the annotations with missing hints guessed from the name (read-only for read verbs).
 */
export function fixSnippets(r: Report): string[] {
  const by = (ids: string[]) => new Set(r.findings.filter((f) => ids.includes(f.ruleId)).map((f) => f.tool));
  const hints = by(['TOOL-011', 'TOOL-012']), titled = by(['TOOL-006']);
  // TOOL-006 also reports a long or conflicting title: a tool counts here only when the snapshot has no title for it.
  const noTitle = (t: Record<string, unknown>) => !isNonEmptyStr(t.title ?? annotations(t).title);
  return r.snap.tools.filter((t) => hints.has(toolName(t)) || (titled.has(toolName(t)) && noTitle(t))).map((t) => {
    const a = annotations(t);
    const read = toolKind(t) === 'read';
    const guess: Record<string, boolean> = { readOnlyHint: read, destructiveHint: !read, openWorldHint: true };
    const fix: Record<string, unknown> = {};
    const words = tokenize(toolName(t)).join(' ') || toolName(t);
    if (!isNonEmptyStr(t.title ?? a.title)) fix.title = words.charAt(0).toUpperCase() + words.slice(1);
    const missing = HINTS.filter((h) => typeof a[h] !== 'boolean');
    if (missing.length) fix.annotations = { ...a, ...Object.fromEntries(missing.map((h) => [h, guess[h]])) };
    return `${toolName(t)}: ${JSON.stringify(fix)}`;
  });
}

/** The local-mode banner, naming the rules whose deploy-time findings were made informational. */
export function localBanner(r: Report): string | undefined {
  if (!r.snap.localMode) return undefined;
  const ids = [...new Set(r.findings.filter((f) => f.message.startsWith(DEPLOY)).map((f) => f.ruleId))].sort();
  return `Local target: deploy-time checks are informational${ids.length ? ` (${ids.join(', ')})` : ''}; --no-local for strict checks.`;
}

/**
 * Every line but the disclaimer and the call to action goes through visibleText (server names, messages and reasons
 * may hold ESC, CR or LF), and a line that would start with "::" after its indent gets its first ":" as \u{3A}: the
 * GitHub runner reads such a stdout line as a workflow command.
 */
export function renderText(r: Report, opts: TextOptions): string {
  const t = visibleText;
  const c = (color: keyof typeof ANSI, s: string) => (opts.color ? `${ANSI[color]}${t(s)}${ANSI.reset}` : t(s));
  const snap = r.snap;
  const out: string[] = [];
  out.push(c('bold', `${r.tool.name} ${r.tool.version} · rules ${r.tool.catalogDate} · target: ${snap.options.target}`));
  out.push(t(`Server  ${serverName(snap)} · ${targetLabel(snap)}`));
  if (snap.target.kind !== 'listing') out.push(t(`Transport ${snap.transport.kind} · era ${eraLine(snap)} · auth ${authSummary(snap)}`));
  const rev = r.findings.find((f) => f.ruleId === 'SRV-020')?.message.replace(/^era: [^.]*\.? */, '');
  if (rev) out.push(c('dim', `          ${rev}`));
  out.push(t(`Checked ${snap.target.kind === 'listing' ? 'listing-only: no server' : counts(snap)} · ${r.rulesRun} rules run · ${skippedSummary(r.skipped)}`));
  const local = localBanner(r);
  if (local) out.push(c('dim', local));
  if (snap.coverage.toolLevel === 'auth-required') out.push('', c('yellow', AUTH_NOTICE));
  if (snap.coverage.toolLevel === 'token-rejected') out.push('', c('yellow', TOKEN_REJECTED_NOTICE));
  if (snap.coverage.toolLevel === 'list-failed') out.push('', c('red', `${snap.coverage.reason ?? 'tools/list failed'}. ${LIST_FAILED_NOTICE}`));
  if (snap.coverage.toolLevel === 'connect-failed') out.push('', c('red', `Could not connect: ${snap.coverage.reason ?? snap.fatal ?? 'unknown error'}`));
  const limits = limitsNotice(snap);
  if (limits) out.push('', c('yellow', limits));
  if (opts.quiet) out.length = 0;

  for (const sev of ['error', 'warning', 'info'] as Severity[]) {
    const list = visibleFindings(r.findings, opts).filter((f) => f.severity === sev);
    if (!list.length) continue;
    if (!opts.quiet) out.push('', c(COLOR[sev], `${HEAD[sev]} (${list.length})`));
    for (const g of groupFindings(list, opts.verbose)) {
      out.push(`  ${c(COLOR[sev], MARK[sev])} ${t(line(g))}`);
      if (!opts.quiet && (sev !== 'info' || opts.verbose)) {
        out.push(c('dim', `      fix  ${g.first.fix}`));
        if (g.first.docs[0]) out.push(c('dim', `      docs ${g.first.docs[0]}`));
        const why = opts.verbose && RULES.find((x) => x.id === g.first.ruleId)?.rationale;
        if (why) out.push(c('dim', `      why  ${why}`));
      }
    }
  }
  // With --quiet only a section with changes: the no-change and not-compared notes are not findings.
  if (opts.drift && (!opts.quiet || driftCount(opts.drift))) {
    const note = driftSummary(opts.drift);
    if (note) out.push('', c('dim', note));
    else {
      out.push('', c('bold', driftHeading(opts.drift, opts.failOnDrift).replace(/^Changed tool definitions/, 'CHANGED TOOL DEFINITIONS')));
      for (const l of driftLines(opts.drift)) out.push(`  ${l}`);
    }
  }
  const findingsEnd = out.length;
  const snippets = fixSnippets(r);
  if (snippets.length) {
    out.push('', c('bold', 'FIX SNIPPETS (add to each tool definition; check the guessed hint values)'));
    for (const x of snippets) out.push(t(`  ${x}`));
  }
  if (r.ignored.length) out.push('', c('dim', `Ignored ${r.ignored.length} finding(s) via --ignore.`));

  if (r.manual.length && opts.checklist) {
    out.push('', c('bold', 'MANUAL CHECKLIST (not verified automatically)'));
    for (const m of r.manual) out.push(t(`  [ ] ${m.id} [${m.platforms.join(', ')}] ${m.text}`));
  } else if (r.manual.length) out.push('', c('dim', `${r.manual.length} manual item${r.manual.length === 1 ? '' : 's'}: --checklist to show`));

  if (opts.verbose && r.skipped.length) {
    out.push('', c('bold', 'SKIPPED RULES'));
    for (const s of r.skipped) out.push(t(`  - ${s.ruleId}: ${s.reason}`));
  }

  if (opts.quiet) out.length = findingsEnd; // no fix snippets, ignored count, checklist or skipped rules
  const s = r.summary;
  const rc = r.rootCauses;
  const causes = rc.errors + rc.warnings;
  // --quiet hides the info findings, so it does not count them either.
  out.push(...(out.length ? [''] : []), t(`Score ${scoreLabel(r)} · ${causes} root cause${causes === 1 ? '' : 's'} · ${s.errors} errors · ${s.warnings} warnings${opts.quiet ? '' : ` · ${s.info} info`}`));
  const v = (name: string, x?: { verdict: string; errors: number; warnings: number }) =>
    x ? `${name}: ${x.verdict}${x.errors ? ` (${x.errors} error${x.errors === 1 ? '' : 's'})` : x.warnings ? ` (${x.warnings} warning${x.warnings === 1 ? '' : 's'})` : ''}` : undefined;
  const verdicts = [v('Claude', s.verdicts.claude), v('ChatGPT', s.verdicts.chatgpt)].filter(Boolean);
  // The cause of a failed connect in the result line is the server's text: made visible first, then FAIL is coloured.
  const result = t(resultLine(r, (x) => x, opts.quiet)).replace(/^(FAIL|INCOMPLETE)\b/, (x) => c('red', x));
  out.push([...verdicts, `Result: ${result}`].join(' · '));
  if (opts.cta && !opts.quiet) out.push('', opts.cta);
  out.push('', DISCLAIMER);
  // No line may start or carry a GitHub workflow command (`::` at the start, the legacy `##[` anywhere), A07-07.
  return out.join('\n').split('\n').map((l) => neutralizeCommands(l)).join('\n') + '\n';
}
