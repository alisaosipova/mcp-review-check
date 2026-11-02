#!/usr/bin/env node
// CLI entry: argument parsing, validation, orchestration, exit codes, --list-rules and explain.
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildSnapshot, endAllNow, redactorFor, type BuildOptions, type TargetSpec } from './connect.js';
import { explainRule, listRulesJson, listRulesText, rulesMarkdown } from './explain.js';
import { schemeSuggestion } from './diagnose.js';
import { redactDeep, scrub, type Redactor } from './redact.js';
import { cmdQuote, splitStdioArgv, tokenizeCommand } from './protocol/stdioArgs.js';
import { buildReport, resultLine, scoreLabel, visibleText, type Report } from './report/index.js';
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
import { isSafeToCall } from './probe/active.js';
import type { Snapshot, TargetOpt } from './snapshot.js';
import { toolName } from './rules/util/access.js';
import { VERSION } from './version.js';
import { addBaselineToMarkdown, addBaselineToText, BaselineError, knownFindings, loadBaseline, renderJsonWithBaseline, renderSarifWithBaseline, type FindingKey } from './baseline.js';
import type { Finding } from './rules/types.js';

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
  --json-output <file>    Also write the JSON report (as --format json prints it) to a file, whatever --format.
  --save-baseline <file>  The same, under the baseline name: write it now, pass it to --baseline on later runs.
  --sarif-location <path> Repository-relative path the SARIF results point at (default: .mcp-review-check).
  --timeout <ms>          Per-request timeout (default: 30000; HTTP connect uses min(timeout, 15000), stdio start uses the full timeout).
  --max-duration <ms>     Stop the whole check after this long and report what ran, exit 4 (default: no limit).
  --fail-on <level>       error | warning | never (default: error). Counts findings for the --target directories only.
  --fail-on-spec          Also fail on MCP spec findings (spec-only findings do not fail the run by default).
  --fail-on-incomplete    Exit 3 when the check is partial (auth required, token rejected, tools/list failed), so a
                          job without a working token does not pass; without it the exit code follows --fail-on.
  --baseline <file>       A JSON report of an earlier run (--format json): its findings are known, and only new ones
                          count for --fail-on and the verdicts (JSON baselined, SARIF baselineState).
  --local                 Local mode: deploy-time checks (HTTPS, public DNS, tunnel domains) are informational.
  --no-local              Strict deploy-time checks, also for loopback, private and dotless hosts and --stdio.
  --active                Call read-only tools (readOnlyHint: true) to run RT checks.
  --active-auth           Probe DCR, /authorize and /token. CREATES A DCR CLIENT on your authorization server.
  --tool-args <file>      JSON {toolName: args} for --active calls.
  --env K=V               Environment variable for --stdio (repeatable). Values are redacted in output.
  --cwd <dir>             Working directory for --stdio.
  --ignore <RULE-ID>      Ignore a rule (repeatable or comma-separated); an ID that is not a rule or MAN item is a usage error.
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

--stdio "<command>" is split on whitespace; quote arguments with spaces. A backslash is literal (Windows paths work),
also inside double quotes, except before a ": there, as on Windows, \\\\" is one \\ and ends the quote, \\" a literal ".
The "-- <command> [args...]" form passes arguments verbatim, with options before --.
Secrets are redacted in every format: --bearer, --header and --env values, URL credentials, and stdio arguments
after secret-looking flags (--api-key X, --token=X, API_KEY=X, "Authorization: Bearer X").

Exit codes:
  0       Completed, below the --fail-on threshold.
  1       Completed, threshold reached for a --target directory (or for the spec with --fail-on-spec).
  2       Usage or configuration error, or --output, --json-output or --save-baseline could not be written.
  3       Could not connect or complete a handshake (also when --max-duration ran out before it); with
          --fail-on-incomplete, a partial check (auth required, token rejected, tools/list failed); or an internal
          error of mcp-review-check itself (fatal: and a stack trace on stderr; please report it).
  4       Stopped by --max-duration after the handshake, at any --fail-on (the Result line reads INCOMPLETE).
  128+N   Ended by signal N: 130 Ctrl+C (SIGINT), 143 SIGTERM, 131 SIGQUIT, 129 SIGHUP. A stdio server is ended first
          and no report is written.

The exit code counts findings at each directory's own severity for --target (all = Claude and ChatGPT); MCP spec
findings are reported but count only with --fail-on-spec. The Result line names the findings that failed the run.
The score (100 - 12 per rule with errors - 4 per rule with only warnings) is provisional.
With GITHUB_ACTIONS=true, findings are also printed as ::error/::warning annotations on stderr (at the --target
severity), exit 3 and 4 as one ::error with its cause, a partial check as one ::warning naming why, and the markdown
report is appended to $GITHUB_STEP_SUMMARY when it is set.
No telemetry is sent. Passing these checks does not guarantee directory approval.
`;

class UsageError extends Error {}

const OPTIONS = {
  stdio: { type: 'string' }, header: { type: 'string', multiple: true }, bearer: { type: 'string' },
  target: { type: 'string', default: 'all' }, format: { type: 'string', default: 'text' }, output: { type: 'string' }, 'sarif-location': { type: 'string' },
  timeout: { type: 'string', default: '30000' }, 'max-duration': { type: 'string' }, 'fail-on': { type: 'string', default: 'error' }, 'fail-on-spec': { type: 'boolean' },
  'fail-on-incomplete': { type: 'boolean' }, baseline: { type: 'string' }, 'save-baseline': { type: 'string' }, 'json-output': { type: 'string' },
  active: { type: 'boolean' }, 'active-auth': { type: 'boolean' }, 'tool-args': { type: 'string' },
  env: { type: 'string', multiple: true }, cwd: { type: 'string' }, ignore: { type: 'string', multiple: true },
  'list-rules': { type: 'boolean' }, 'no-color': { type: 'boolean' }, verbose: { type: 'boolean' },
  quiet: { type: 'boolean' }, checklist: { type: 'boolean' }, local: { type: 'boolean' }, 'no-local': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
} as const;

/** The known option nearest to an unknown one (Levenshtein distance at most 2), for "did you mean". */
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

/** One line for a parseArgs error: the option and what it needs, never its value or Node's multi-line advice. */
function usageMessage(e: Error & { code?: string }): string {
  const option = /'(?:-\w, )?(-[^'=\s,]*)/.exec(e.message)?.[1];
  if (option && e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
    const near = closestOption(option);
    return `unknown option ${option}${near ? `; did you mean ${near}?` : ''}`;
  }
  if (option && e.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    if (/ambiguous/.test(e.message)) return `${option} needs a value; write ${option}=<value> for a value that starts with "-"`;
    return /does not take an argument/.test(e.message) ? `${option} takes no value` : `${option} needs a value`;
  }
  return e.message.split('\n')[0];
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
  // An RFC 9110 token, or fetch rejects the name on every request and the run looks like a connect failure (exit 3).
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k)) throw new UsageError('--header name must be an HTTP token: letters, digits and !#$%&\'*+.^_`|~- (the value is not shown)');
  return [k, v];
}

/** `known` (with --baseline): the findings of the baseline report, which `r.findings` (the new ones) leaves out. */
function render(r: Report, format: string, opts: TextOptions, rerun: string, sarifLocation: string, known?: Finding[]): string {
  switch (format) {
    case 'json': return known ? renderJsonWithBaseline(r, known) : renderJson(r);
    case 'markdown': return markdownReport(r, { cta: opts.cta, verbose: opts.verbose, rerun }, known); // --quiet and --checklist are text only
    case 'sarif': return known ? renderSarifWithBaseline(r, known, sarifLocation) : renderSarif(r, sarifLocation);
    default: return known ? addBaselineToText(renderText(r, opts), known, opts.quiet) : renderText(r, opts);
  }
}

/** The markdown report (also the job summary), with the known findings of --baseline as one line. */
function markdownReport(r: Report, opts: Parameters<typeof renderMarkdown>[1], known?: Finding[]): string {
  const md = renderMarkdown(r, opts);
  return known ? addBaselineToMarkdown(md, known) : md;
}

/** The command line that reproduces the report, secrets redacted; the text-only --quiet and --checklist are left out.
 *  --bearer, --header and --env values masked by position at any length, the URL through displayUrl, then scrub. */
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
  // cmd.exe takes no single quotes: on Windows an argument is double-quoted by the Windows argv rule, for cmd.exe.
  const quote = process.platform === 'win32' ? cmdQuote : (a: string) => `'${a.replace(/'/g, "'\\''")}'`;
  return ['npx mcp-review-check', ...args.map((a) => (/^[\w@%+=:,./«»-]+$/.test(a) ? a : quote(a)))].join(' ');
}

/** --tool-args as Windows editors save it, too: UTF-8 with or without a BOM, or UTF-16LE with its BOM. */
function readToolArgs(file: string): Record<string, unknown> {
  const raw = readFileSync(file);
  return JSON.parse((raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8')).replace(/^\uFEFF/, ''));
}

/** One warning line per --tool-args entry that no --active call used, with the reason, so typos and non-read-only tools show. */
function unusedToolArgs(toolArgs: Record<string, unknown>, snap: Snapshot): string {
  const used = new Set(snap.active?.calls.filter((c) => c.kind === 'valid').map((c) => c.tool));
  return Object.keys(toolArgs).filter((name) => !used.has(name)).map((name) => {
    const tool = snap.tools.find((t) => toolName(t) === name);
    const why = !tool ? 'the server lists no tool by that name' : !isSafeToCall(tool) ? 'the tool is not read-only (readOnlyHint: true), so --active does not call it' : 'the tool was past the cap on --active calls';
    return `warning: --tool-args entry ${JSON.stringify(name)} was not used: ${why}\n`;
  }).join('');
}

/** A URL for a usage error: everything up to the last "@" after the scheme (a password may hold "/", "?" or "#"), query and fragment hidden. */
function shownUrl(raw: string): string {
  return raw.replace(/\/\/.*@/s, '//…@').replace(/[?#].*$/s, (q) => (q.length > 1 ? `${q[0]}…` : q));
}

/**
 * `interrupted` is aborted by SIGINT/SIGTERM (its reason the signal number): a run that still finishes in the grace
 * period writes no report, since the checks after the signal ran against servers being killed.
 */
export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env, isTty = !!process.stdout.isTTY, interrupted?: AbortSignal): Promise<CliResult> {
  let stderr = '';
  let redactor: Redactor | undefined;
  try {
    const split = splitStdioArgv(argv);
    const { values, positionals } = parseArgs({
      args: split.args, allowPositionals: true, strict: true, options: OPTIONS,
    });
    // Keywords in any case, as --ignore and explain take IDs in any case: --format JSON, --target Claude, --fail-on Warning.
    const format = values.format!.toLowerCase();
    if (values.help) return { code: 0, stdout: HELP, stderr };
    if (values.version) return { code: 0, stdout: `${VERSION}\n`, stderr };
    if (values['list-rules']) {
      if (positionals.length > 1) throw new UsageError('--list-rules takes at most one rule ID prefix');
      // Only an ID-like prefix filters; anything else (a URL with a token, a path) lists the whole catalog, as the baseline did, unrepeated.
      const prefix = /^[A-Z]+(-\d*)?$/i.test(positionals[0] ?? '') ? positionals[0].toUpperCase() : '';
      const rules = RULES.filter((r) => r.id.startsWith(prefix));
      const manual = MANUAL_ITEMS.filter((m) => m.id.startsWith(prefix));
      if (!rules.length && !manual.length) throw new UsageError(`no rule or MAN ID starts with ${prefix}`);
      if (!['text', 'json', 'markdown', 'sarif'].includes(format)) throw new UsageError('--list-rules --format must be text, json or markdown');
      // SARIF has no catalog form; print the text catalog with a warning and exit 0, as the 0.1.0 baseline did.
      if (format === 'sarif') stderr += 'warning: --format sarif does not apply to --list-rules; printing text\n';
      const list = format === 'json' ? listRulesJson(rules, manual) : format === 'markdown' ? `${rulesMarkdown(rules, manual)}\n` : listRulesText(rules, manual, !!values.verbose);
      return { code: 0, stdout: list, stderr };
    }
    if (positionals[0] === 'explain') {
      if (positionals.length !== 2) throw new UsageError('usage: mcp-review-check explain <RULE-ID>');
      const text = explainRule(positionals[1]);
      if (!text) throw new UsageError(`unknown rule ID ${/^[a-z]+-\d+$/i.test(positionals[1]) ? positionals[1] : '(value not shown)'}; --list-rules prints the catalog`);
      return { code: 0, stdout: text, stderr };
    }

    // A "--" that splitStdioArgv did not take (--stdio has a value, or no bare --stdio before it) left the command in positionals.
    if ((split.command || split.args.includes('--')) && values.stdio !== undefined) throw new UsageError('give --stdio either "<command>" or -- <command> [args...], not both');
    if (!split.command && split.args.includes('--')) throw new UsageError('"-- <command> [args...]" needs a bare --stdio before the --');
    if (positionals.length > 1) throw new UsageError('expected a single <url>');
    const isStdio = values.stdio !== undefined || split.command !== undefined;
    if ((positionals.length === 1) === isStdio) throw new UsageError('give exactly one of <url> or --stdio "<command>"');
    const target = values.target!.toLowerCase() as TargetOpt;
    if (!['claude', 'chatgpt', 'all'].includes(target)) throw new UsageError('--target must be claude, chatgpt or all');
    if (!['text', 'json', 'markdown', 'sarif'].includes(format)) throw new UsageError('--format must be text, json, markdown or sarif');
    const sarifLocation = values['sarif-location'] ?? SARIF_LOCATION;
    // Code scanning takes repository-relative paths only: no scheme (C: included), no leading / or \, no "..".
    if (!sarifLocation || /^([a-z][a-z0-9+.-]*:|[\\/])/i.test(sarifLocation) || sarifLocation.split(/[\\/]/).includes('..')) throw new UsageError('--sarif-location must be a relative path without a scheme or ".." (the value is not shown)');
    const failOn = values['fail-on']!.toLowerCase() as FailOn;
    if (!['error', 'warning', 'never'].includes(failOn)) throw new UsageError('--fail-on must be error, warning or never');
    // Digits only: Number() would also take 0x10, 1e2, 1.5 and blanks.
    const timeoutMs = /^\d+$/.test(values.timeout!) ? Number(values.timeout) : NaN;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new UsageError('--timeout must be a positive whole number of milliseconds');
    // Node clamps larger setTimeout delays to 1 ms; withTimeout adds a 1000 ms margin on top.
    if (timeoutMs > MAX_TIMEOUT_MS) throw new UsageError(`--timeout must be at most ${MAX_TIMEOUT_MS} ms`);
    let maxDurationMs: number | undefined;
    if (values['max-duration'] !== undefined) {
      maxDurationMs = /^\d+$/.test(values['max-duration']) ? Number(values['max-duration']) : NaN;
      if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0 || maxDurationMs > MAX_TIMEOUT_MS) throw new UsageError(`--max-duration must be a positive whole number of milliseconds (at most ${MAX_TIMEOUT_MS})`);
    }

    if (values.output === '') throw new UsageError('--output needs a file path');
    // --save-baseline and --json-output: the JSON report, besides the primary output (the GitHub Action reads it).
    const jsonOutputs = (['save-baseline', 'json-output'] as const).flatMap((opt) => {
      const path = values[opt];
      if (path === undefined) return [];
      if (path === '') throw new UsageError(`--${opt} needs a file path`);
      if (values.output !== undefined && format !== 'json' && resolve(path) === resolve(values.output)) throw new UsageError(`--${opt} and --output name the same file; --output gets the --format ${format} report`);
      return [[`--${opt}`, path] as const];
    });
    if (values.local && values['no-local']) throw new UsageError('give either --local or --no-local, not both');
    const known = new Set([...RULES, ...MANUAL_ITEMS].map((x) => x.id));
    // "--ignore A,B" as many linters take it, besides --ignore A --ignore B.
    const ignore = (values.ignore ?? []).flatMap((v) => v.split(',')).map((v) => v.trim());
    const unknownId = ignore.find((id) => !known.has(id.toUpperCase()));
    if (unknownId !== undefined) throw new UsageError(`--ignore ${/^[a-z]+-\d+$/i.test(unknownId) ? unknownId : 'value'} is not a rule or MAN ID; --list-rules prints the catalog`);
    const headers: Record<string, string> = {};
    for (const h of values.header ?? []) {
      const [k, v] = parseHeader(h);
      // fetch joins names that differ only in case into one "A, B" value: a name is given once.
      if (Object.keys(headers).some((n) => n.toLowerCase() === k.toLowerCase())) throw new UsageError(`--header ${k} is given more than once; give each header once`);
      headers[k] = v;
    }
    const authHeader = Object.keys(headers).some((n) => n.toLowerCase() === 'authorization');
    if (authHeader && values.bearer !== undefined) throw new UsageError('give the token either with --bearer or with --header "Authorization: …", not both');
    // Bearer and headers go only to a <url>; an --header Authorization wins over $MCP_REVIEW_CHECK_TOKEN, as an explicit option.
    const bearer = isStdio || authHeader ? values.bearer : values.bearer ?? env.MCP_REVIEW_CHECK_TOKEN ?? undefined;
    if (bearer !== undefined && /[\r\n]/.test(bearer)) throw new UsageError('--bearer must not contain CR or LF');

    let spec: TargetSpec;
    const typedEnv: Record<string, string> = {}; // --env names as typed: they decide a value's redaction tier
    if (isStdio) {
      let parts: string[];
      if (split.command) parts = split.command;
      else try { parts = tokenizeCommand(values.stdio!); } catch (e) { throw new UsageError(`--stdio: ${(e as Error).message}`); }
      if (!parts.length) throw new UsageError('--stdio needs a command');
      // Nothing is sent to a stdio server: a token or header would only mark the run as authenticated (RT-009 off).
      if (values.bearer !== undefined || values.header?.length) throw new UsageError('--bearer and --header apply only to <url>');
      if (values['active-auth']) throw new UsageError('--active-auth applies only to <url>: a stdio server has no authorization server to probe');
      const envVars: Record<string, string> = {};
      for (const kv of values.env ?? []) {
        const i = kv.indexOf('=');
        if (i <= 0) throw new UsageError('--env must look like K=V (no "=" found; the value is not shown)');
        typedEnv[kv.slice(0, i)] = kv.slice(i + 1);
        // Windows names are case-insensitive: --env Path=… replaces the inherited PATH instead of losing to it.
        envVars[process.platform === 'win32' ? kv.slice(0, i).toUpperCase() : kv.slice(0, i)] = kv.slice(i + 1);
      }
      // spawn reports a missing cwd as "spawn <command> ENOENT", like a missing command: check it here.
      if (values.cwd !== undefined && !statSync(values.cwd, { throwIfNoEntry: false })?.isDirectory()) throw new UsageError('--cwd must be an existing directory (the value is not shown)');
      spec = { kind: 'stdio', command: parts[0], args: parts.slice(1), env: envVars, cwd: values.cwd };
    } else {
      const raw = positionals[0];
      const hint = schemeSuggestion(raw);
      // "host:3000/mcp" parses as scheme "host:", so a missing scheme is checked before the protocol.
      if (hint) throw new UsageError(`the URL needs a scheme: did you mean ${shownUrl(hint)}?`);
      let u: URL;
      try { u = new URL(raw); } catch { throw new UsageError(`invalid URL: ${shownUrl(raw)}`); }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UsageError('URL must use http or https');
      if (values.env?.length || values.cwd !== undefined) throw new UsageError('--env and --cwd apply only to --stdio');
      spec = { kind: 'http', url: raw };
    }

    let toolArgs: Record<string, unknown> | undefined;
    if (values['tool-args']) {
      try { toolArgs = readToolArgs(values['tool-args']); } catch (e) {
        // A JSON syntax error message quotes the file (which may hold credentials): name the problem only.
        throw new UsageError(`cannot read --tool-args: ${e instanceof SyntaxError ? 'not valid JSON' : (e as Error).message}`);
      }
      if (typeof toolArgs !== 'object' || toolArgs === null || Array.isArray(toolArgs)) throw new UsageError('--tool-args must contain a JSON object {toolName: args}');
    }
    // Read before connecting: a wrong --baseline is a usage error (exit 2), not a finished run that gated on everything.
    let baseline: FindingKey[] | undefined;
    if (values.baseline !== undefined) {
      if (!values.baseline) throw new UsageError('--baseline needs a file path');
      try { baseline = loadBaseline(values.baseline); } catch (e) {
        if (e instanceof BaselineError) throw new UsageError(e.message);
        throw e;
      }
    }
    if (values['active-auth']) stderr += 'Notice: --active-auth creates a DCR client on your authorization server and sends bogus /authorize and /token requests.\n';
    // Accepted for scripts that share one option set, but said: the user should not think they took effect.
    if (toolArgs && !values.active) stderr += 'warning: --tool-args has no effect without --active\n';
    if (values['sarif-location'] !== undefined && format !== 'sarif') stderr += 'warning: --sarif-location applies only to --format sarif\n';

    const opts: BuildOptions = {
      target: spec, headers, bearer, timeoutMs, platforms: target, maxDurationMs,
      active: !!values.active, activeAuth: !!values['active-auth'], toolArgs,
      local: values.local ? true : values['no-local'] ? false : undefined,
    };
    // Every value for the report and each output; before the rules only the strong ones (not --env FORMAT=text).
    // Tiers go by the --env names as typed, not as upper-cased for the server on win32 (signingKey is secret, SIGNINGKEY not).
    const typed: BuildOptions = spec.kind === 'stdio' ? { ...opts, target: { ...spec, env: typedEnv } } : opts;
    redactor = redactorFor(typed, true);
    opts.redactor = redactorFor(typed);
    const started = new Date();
    stderr += staleCatalogWarning(started) ?? '';
    const t0 = performance.now();
    // Rules quote server text in cut snippets ("…") that a whole-value scrub of the report cannot recognise, so
    // buildSnapshot scrubs the strong values from what the server sent (before the input caps) and the rules see none.
    const { snap, stderrTail, tracer } = await buildSnapshot(opts);
    if (interrupted?.aborted) {
      const n = typeof interrupted.reason === 'number' ? interrupted.reason : 2;
      return { code: 128 + n, stdout: '', stderr: `${stderr}mcp-review-check: interrupted by a signal; no report written\n` };
    }
    if (toolArgs && snap.active) stderr += unusedToolArgs(toolArgs, snap);
    const result = runRules(snap, RULES, { ignore });
    // --baseline: the known findings leave the report (the gate, the verdicts and the counts see only new ones) and are
    // added back by each format. They are compared redacted, as the baseline report was written; the score keeps every finding.
    let gated = result;
    let knownRaw: Finding[] | undefined;
    if (baseline) {
      const isKnown = knownFindings(redactDeep(result.findings, redactor), baseline);
      knownRaw = result.findings.filter((_, i) => isKnown[i]);
      gated = { ...result, findings: result.findings.filter((_, i) => !isKnown[i]), scored: result.scored ?? result.findings };
    }
    // No manual checklist when nothing connected: the connect failure is the only thing to act on.
    const ignoredIds = new Set(ignore.map((id) => id.toUpperCase())); // --ignore MAN-xxx hides the item
    const built = buildReport(snap, gated, snap.fatal ? [] : manualChecklist(snap).filter((m) => !ignoredIds.has(m.id)), failOn, started, performance.now() - t0, !!values['fail-on-spec']);
    // The one place secrets leave the report: every string of the finished report is scrubbed before any format renders it.
    const report = redactDeep(built, redactor);
    const baselined = knownRaw && redactDeep(knownRaw, redactor);

    // FORCE_COLOR as in Node: '', 1, 2, 3 or true colour without a TTY and over NO_COLOR; other values turn colour off.
    const tty = env.FORCE_COLOR !== undefined ? /^(|[123]|true)$/.test(env.FORCE_COLOR) : isTty && !env.NO_COLOR;
    const color = tty && !values['no-color'] && format === 'text' && !values.output;
    const banner = localBanner(report);
    if (banner && (format === 'json' || format === 'sarif')) stderr += `${banner}\n`; // stdout stays the document
    const textOpts = { color, verbose: !!values.verbose, cta: ctaLine(report, env), quiet: !!values.quiet, checklist: !!values.checklist };
    const rerun = rerunCommand(argv, redactor);
    const body = render(report, format, textOpts, rerun, sarifLocation, baselined);
    if (env.GITHUB_ACTIONS === 'true') { // annotations go to stderr, so stdout stays the document
      for (const a of annotations(report)) stderr += `${a}\n`;
      if (env.GITHUB_STEP_SUMMARY) stderr += appendStepSummary(env.GITHUB_STEP_SUMMARY, markdownReport(report, { cta: textOpts.cta, verbose: textOpts.verbose, rerun }, baselined));
    }
    if (values.verbose) {
      // Server-controlled text (a URL, an error message, the stderr tail) shows control and format characters as
      // \u{..}, so an ESC sequence, a CR or a bidi override cannot rewrite the terminal or a CI log (F135).
      for (const e of tracer?.exchanges ?? []) stderr += visibleText(`[http] ${e.label}: ${e.method} ${e.url} -> ${e.status ?? e.error?.message} (${Math.round(e.durationMs)} ms${e.bodyMs !== undefined && e.bodyMs - e.durationMs > 1000 ? `, body ${Math.round(e.bodyMs)} ms` : ''})`) + '\n';
      if (stderrTail) stderr += `[stdio stderr]\n${stderrTail.split(/\r?\n/).map(visibleText).join('\n')}\n`;
      stderr = scrub(stderr, redactor);
    }
    // A stop after the handshake is exit 4 at any --fail-on, so CI can tell "too slow" (4) from "unreachable" (3).
    // A partial check (no or a rejected token, tools/list failed) follows --fail-on unless --fail-on-incomplete.
    const partial = snap.coverage.toolLevel !== 'ok';
    const code = snap.fatal ? 3 : snap.limits?.stopped ? 4 : values['fail-on-incomplete'] && partial ? 3 : report.summary.failed ? 1 : 0;
    const s = report.summary;
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const fromBaseline = baselined ? ` · ${baselined.length} known from baseline` : '';
    const summaryLine = `mcp-review-check: score ${scoreLabel(report)} · ${plural(s.errors, 'error')} · ${plural(s.warnings, 'warning')} · ${s.info} info${fromBaseline} · ${resultLine(report)}`;
    // The JSON report for --save-baseline and --json-output: the --format json document, baselined marks included,
    // rendered from the same redacted report. A file that cannot be written is exit 2, as for --output.
    const jsonDoc = !jsonOutputs.length ? '' : format === 'json' ? body : render(report, 'json', textOpts, rerun, sarifLocation, baselined);
    const written: string[] = [];
    let writeErrors = '';
    for (const [flag, path] of jsonOutputs) {
      try {
        writeFileSync(path, jsonDoc);
        if (!written.includes(path)) written.push(path);
      } catch (e) {
        writeErrors += `error: cannot write ${flag} ${path}: ${(e as Error).message}\n`;
      }
    }
    const jsonNote = written.length ? `JSON report written to ${written.join(', ')}` : '';
    const finalCode = writeErrors ? 2 : code;
    if (values.output) {
      try {
        writeFileSync(values.output, body);
      } catch (e) {
        // The server was checked: print the report instead of losing it, and report the write failure as exit 2.
        return { code: 2, stdout: body, stderr: `${stderr}${writeErrors}error: cannot write --output ${values.output}: ${(e as Error).message}\n` };
      }
      return { code: finalCode, stdout: '', stderr: stderr + writeErrors + summaryLine + ` · report written to ${values.output}${jsonNote ? ` · ${jsonNote}` : ''}\n` };
    }
    return { code: finalCode, stdout: body, stderr: stderr + writeErrors + (jsonNote ? `mcp-review-check: ${jsonNote}\n` : '') };
  } catch (e) {
    if (e instanceof UsageError || (e as { code?: string }).code?.startsWith?.('ERR_PARSE_ARGS')) {
      // parseArgs names an option without its "=value"; the rest of its message is not repeated.
      const message = e instanceof UsageError ? e.message : usageMessage(e as Error & { code?: string });
      return { code: 2, stdout: '', stderr: `${stderr}error: ${message}\nRun with --help for usage.\n` };
    }
    // In GitHub Actions this exit 3 also gets one ::error, with the first line of the redacted error.
    const first = env.GITHUB_ACTIONS === 'true' ? `fatal: ${(e as Error)?.message ?? e}` : '';
    const ann = first ? `::error title=mcp-review-check::${escapeCommand((redactor ? scrub(first, redactor) : first).split('\n')[0])}\n` : '';
    const fatal = `${stderr}fatal: ${(e as Error).stack ?? e}\n`;
    return { code: 3, stdout: '', stderr: (redactor ? scrub(fatal, redactor) : fatal) + ann };
  }
}

// `node dist/cli` runs dist/cli.js (Node adds the extension) with argv[1] still "dist/cli", which has no real path:
// try the typed path, then with ".js", so the CLI does not exit 0 without running.
const isMain = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  for (const path of [arg, `${arg}.js`]) {
    try { return realpathSync(path) === fileURLToPath(import.meta.url); } catch { /* no such file: try the next form */ }
  }
  return false;
})();

if (isMain) {
  // The stdio servers lead their own process group, so a terminal's Ctrl+C or Ctrl+\ reaches only the CLI: end
  // them, then die by the same signal (130, 131, 143), also when the run finishes first and exits; on Windows, where
  // a process cannot die by a signal, exit 128 + its number. A second signal SIGKILLs every server at once.
  const signals = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGTERM: 15 };
  let signalled = false;
  const interrupted = new AbortController();
  for (const [signal, n] of Object.entries(signals)) {
    process.on(signal, () => {
      void endAllNow(signalled).finally(() => process.exit());
      if (signalled) return;
      signalled = true;
      interrupted.abort(n);
      process.once('exit', () => {
        if (process.platform === 'win32') { process.exitCode = 128 + n; return; }
        for (const s of Object.keys(signals)) process.removeAllListeners(s);
        process.kill(process.pid, signal);
      });
    });
  }
  runCli(process.argv.slice(2), process.env, !!process.stdout.isTTY, interrupted.signal).then(({ code, stdout, stderr }) => {
    // Both streams may be async pipes: exit only after each one is flushed, or stderr is cut at 64 KB.
    process.stderr.write(stderr, () => process.stdout.write(stdout, () => process.exit(code)));
  });
}
