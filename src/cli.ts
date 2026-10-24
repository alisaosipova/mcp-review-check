#!/usr/bin/env node
// CLI entry: argument parsing, validation, orchestration, exit codes, --list-rules and explain.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildSnapshot, endAllNow, redactorFor, type BuildOptions, type TargetSpec } from './connect.js';
import { explainRule, listRulesJson, listRulesText, rulesMarkdown } from './explain.js';
import { schemeSuggestion } from './diagnose.js';
import { redactDeep, scrub, type Redactor } from './redact.js';
import { splitStdioArgv, tokenizeCommand } from './protocol/stdioArgs.js';
import { buildReport, resultLine, scoreLabel, type Report } from './report/index.js';
import { ctaLine } from './report/constants.js';
import { renderJson } from './report/json.js';
import { renderMarkdown } from './report/markdown.js';
import { renderSarif, SARIF_LOCATION } from './report/sarif.js';
import { annotations, appendStepSummary, escapeCommand } from './report/github.js';
import type { FailOn } from './report/score.js';
import { localBanner, renderText, type TextOptions } from './report/text.js';
import { CATALOG_DATE, staleCatalogWarning } from './catalog.js';
import { manualChecklist, MANUAL_ITEMS, RULES, runRules } from './rules/index.js';
import { displayUrl, REDACTED_MARK } from './rules/util/net.js';
import type { TargetOpt } from './snapshot.js';
import { VERSION } from './version.js';

const HELP = `mcp-review-check ${VERSION} (rules ${CATALOG_DATE})
Lint an MCP server against the Claude connector directory, ChatGPT plugin directory and MCP spec.

Usage:
  mcp-review-check <url> [options]
  mcp-review-check --stdio "<command> [args...]" [options]
  mcp-review-check [options] --stdio -- <command> [args...]
  mcp-review-check explain <RULE-ID>

Options:
  --header "K: V"         Extra request header (repeatable). Values are redacted in output.
  --bearer <token>        Bearer token (default: $MCP_REVIEW_CHECK_TOKEN).
  --target <t>            claude | chatgpt | all (default: all)
  --format <f>            text | json | markdown | sarif (default: text)
  --output <file>         Write the report to a file; print a summary line to stderr.
  --sarif-location <path> Repository-relative path the SARIF results point at (default: .mcp-review-check).
  --timeout <ms>          Per-request timeout (default: 30000; HTTP connect uses min(timeout, 15000), stdio start uses the full timeout).
  --max-duration <ms>     Stop the whole check after this long and report what ran (default: no limit).
  --fail-on <level>       error | warning | never (default: error). Counts findings for the --target directories only.
  --fail-on-spec          Also fail on MCP spec findings (spec-only findings do not fail the run by default).
  --local                 Local mode: deploy-time checks (HTTPS, public DNS, tunnel domains) are informational.
  --no-local              Strict deploy-time checks, also for loopback, private and dotless hosts and --stdio.
  --active                Call read-only tools (readOnlyHint: true) to run RT checks.
  --active-auth           Probe DCR, /authorize and /token. CREATES A DCR CLIENT on your authorization server.
  --tool-args <file>      JSON {toolName: args} for --active calls.
  --env K=V               Environment variable for --stdio (repeatable). Values are redacted in output.
  --cwd <dir>             Working directory for --stdio.
  --ignore <RULE-ID>      Ignore a rule (repeatable); an ID that is not a rule or MAN item is a usage error.
  --list-rules [prefix]   Print the rule catalog (--format text, json or markdown; IDs starting with prefix) and exit.
  --no-color              Disable colors (also off when not a TTY or NO_COLOR is set; FORCE_COLOR=1 forces them on).
  --verbose               Expand collapsed findings, show TOOL-013 info and rule rationales; print the redacted HTTP trace and stdio stderr.
  --quiet                 Text only: print just error and warning findings, the Score and Result lines and the disclaimer.
  --checklist             Text only: print the manual checklist in full (default: one line with the item count).
  -h, --help              Show this help.
  -v, --version           Show the version.

Examples:
  mcp-review-check https://mcp.example.com/mcp --target claude
  mcp-review-check --env API_BASE=http://localhost:4000 --stdio -- node dist/server.js
  mcp-review-check https://staging.example.com/mcp --format markdown --output report.md
  mcp-review-check explain TOOL-011
  mcp-review-check --list-rules TOOL --format json

--stdio "<command>" is split on whitespace; quote arguments with spaces. A backslash outside quotes is literal
(Windows paths work); the "-- <command> [args...]" form passes arguments verbatim, with options before --.
Secrets are redacted in every format: --bearer, --header and --env values, URL credentials, and stdio arguments
after secret-looking flags (--api-key X, --token=X, API_KEY=X, "Authorization: Bearer X").

Exit codes: 0 below --fail-on threshold, 1 threshold reached, 2 usage error (or --output not writable), 3 could not connect
or stopped by --max-duration (at any --fail-on; the Result line reads INCOMPLETE after a handshake).
The exit code counts findings at each directory's own severity for --target (all = Claude and ChatGPT); MCP spec
findings are reported but count only with --fail-on-spec. The Result line names the findings that failed the run.
The score (100 - 12 per rule with errors - 4 per rule with only warnings) is provisional.
With GITHUB_ACTIONS=true, findings are also printed as ::error/::warning annotations on stderr (at the --target
severity), exit 3 as one ::error with its cause, and the markdown report is appended to $GITHUB_STEP_SUMMARY when it is set.
No telemetry is sent. Passing these checks does not guarantee directory approval.
`;

class UsageError extends Error {}

const OPTIONS = {
  stdio: { type: 'string' }, header: { type: 'string', multiple: true }, bearer: { type: 'string' },
  target: { type: 'string', default: 'all' }, format: { type: 'string', default: 'text' }, output: { type: 'string' }, 'sarif-location': { type: 'string' },
  timeout: { type: 'string', default: '30000' }, 'max-duration': { type: 'string' }, 'fail-on': { type: 'string', default: 'error' }, 'fail-on-spec': { type: 'boolean' },
  active: { type: 'boolean' }, 'active-auth': { type: 'boolean' }, 'tool-args': { type: 'string' },
  env: { type: 'string', multiple: true }, cwd: { type: 'string' }, ignore: { type: 'string', multiple: true },
  'list-rules': { type: 'boolean' }, 'no-color': { type: 'boolean' }, verbose: { type: 'boolean' },
  quiet: { type: 'boolean' }, checklist: { type: 'boolean' }, local: { type: 'boolean' }, 'no-local': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
} as const;

/** The known option nearest to an unknown one (Levenshtein distance at most 2), for "did you mean" (R-41). */
function closestOption(name: string): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const option of Object.keys(OPTIONS).map((k) => `--${k}`)) {
    let prev = Array.from({ length: option.length + 1 }, (_, j) => j);
    for (let i = 1; i <= name.length; i++) {
      const cur = [i];
      for (let j = 1; j <= option.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (name[i - 1] === option[j - 1] ? 0 : 1));
      prev = cur;
    }
    if (prev[option.length] < bestDistance) [best, bestDistance] = [option, prev[option.length]];
  }
  return best;
}

/** Largest --timeout: 2^31-1 ms (the setTimeout limit) minus the 1000 ms margin used in withTimeout. */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1 - 1000;

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Usage errors never echo option values: they may be credentials.
function parseHeader(raw: string): [string, string] {
  const i = raw.indexOf(':');
  if (i <= 0) throw new UsageError('--header must look like "Name: value" (no ":" found; the value is not shown)');
  const k = raw.slice(0, i).trim();
  const v = raw.slice(i + 1).trim();
  if (/[\r\n]/.test(k) || /[\r\n]/.test(v)) throw new UsageError('--header values must not contain CR or LF');
  return [k, v];
}

function render(r: Report, format: string, opts: TextOptions, rerun: string, sarifLocation: string): string {
  switch (format) {
    case 'json': return renderJson(r);
    case 'markdown': return renderMarkdown(r, { cta: opts.cta, verbose: opts.verbose, rerun }); // --quiet and --checklist are text only (D-3)
    case 'sarif': return renderSarif(r, sarifLocation);
    default: return renderText(r, opts);
  }
}

/** R-48: the command line that reproduces the report, secrets redacted; the text-only --quiet and --checklist are left out (D-3).
 *  SEC-1: --bearer, --header and --env values masked by position at any length, the URL through displayUrl, then scrub. */
function rerunCommand(argv: string[], redactor: Redactor): string {
  const end = argv.includes('--') ? argv.indexOf('--') : argv.length;
  // Header and variable names stay ("X-Api-Key:«redacted»", "API_KEY=«redacted»"); a --bearer value goes whole.
  const masked = (opt: string, v: string) => (opt === '--bearer' ? '' : v.slice(0, v.indexOf(opt === '--header' ? ':' : '=') + 1)) + REDACTED_MARK;
  const args = argv.map((a, i) => {
    if (i >= end) return a;
    const eq = /^(--(?:bearer|header|env))=(.*)$/s.exec(a);
    if (eq) return `${eq[1]}=${masked(eq[1], eq[2])}`;
    if (i > 0 && ['--bearer', '--header', '--env'].includes(argv[i - 1])) return masked(argv[i - 1], a);
    return /^https?:\/\//i.test(a) ? displayUrl(a) : a;
  }).filter((a, i) => i >= end || (a !== '--quiet' && a !== '--checklist')).map((a) => scrub(a, redactor));
  return ['npx mcp-review-check', ...args.map((a) => (/^[\w@%+=:,./«»-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`))].join(' ');
}

/** A URL for a usage error: everything up to the last "@" after the scheme (a password may hold "/", "?" or "#"), query and fragment hidden. */
function shownUrl(raw: string): string {
  return raw.replace(/\/\/.*@/s, '//…@').replace(/[?#].*$/s, (q) => (q.length > 1 ? `${q[0]}…` : q));
}

export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env, isTty = !!process.stdout.isTTY): Promise<CliResult> {
  let stderr = '';
  let redactor: Redactor | undefined;
  try {
    const split = splitStdioArgv(argv);
    const { values, positionals } = parseArgs({
      args: split.args, allowPositionals: true, strict: true, options: OPTIONS,
    });
    if (values.help) return { code: 0, stdout: HELP, stderr };
    if (values.version) return { code: 0, stdout: `${VERSION}\n`, stderr };
    if (values['list-rules']) {
      if (positionals.length > 1) throw new UsageError('--list-rules takes at most one rule ID prefix');
      // Only an ID-like prefix filters; anything else (a URL with a token, a path) lists the whole catalog, as the baseline did, unrepeated.
      const prefix = /^[A-Z]+(-\d*)?$/i.test(positionals[0] ?? '') ? positionals[0].toUpperCase() : '';
      const rules = RULES.filter((r) => r.id.startsWith(prefix));
      const manual = MANUAL_ITEMS.filter((m) => m.id.startsWith(prefix));
      if (!rules.length && !manual.length) throw new UsageError(`no rule or MAN ID starts with ${prefix}`);
      if (!['text', 'json', 'markdown', 'sarif'].includes(values.format!)) throw new UsageError('--list-rules --format must be text, json or markdown');
      // R-13: SARIF has no catalog form; print the text catalog with a warning and exit 0, as the MRC-1 baseline did.
      if (values.format === 'sarif') stderr += 'warning: --format sarif does not apply to --list-rules; printing text\n';
      const list = values.format === 'json' ? listRulesJson(rules, manual) : values.format === 'markdown' ? `${rulesMarkdown(rules, manual)}\n` : listRulesText(rules, manual, !!values.verbose);
      return { code: 0, stdout: list, stderr };
    }
    if (positionals[0] === 'explain') {
      if (positionals.length !== 2) throw new UsageError('usage: mcp-review-check explain <RULE-ID>');
      const text = explainRule(positionals[1]);
      if (!text) throw new UsageError(`unknown rule ID ${/^[a-z]+-\d+$/i.test(positionals[1]) ? positionals[1] : '(value not shown)'}; --list-rules prints the catalog`);
      return { code: 0, stdout: text, stderr };
    }

    if (split.command && values.stdio !== undefined) throw new UsageError('give --stdio either "<command>" or -- <command> [args...], not both');
    if (positionals.length > 1) throw new UsageError('expected a single <url>');
    const isStdio = values.stdio !== undefined || split.command !== undefined;
    if ((positionals.length === 1) === isStdio) throw new UsageError('give exactly one of <url> or --stdio "<command>"');
    const target = values.target as TargetOpt;
    if (!['claude', 'chatgpt', 'all'].includes(target)) throw new UsageError('--target must be claude, chatgpt or all');
    const format = values.format!;
    if (!['text', 'json', 'markdown', 'sarif'].includes(format)) throw new UsageError('--format must be text, json, markdown or sarif');
    const sarifLocation = values['sarif-location'] ?? SARIF_LOCATION;
    // Code scanning takes repository-relative paths only: no scheme (C: included), no leading / or \, no "..".
    if (!sarifLocation || /^([a-z][a-z0-9+.-]*:|[\\/])/i.test(sarifLocation) || sarifLocation.split(/[\\/]/).includes('..')) throw new UsageError('--sarif-location must be a relative path without a scheme or ".." (the value is not shown)');
    const failOn = values['fail-on'] as FailOn;
    if (!['error', 'warning', 'never'].includes(failOn)) throw new UsageError('--fail-on must be error, warning or never');
    const timeoutMs = Number(values.timeout);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new UsageError('--timeout must be a positive number of milliseconds');
    // Node clamps larger setTimeout delays to 1 ms; withTimeout adds a 1000 ms margin on top.
    if (timeoutMs > MAX_TIMEOUT_MS) throw new UsageError(`--timeout must be at most ${MAX_TIMEOUT_MS} ms`);
    let maxDurationMs: number | undefined;
    if (values['max-duration'] !== undefined) {
      maxDurationMs = Number(values['max-duration']);
      if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0 || maxDurationMs > MAX_TIMEOUT_MS) throw new UsageError(`--max-duration must be a positive number of milliseconds (at most ${MAX_TIMEOUT_MS})`);
    }

    if (values.local && values['no-local']) throw new UsageError('give either --local or --no-local, not both');
    const known = new Set([...RULES, ...MANUAL_ITEMS].map((x) => x.id));
    const unknownId = values.ignore?.find((id) => !known.has(id.toUpperCase()));
    if (unknownId !== undefined) throw new UsageError(`--ignore ${/^[a-z]+-\d+$/i.test(unknownId) ? unknownId : 'value'} is not a rule or MAN ID; --list-rules prints the catalog`);
    const headers: Record<string, string> = {};
    for (const h of values.header ?? []) { const [k, v] = parseHeader(h); headers[k] = v; }
    const bearer = values.bearer ?? env.MCP_REVIEW_CHECK_TOKEN ?? undefined;
    if (bearer !== undefined && /[\r\n]/.test(bearer)) throw new UsageError('--bearer must not contain CR or LF');

    let spec: TargetSpec;
    if (isStdio) {
      let parts: string[];
      if (split.command) parts = split.command;
      else try { parts = tokenizeCommand(values.stdio!); } catch (e) { throw new UsageError(`--stdio: ${(e as Error).message}`); }
      if (!parts.length) throw new UsageError('--stdio needs a command');
      const envVars: Record<string, string> = {};
      for (const kv of values.env ?? []) {
        const i = kv.indexOf('=');
        if (i <= 0) throw new UsageError('--env must look like K=V (no "=" found; the value is not shown)');
        envVars[kv.slice(0, i)] = kv.slice(i + 1);
      }
      spec = { kind: 'stdio', command: parts[0], args: parts.slice(1), env: envVars, cwd: values.cwd };
    } else {
      const raw = positionals[0];
      const hint = schemeSuggestion(raw);
      // "host:3000/mcp" parses as scheme "host:", so a missing scheme is checked before the protocol.
      if (hint) throw new UsageError(`the URL needs a scheme: did you mean ${shownUrl(hint)}?`);
      let u: URL;
      try { u = new URL(raw); } catch { throw new UsageError(`invalid URL: ${shownUrl(raw)}`); }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UsageError('URL must use http or https');
      if (values.env?.length || values.cwd) throw new UsageError('--env and --cwd apply only to --stdio');
      spec = { kind: 'http', url: raw };
    }

    let toolArgs: Record<string, unknown> | undefined;
    if (values['tool-args']) {
      try { toolArgs = JSON.parse(readFileSync(values['tool-args'], 'utf8')); } catch (e) {
        // A JSON syntax error message quotes the file (which may hold credentials): name the problem only.
        throw new UsageError(`cannot read --tool-args: ${e instanceof SyntaxError ? 'not valid JSON' : (e as Error).message}`);
      }
      if (typeof toolArgs !== 'object' || toolArgs === null || Array.isArray(toolArgs)) throw new UsageError('--tool-args must contain a JSON object {toolName: args}');
    }
    if (values['active-auth']) stderr += 'Notice: --active-auth creates a DCR client on your authorization server and sends bogus /authorize and /token requests.\n';

    const opts: BuildOptions = {
      target: spec, headers, bearer, timeoutMs, platforms: target, maxDurationMs,
      active: !!values.active, activeAuth: !!values['active-auth'], toolArgs,
      local: values.local ? true : values['no-local'] ? false : undefined,
    };
    // R-8: every value for the report and each output; before the rules only the strong ones (not --env FORMAT=text).
    redactor = redactorFor(opts, true);
    opts.redactor = redactorFor(opts);
    const started = new Date();
    stderr += staleCatalogWarning(started) ?? '';
    const t0 = performance.now();
    // Rules quote server text in cut snippets ("…") that a whole-value scrub of the report cannot recognise, so
    // buildSnapshot scrubs the strong values from what the server sent (before the input caps) and the rules see none.
    const { snap, stderrTail, tracer } = await buildSnapshot(opts);
    const result = runRules(snap, RULES, { ignore: values.ignore ?? [] });
    // No manual checklist when nothing connected: the connect failure is the only thing to act on.
    const built = buildReport(snap, result, snap.fatal ? [] : manualChecklist(snap), failOn, started, performance.now() - t0, !!values['fail-on-spec']);
    // The one place secrets leave the report: every string of the finished report is scrubbed before any format renders it.
    const report = redactDeep(built, redactor);

    // FORCE_COLOR as in Node: '', 1, 2, 3 or true colour without a TTY and over NO_COLOR; other values turn colour off (R-47).
    const tty = env.FORCE_COLOR !== undefined ? /^(|[123]|true)$/.test(env.FORCE_COLOR) : isTty && !env.NO_COLOR;
    const color = tty && !values['no-color'] && format === 'text' && !values.output;
    const banner = localBanner(report);
    if (banner && (format === 'json' || format === 'sarif')) stderr += `${banner}\n`; // stdout stays the document (U-12)
    const textOpts = { color, verbose: !!values.verbose, cta: ctaLine(report, env), quiet: !!values.quiet, checklist: !!values.checklist };
    const rerun = rerunCommand(argv, redactor);
    const body = render(report, format, textOpts, rerun, sarifLocation);
    if (env.GITHUB_ACTIONS === 'true') { // R-46: annotations go to stderr, so stdout stays the document (U-12)
      for (const a of annotations(report)) stderr += `${a}\n`;
      if (env.GITHUB_STEP_SUMMARY) stderr += appendStepSummary(env.GITHUB_STEP_SUMMARY, renderMarkdown(report, { cta: textOpts.cta, verbose: textOpts.verbose, rerun }));
    }
    if (values.verbose) {
      for (const e of tracer?.exchanges ?? []) stderr += `[http] ${e.label}: ${e.method} ${e.url} -> ${e.status ?? e.error?.message} (${Math.round(e.durationMs)} ms${e.bodyMs !== undefined && e.bodyMs - e.durationMs > 1000 ? `, body ${Math.round(e.bodyMs)} ms` : ''})\n`;
      if (stderrTail) stderr += `[stdio stderr]\n${stderrTail}\n`;
      stderr = scrub(stderr, redactor);
    }
    const code = snap.fatal || snap.limits?.stopped ? 3 : report.summary.failed ? 1 : 0; // a stop is exit 3 at any --fail-on (R-1)
    const s = report.summary;
    const summaryLine = `mcp-review-check: score ${scoreLabel(report)} · ${s.errors} errors · ${s.warnings} warnings · ${s.info} info · ${resultLine(report)}`;
    if (values.output) {
      try {
        writeFileSync(values.output, body);
      } catch (e) {
        // The server was checked: print the report instead of losing it, and report the write failure as exit 2.
        return { code: 2, stdout: body, stderr: `${stderr}error: cannot write --output ${values.output}: ${(e as Error).message}\n` };
      }
      return { code, stdout: '', stderr: stderr + summaryLine + ` · report written to ${values.output}\n` };
    }
    return { code, stdout: body, stderr };
  } catch (e) {
    if (e instanceof UsageError || (e as { code?: string }).code?.startsWith?.('ERR_PARSE_ARGS')) {
      // parseArgs names an unknown option without its "=value"; the rest of its message is not repeated.
      const unknown = (e as { code?: string }).code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' ? /'(-[^'=]*)/.exec((e as Error).message)?.[1] : undefined;
      const near = unknown && closestOption(unknown);
      const message = unknown ? `unknown option ${unknown}${near ? `; did you mean ${near}?` : ''}` : (e as Error).message;
      return { code: 2, stdout: '', stderr: `${stderr}error: ${message}\nRun with --help for usage.\n` };
    }
    // R-3: in GitHub Actions this exit 3 also gets one ::error, with the first line of the redacted error.
    const first = env.GITHUB_ACTIONS === 'true' ? `fatal: ${(e as Error)?.message ?? e}` : '';
    const ann = first ? `::error title=mcp-review-check::${escapeCommand((redactor ? scrub(first, redactor) : first).split('\n')[0])}\n` : '';
    const fatal = `${stderr}fatal: ${(e as Error).stack ?? e}\n`;
    return { code: 3, stdout: '', stderr: (redactor ? scrub(fatal, redactor) : fatal) + ann };
  }
}

const isMain = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();

if (isMain) {
  // The stdio servers lead their own process group (R-5), so a terminal's Ctrl+C reaches only the CLI: end them, then
  // die by the same signal (130, 143), also when the run finishes first and exits.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(signal, () => {
      process.once('exit', () => process.kill(process.pid, signal));
      void endAllNow().finally(() => process.exit());
    });
  }
  runCli(process.argv.slice(2)).then(({ code, stdout, stderr }) => {
    // Both streams may be async pipes: exit only after each one is flushed, or stderr is cut at 64 KB (R-7).
    process.stderr.write(stderr, () => process.stdout.write(stdout, () => process.exit(code)));
  });
}
