// Default text report (§5.1).
import type { Finding } from '../rules/types.js';
import type { Severity } from '../snapshot.js';
import { AUTH_NOTICE, ctaLine, DISCLAIMER, LIST_FAILED_NOTICE, TOKEN_REJECTED_NOTICE } from './constants.js';
import { authSummary, counts, eraLine, platformLabel, resultLine, scoreLabel, serverName, skippedSummary, targetLabel, type Report } from './index.js';

export interface TextOptions {
  color: boolean;
  verbose: boolean;
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

/** Collapse more than 3 findings of the same rule and message into one line. */
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
    if (g.items.length > 3) out.push(g);
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
  return `${f.ruleId} [${platformLabel(f)}] ${g.items.length} ${kind}: ${f.message}: ${shown}, +${subjects.length - 3} more`;
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
  out.push('', `Score ${scoreLabel(r)} · ${s.errors} errors · ${s.warnings} warnings · ${s.info} info`);
  const v = (name: string, x?: { verdict: string; errors: number; warnings: number }) =>
    x ? `${name}: ${x.verdict}${x.errors ? ` (${x.errors} error${x.errors === 1 ? '' : 's'})` : x.warnings ? ` (${x.warnings} warning${x.warnings === 1 ? '' : 's'})` : ''}` : undefined;
  const verdicts = [v('Claude', s.verdicts.claude), v('ChatGPT', s.verdicts.chatgpt)].filter(Boolean);
  out.push([...verdicts, `Result: ${resultLine(r, (x) => c('red', x))}`].join(' · '));
  out.push('', DISCLAIMER);
  const cta = ctaLine();
  if (cta) out.push('', cta);
  return out.join('\n') + '\n';
}
