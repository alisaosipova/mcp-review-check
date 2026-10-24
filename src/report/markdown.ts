// Markdown report (§5.3).
import type { Severity } from '../snapshot.js';
import { AUTH_NOTICE, DISCLAIMER, LIST_FAILED_NOTICE, TOKEN_REJECTED_NOTICE } from './constants.js';
import { limitsNotice } from '../limits.js';
import { RULES } from '../rules/index.js';
import { rootCauses } from './score.js';
import { localBanner, visibleFindings } from './text.js';
import { authSummary, counts, eraLine, platformLabel, resultLine, scoreLabel, serverName, targetLabel, type Report } from './index.js';

const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const HEAD: Record<Severity, string> = { error: 'Errors', warning: 'Warnings', info: 'Info' };
const ESC: Record<string, string> = { '\\': '\\\\', '`': '\\`', '[': '\\[', ']': '\\]', '<': '&lt;', '>': '&gt;', '&': '&amp;', '@': '@&#8203;' };

/** Server text outside a code span (R-11): shown as written, never a link, image, HTML or @mention. */
const text = (s: string | undefined) => cell((s ?? '').replace(/[\\`[\]<>&@]/g, (c) => ESC[c]));

/** Evidence as a code span (R-48): quoted server text is shown, not rendered as markdown or HTML. The fence is longer than any backtick run inside, so the text cannot close it (R-11). */
const code = (s: string | undefined, inCell = true) => {
  if (!s) return '';
  const t = inCell ? cell(s) : s.replace(/\r?\n/g, ' ');
  const fence = '`'.repeat(Math.max(1, ...(t.match(/`+/g) ?? []).map((x) => x.length)) + 1);
  return `${fence} ${t} ${fence}`;
};

/** `rerun` is the redacted command line that reproduces the report (R-48). */
export function renderMarkdown(r: Report, opts: { cta?: string; verbose?: boolean; rerun?: string } = {}): string {
  const snap = r.snap;
  const s = r.summary;
  const out: string[] = [];
  out.push(`# ${text(serverName(snap))}`, '');
  out.push(`mcp-review-check ${r.tool.version} · rules ${r.tool.catalogDate} · target: ${snap.options.target}`, '');
  if (snap.coverage.toolLevel === 'auth-required') out.push(`> ${AUTH_NOTICE}`, '');
  if (snap.coverage.toolLevel === 'token-rejected') out.push(`> ${TOKEN_REJECTED_NOTICE}`, '');
  if (snap.coverage.toolLevel === 'list-failed') out.push(`> ${text(snap.coverage.reason ?? 'tools/list failed')}. ${LIST_FAILED_NOTICE}`, '');
  if (snap.coverage.toolLevel === 'connect-failed') out.push(`> Could not connect: ${text(snap.coverage.reason ?? snap.fatal ?? 'unknown error')}`, '');
  const limits = limitsNotice(snap);
  if (limits) out.push(`> ${text(limits)}`, '');
  const local = localBanner(r);
  if (local) out.push(`> ${local}`, '');
  out.push('| Item | Value |', '|---|---|');
  out.push(`| Target | ${text(targetLabel(snap))} |`);
  out.push(`| Transport | ${snap.transport.kind} · era ${eraLine(snap)} · auth ${cell(authSummary(snap))} |`);
  const rev = r.findings.find((f) => f.ruleId === 'SRV-020')?.message.replace(/^era: [^.]*\.? */, '');
  if (rev) out.push(`| Revision | ${text(rev)} |`);
  out.push(`| Checked | ${counts(snap)} · ${r.rulesRun} rules run · ${r.skipped.length} skipped |`);
  const rc = rootCauses(r.findings);
  out.push(`| Score | ${scoreLabel(r)} · ${rc.errors + rc.warnings} root cause${rc.errors + rc.warnings === 1 ? '' : 's'} |`);
  out.push(`| Findings | ${s.errors} errors · ${s.warnings} warnings · ${s.info} info |`);
  if (s.verdicts.claude) out.push(`| Claude | ${s.verdicts.claude.verdict} |`);
  if (s.verdicts.chatgpt) out.push(`| ChatGPT | ${s.verdicts.chatgpt.verdict} |`);
  out.push(`| Result | ${cell(resultLine(r))} |`, '');
  if (opts.rerun) out.push(code(`rerun: ${opts.rerun}`, false), '');

  for (const sev of ['error', 'warning', 'info'] as Severity[]) {
    const list = visibleFindings(r.findings, opts).filter((f) => f.severity === sev);
    if (!list.length) continue;
    out.push(`## ${HEAD[sev]} (${list.length})`, '', '| Rule | Platforms | Subject | Message | Fix | Docs | Evidence |', '|---|---|---|---|---|---|---|');
    for (const f of list) {
      const subject = `${f.tool ?? f.resource ?? 'server'}${f.path ? ` (${f.path})` : ''}`;
      out.push(`| ${f.ruleId} | ${platformLabel(f)} | ${text(subject)} | ${text(f.message)} | ${cell(f.fix)} | ${cell(f.docs[0])} | ${code(f.evidence)} |`);
    }
    out.push('');
  }
  const why = RULES.filter((x) => visibleFindings(r.findings, opts).some((f) => f.ruleId === x.id));
  if (why.length) out.push('## Why these rules', '', ...why.map((x) => `- **${x.id}**: ${cell(x.rationale)}`), '');
  if (r.manual.length) {
    out.push('## Manual checklist', '');
    for (const m of r.manual) out.push(`- [ ] **${m.id}** [${m.platforms.join(', ')}] ${m.text} (${m.docs[0]})`);
    out.push('');
  }
  if (opts.cta) out.push(opts.cta, '');
  out.push(DISCLAIMER.replace(/\n/g, ' '), '');
  return out.join('\n');
}
