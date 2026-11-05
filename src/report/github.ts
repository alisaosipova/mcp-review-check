// GitHub Actions mode: workflow-command annotations on stderr and the markdown report appended to the job
// summary. On only when GITHUB_ACTIONS=true; there is no separate switch.
import { appendFileSync, statSync } from 'node:fs';
import { authReason, subjectOf } from '../rules/engine.js';
import { platformSeverity } from '../rules/types.js';
import type { Severity } from '../snapshot.js';
import { ciSafeText, platformLabel, type Report } from './index.js';

// One helper for server text in a CI log (P1's --verbose block imports ciSafeLine from here).
export { ciSafeLine, ciSafeText, neutralizeCommands } from './index.js';

/** ciSafeText per line, the line breaks kept (escapeCommand turns them into %0A). */
const shown = (s: string) => s.split(/\r?\n/).map(ciSafeText).join('\n');

/** A workflow-command message (`%`, CR and LF escaped) or, with `property`, a property value (also `:` and `,`). */
export function escapeCommand(s: string, property = false): string {
  const data = s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return property ? data.replace(/:/g, '%3A').replace(/,/g, '%2C') : data;
}

const RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

/**
 * One `::error` or `::warning` line per finding at its highest severity on the gated platforms (the --target
 * directories, plus spec with --fail-on-spec), as for the exit code; info and ungated findings get none.
 * Exit 3 (no connect) or 4 (a --max-duration stop) comes first as one `::error` with its cause; a partial check that
 * still finished (no or a rejected token, tools/list failed) as one `::warning`, so a green job whose tool checks
 * were skipped is visible, or as one `::error` when --fail-on-incomplete failed the run on it.
 */
export function annotations(r: Report): string[] {
  const stop = r.snap.limits?.stopped;
  const outcome = r.snap.fatal ? `Could not connect: ${r.snap.coverage.reason ?? r.snap.fatal}`
    : stop ? `Stopped by --max-duration ${stop.maxDurationMs} ms during ${stop.phase}; the check is incomplete` : undefined;
  // The cause (and the auth reason below) can quote the server; its ESC, bidi and other hidden characters are shown (A07-05).
  const out: string[] = outcome ? [`::error title=mcp-review-check::${escapeCommand(shown(outcome))}`] : [];
  const level = r.snap.coverage.toolLevel;
  if (!outcome && level !== 'ok') {
    const skipped = r.skipped.length ? ` (${r.skipped.length} rule${r.skipped.length === 1 ? '' : 's'} skipped)` : '';
    const budget = r.snap.limits?.budgetExhausted;
    const cause = budget ? `snapshot budget exhausted during ${budget.phase}, after ${budget.bytes} bytes` : authReason(r.snap) ?? level;
    // With --fail-on-incomplete the partial check failed the run (exit 3): an ::error, without the advice to add the flag (A10-01).
    const advice = r.incompleteFails ? '--fail-on-incomplete fails the run.' : '--fail-on-incomplete fails the run on a partial check.';
    const why = `Partial check: ${level} (${cause}); tool-level checks were skipped${skipped}, so the result covers only what ran. ${advice}`;
    out.push(`::${r.incompleteFails ? 'error' : 'warning'} title=mcp-review-check::${escapeCommand(shown(why))}`);
  }
  for (const f of r.findings) {
    const sev = r.summary.gate.platforms.filter((p) => f.platforms.includes(p)).map((p) => platformSeverity(f, p))
      .reduce<Severity>((a, b) => (RANK[b] > RANK[a] ? b : a), 'info');
    if (sev === 'info') continue;
    // Tool names and messages are the server's text: ESC, bidi overrides and the like are shown as \u{..} (A07-05).
    const title = ciSafeText(`${f.ruleId} ${subjectOf(f)}`);
    out.push(`::${sev} title=${escapeCommand(title, true)}::${escapeCommand(`[${platformLabel(f)}] ${shown(f.message)}\nFix: ${shown(f.fix)}`)}`);
  }
  return out;
}

/** GitHub drops a step's job summary over 1 MiB ("step summary upload aborted"). */
export const STEP_SUMMARY_LIMIT = 1024 * 1024;
const TRUNCATED = '\n> The report was cut to fit the 1 MiB job summary limit of GitHub; `--output` writes it in full.\n';

/** The markdown cut at a line end so that it and the truncation note take at most `room` bytes; empty when even the note does not fit. */
export function fitSummary(markdown: string, room: number): string {
  const whole = `${markdown}\n`;
  if (Buffer.byteLength(whole) <= room) return whole;
  let left = room - Buffer.byteLength(TRUNCATED);
  if (left < 0) return '';
  const kept: string[] = [];
  for (const line of markdown.split('\n')) {
    const n = Buffer.byteLength(line) + 1;
    if (n > left) break;
    kept.push(line);
    left -= n;
  }
  return `${kept.map((l) => `${l}\n`).join('')}${TRUNCATED}`;
}

/**
 * Appends the markdown report to the job summary file ($GITHUB_STEP_SUMMARY), cut to what is left of the step's 1 MiB
 * (the file may already hold an earlier summary of the same step); a write failure is a stderr warning.
 */
export function appendStepSummary(file: string, markdown: string, limit = STEP_SUMMARY_LIMIT): string {
  try {
    let used = 0;
    try { used = statSync(file).size; } catch { /* a new file */ }
    const text = fitSummary(markdown, limit - used);
    if (!text) return 'warning: $GITHUB_STEP_SUMMARY is full (1 MiB); the report was not appended\n';
    appendFileSync(file, text);
    return '';
  } catch (e) {
    return `warning: cannot append the report to $GITHUB_STEP_SUMMARY: ${(e as Error).message}\n`;
  }
}
