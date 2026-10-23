// Default text report (§5.1).
import type { Finding } from '../rules/types.js';
import type { Severity } from '../snapshot.js';
import { AUTH_NOTICE, DISCLAIMER, LIST_FAILED_NOTICE, TOKEN_REJECTED_NOTICE } from './constants.js';
import { limitsNotice } from '../limits.js';
import { annotations, isNonEmptyStr, toolName } from '../rules/util/access.js';
import { tokenize, toolKind } from '../rules/util/text.js';
import { rootCauses } from './score.js';
import { authSummary, counts, eraLine, platformLabel, resultLine, scoreLabel, serverName, skippedSummary, targetLabel, type Report } from './index.js';

export interface TextOptions {
  color: boolean;
  verbose: boolean;
  cta?: string; // ctaLine(), printed above the disclaimer
}

const ANSI = { red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m', reset: '\x1b[0m' };
const MARK: Record<Severity, string> = { error: 'x', warning: '!', info: 'i' };
const COLOR: Record<Severity, keyof typeof ANSI> = { error: 'red', warning: 'yellow', info: 'cyan' };
const HEAD: Record<Severity, string> = { error: 'ERRORS', warning: 'WARNINGS', info: 'INFO' };

interface Group { first: Finding; items: Finding[] }

function subject(f: Finding): string {
  const s = f.tool ?? f.resource ?? 'server';
  return f.path && !f.message.includes(f.path) ? `${s} (${f.path})` : s;
}

/** Collapse 2 or more findings of the same rule and message into one line with a count (R-28). */
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
  const subjects = g.items.map((x) => x.tool ?? x.resource ?? 'server');
  const shown = subjects.slice(0, 3).join(', ');
  const kind = g.items.every((x) => x.tool) ? 'tools' : 'items';
  return `${f.ruleId} [${platformLabel(f)}] ${g.items.length} ${kind}: ${f.message}: ${shown}${subjects.length > 3 ? `, +${subjects.length - 3} more` : ''}`;
}

const HINTS = ['readOnlyHint', 'destructiveHint', 'openWorldHint'];

/**
 * R-29: a JSON fragment to paste into each tool reported by TOOL-006 (no title), TOOL-011 or TOOL-012: the missing
 * title from the name, and the annotations with missing hints guessed from the name (read-only for read verbs).
 */
export function fixSnippets(r: Report): string[] {
  const flagged = new Set(r.findings.filter((f) => ['TOOL-011', 'TOOL-012'].includes(f.ruleId) || (f.ruleId === 'TOOL-006' && f.message === 'no title')).map((f) => f.tool));
  return r.snap.tools.filter((t) => flagged.has(toolName(t))).map((t) => {
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

export function renderText(r: Report, opts: TextOptions): string {
  const c = (color: keyof typeof ANSI, s: string) => (opts.color ? `${ANSI[color]}${s}${ANSI.reset}` : s);
  const snap = r.snap;
  const out: string[] = [];
  out.push(c('bold', `${r.tool.name} ${r.tool.version} · rules ${r.tool.catalogDate} · target: ${snap.options.target}`));
  out.push(`Server  ${serverName(snap)} · ${targetLabel(snap)}`);
  out.push(`Transport ${snap.transport.kind} · era ${eraLine(snap)} · auth ${authSummary(snap)}`);
  out.push(`Checked ${counts(snap)} · ${r.rulesRun} rules run · ${skippedSummary(r.skipped)}`);
  if (snap.localMode) out.push(c('dim', 'Local target: deploy-time checks are informational.'));
  if (snap.coverage.toolLevel === 'auth-required') out.push('', c('yellow', AUTH_NOTICE));
  if (snap.coverage.toolLevel === 'token-rejected') out.push('', c('yellow', TOKEN_REJECTED_NOTICE));
  if (snap.coverage.toolLevel === 'list-failed') out.push('', c('red', `${snap.coverage.reason ?? 'tools/list failed'}. ${LIST_FAILED_NOTICE}`));
  if (snap.coverage.toolLevel === 'connect-failed') out.push('', c('red', `Could not connect: ${snap.coverage.reason ?? snap.fatal ?? 'unknown error'}`));
  const limits = limitsNotice(snap);
  if (limits) out.push('', c('yellow', limits));

  for (const sev of ['error', 'warning', 'info'] as Severity[]) {
    const list = r.findings.filter((f) => f.severity === sev);
    if (!list.length) continue;
    out.push('', c(COLOR[sev], `${HEAD[sev]} (${list.length})`));
    for (const g of groupFindings(list, opts.verbose)) {
      out.push(`  ${c(COLOR[sev], MARK[sev])} ${line(g)}`);
      if (sev !== 'info' || opts.verbose) {
        out.push(c('dim', `      fix  ${g.first.fix}`));
        if (g.first.docs[0]) out.push(c('dim', `      docs ${g.first.docs[0]}`));
      }
    }
  }
  const snippets = fixSnippets(r);
  if (snippets.length) {
    out.push('', c('bold', 'FIX SNIPPETS (add to each tool definition; check the guessed hint values)'));
    for (const x of snippets) out.push(`  ${x}`);
  }
  if (r.ignored.length) out.push('', c('dim', `Ignored ${r.ignored.length} finding(s) via --ignore.`));

  if (r.manual.length) {
    out.push('', c('bold', 'MANUAL CHECKLIST (not verified automatically)'));
    for (const m of r.manual) out.push(`  [ ] ${m.id} [${m.platforms.join(', ')}] ${m.text}`);
  }

  if (opts.verbose && r.skipped.length) {
    out.push('', c('bold', 'SKIPPED RULES'));
    for (const s of r.skipped) out.push(`  - ${s.ruleId}: ${s.reason}`);
  }

  const s = r.summary;
  const rc = rootCauses(r.findings);
  const causes = rc.errors + rc.warnings;
  out.push('', `Score ${scoreLabel(r)} · ${causes} root cause${causes === 1 ? '' : 's'} · ${s.errors} errors · ${s.warnings} warnings · ${s.info} info`);
  const v = (name: string, x?: { verdict: string; errors: number; warnings: number }) =>
    x ? `${name}: ${x.verdict}${x.errors ? ` (${x.errors} error${x.errors === 1 ? '' : 's'})` : x.warnings ? ` (${x.warnings} warning${x.warnings === 1 ? '' : 's'})` : ''}` : undefined;
  const verdicts = [v('Claude', s.verdicts.claude), v('ChatGPT', s.verdicts.chatgpt)].filter(Boolean);
  out.push([...verdicts, `Result: ${resultLine(r, (x) => c('red', x))}`].join(' · '));
  if (opts.cta) out.push('', opts.cta);
  out.push('', DISCLAIMER);
  return out.join('\n') + '\n';
}
