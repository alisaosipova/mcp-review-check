// Markdown report (§5.3).
import type { Severity } from '../snapshot.js';
import { AUTH_NOTICE, DISCLAIMER, LIST_FAILED_NOTICE, TOKEN_REJECTED_NOTICE } from './constants.js';
import { limitsNotice } from '../limits.js';
import { authSummary, counts, eraLine, platformLabel, resultLine, scoreLabel, serverName, targetLabel, type Report } from './index.js';

const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const HEAD: Record<Severity, string> = { error: 'Errors', warning: 'Warnings', info: 'Info' };

export function renderMarkdown(r: Report, opts: { cta?: string } = {}): string {
  const snap = r.snap;
  const s = r.summary;
  const out: string[] = [];
  out.push(`# ${cell(serverName(snap))}`, '');
  out.push(`mcp-review-check ${r.tool.version} · rules ${r.tool.catalogDate} · target: ${snap.options.target}`, '');
  if (snap.coverage.toolLevel === 'auth-required') out.push(`> ${AUTH_NOTICE}`, '');
  if (snap.coverage.toolLevel === 'token-rejected') out.push(`> ${TOKEN_REJECTED_NOTICE}`, '');
  if (snap.coverage.toolLevel === 'list-failed') out.push(`> ${cell(snap.coverage.reason ?? 'tools/list failed')}. ${LIST_FAILED_NOTICE}`, '');
  if (snap.coverage.toolLevel === 'connect-failed') out.push(`> Could not connect: ${cell(snap.coverage.reason ?? snap.fatal ?? 'unknown error')}`, '');
  const limits = limitsNotice(snap);
  if (limits) out.push(`> ${cell(limits)}`, '');
  if (snap.localMode) out.push('> Local target: deploy-time checks are informational.', '');
  out.push('| Item | Value |', '|---|---|');
  out.push(`| Target | ${cell(targetLabel(snap))} |`);
  out.push(`| Transport | ${snap.transport.kind} · era ${eraLine(snap)} · auth ${cell(authSummary(snap))} |`);
  out.push(`| Checked | ${counts(snap)} · ${r.rulesRun} rules run · ${r.skipped.length} skipped |`);
  out.push(`| Score | ${scoreLabel(r)} |`);
  out.push(`| Findings | ${s.errors} errors · ${s.warnings} warnings · ${s.info} info |`);
  if (s.verdicts.claude) out.push(`| Claude | ${s.verdicts.claude.verdict} |`);
  if (s.verdicts.chatgpt) out.push(`| ChatGPT | ${s.verdicts.chatgpt.verdict} |`);
  out.push(`| Result | ${cell(resultLine(r))} |`, '');

  for (const sev of ['error', 'warning', 'info'] as Severity[]) {
    const list = r.findings.filter((f) => f.severity === sev);
    if (!list.length) continue;
    out.push(`## ${HEAD[sev]} (${list.length})`, '', '| Rule | Platforms | Subject | Message | Fix | Docs |', '|---|---|---|---|---|---|');
    for (const f of list) {
      const subject = `${f.tool ?? f.resource ?? 'server'}${f.path ? ` (${f.path})` : ''}`;
      out.push(`| ${f.ruleId} | ${platformLabel(f)} | ${cell(subject)} | ${cell(f.message)} | ${cell(f.fix)} | ${cell(f.docs[0])} |`);
    }
    out.push('');
  }
  if (r.manual.length) {
    out.push('## Manual checklist', '');
    for (const m of r.manual) out.push(`- [ ] **${m.id}** [${m.platforms.join(', ')}] ${m.text} (${m.docs[0]})`);
    out.push('');
  }
  if (opts.cta) out.push(opts.cta, '');
  out.push(DISCLAIMER.replace(/\n/g, ' '), '');
  return out.join('\n');
}
