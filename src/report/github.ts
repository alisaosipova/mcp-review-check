// GitHub Actions mode (R-46): workflow-command annotations on stderr and the markdown report appended to the job
// summary. On only when GITHUB_ACTIONS=true; there is no separate switch (D-7).
import { appendFileSync } from 'node:fs';
import { platformSeverity } from '../rules/types.js';
import type { Severity } from '../snapshot.js';
import { platformLabel, type Report } from './index.js';

/** A workflow-command message (`%`, CR and LF escaped) or, with `property`, a property value (also `:` and `,`). */
export function escapeCommand(s: string, property = false): string {
  const data = s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return property ? data.replace(/:/g, '%3A').replace(/,/g, '%2C') : data;
}

const RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

/**
 * One `::error` or `::warning` line per finding at its highest severity on the gated platforms (the --target
 * directories, plus spec with --fail-on-spec), as for the exit code (D-4); info and ungated findings get none.
 * Exit 3 (no connect, or a --max-duration stop) comes first as one `::error` with its cause (R-3).
 */
export function annotations(r: Report): string[] {
  const stop = r.snap.limits?.stopped;
  const outcome = r.snap.fatal ? `Could not connect: ${r.snap.coverage.reason ?? r.snap.fatal}`
    : stop ? `Stopped by --max-duration ${stop.maxDurationMs} ms during ${stop.phase}; the check is incomplete` : undefined;
  const out: string[] = outcome ? [`::error title=mcp-review-check::${escapeCommand(outcome)}`] : [];
  for (const f of r.findings) {
    const sev = r.summary.gate.platforms.filter((p) => f.platforms.includes(p)).map((p) => platformSeverity(f, p))
      .reduce<Severity>((a, b) => (RANK[b] > RANK[a] ? b : a), 'info');
    if (sev === 'info') continue;
    const title = `${f.ruleId} ${f.tool ?? f.resource ?? 'server'}`;
    out.push(`::${sev} title=${escapeCommand(title, true)}::${escapeCommand(`[${platformLabel(f)}] ${f.message}\nFix: ${f.fix}`)}`);
  }
  return out;
}

/** Appends the markdown report to the job summary file ($GITHUB_STEP_SUMMARY); a write failure is a stderr warning. */
export function appendStepSummary(file: string, markdown: string): string {
  try {
    appendFileSync(file, `${markdown}\n`);
    return '';
  } catch (e) {
    return `warning: cannot append the report to $GITHUB_STEP_SUMMARY: ${(e as Error).message}\n`;
  }
}
