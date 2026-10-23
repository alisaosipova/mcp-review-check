#!/usr/bin/env node
// CLI entry: argument parsing, validation, orchestration, exit codes, --list-rules.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildSnapshot, type BuildOptions, type TargetSpec } from './connect.js';
import { tokenizeCommand } from './protocol/stdioArgs.js';
import { buildReport, scoreLabel, type Report } from './report/index.js';
import { renderJson } from './report/json.js';
import { renderMarkdown } from './report/markdown.js';
import { renderSarif } from './report/sarif.js';
import type { FailOn } from './report/score.js';
import { renderText } from './report/text.js';
import { CATALOG_DATE, manualChecklist, MANUAL_ITEMS, RULES, runRules } from './rules/index.js';
import type { TargetOpt } from './snapshot.js';
import { VERSION } from './version.js';

const HELP = `mcp-review-check ${VERSION} (rules ${CATALOG_DATE})
Lint an MCP server against the Claude connector directory, ChatGPT plugin directory and MCP spec.

Usage:
  mcp-review-check <url> [options]
  mcp-review-check --stdio "<command> [args...]" [options]

Options:
  --header "K: V"         Extra request header (repeatable). Values are redacted in output.
  --bearer <token>        Bearer token (default: $MCP_REVIEW_CHECK_TOKEN).
  --target <t>            claude | chatgpt | all (default: all)
  --format <f>            text | json | markdown | sarif (default: text)
  --output <file>         Write the report to a file; print a summary line to stderr.
  --timeout <ms>          Per-request timeout (default: 30000; HTTP connect uses min(timeout, 15000), stdio start uses the full timeout).
  --fail-on <level>       error | warning | never (default: error)
  --active                Call read-only tools (readOnlyHint: true) to run RT checks.
  --active-auth           Probe DCR, /authorize and /token. CREATES A DCR CLIENT on your authorization server.
  --tool-args <file>      JSON {toolName: args} for --active calls.
  --env K=V               Environment variable for --stdio (repeatable).
  --cwd <dir>             Working directory for --stdio.
  --ignore <RULE-ID>      Ignore a rule (repeatable).
  --list-rules            Print the rule catalog and exit.
  --no-color              Disable colors (also off when not a TTY or NO_COLOR is set).
  --verbose               Expand collapsed findings; print the redacted HTTP trace and stdio stderr.
  -h, --help              Show this help.
  -v, --version           Show the version.

Exit codes: 0 below --fail-on threshold, 1 threshold reached, 2 usage error (or --output not writable), 3 could not connect.
The score (100 - 12/error - 4/warning, max 3 per rule) is provisional.
No telemetry is sent. Passing these checks does not guarantee directory approval.
`;

class UsageError extends Error {}

/** Largest --timeout: 2^31-1 ms (the setTimeout limit) minus the 1000 ms margin used in withTimeout. */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1 - 1000;

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function parseHeader(raw: string): [string, string] {
  const i = raw.indexOf(':');
  if (i <= 0) throw new UsageError(`--header must look like "Name: value" (got "${raw}")`);
  const k = raw.slice(0, i).trim();
  const v = raw.slice(i + 1).trim();
  if (/[\r\n]/.test(k) || /[\r\n]/.test(v)) throw new UsageError('--header values must not contain CR or LF');
  return [k, v];
}

function listRules(): string {
  const lines = [`${'ID'.padEnd(9)} ${'SEVERITY BY PLATFORM'.padEnd(46)} TITLE  (SOURCE)`];
  for (const r of RULES) {
    const plats = Object.entries(r.severity).map(([p, s]) => `${p}=${s}`).join(', ');
    lines.push(`${r.id.padEnd(9)} ${plats.padEnd(46)} ${r.title}  (${r.sources[0]})`);
  }
  for (const m of MANUAL_ITEMS) lines.push(`${m.id.padEnd(9)} ${`${m.platforms[0]}=manual`.padEnd(46)} ${m.text}  (${m.docs[0]})`);
  return lines.join('\n') + '\n';
}

function render(r: Report, format: string, color: boolean, verbose: boolean): string {
  switch (format) {
    case 'json': return renderJson(r);
    case 'markdown': return renderMarkdown(r);
    case 'sarif': return renderSarif(r);
    default: return renderText(r, { color, verbose });
  }
}

export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env, isTty = !!process.stdout.isTTY): Promise<CliResult> {
  let stderr = '';
  try {
    const { values, positionals } = parseArgs({
      args: argv, allowPositionals: true, strict: true,
      options: {
        stdio: { type: 'string' }, header: { type: 'string', multiple: true }, bearer: { type: 'string' },
        target: { type: 'string', default: 'all' }, format: { type: 'string', default: 'text' }, output: { type: 'string' },
        timeout: { type: 'string', default: '30000' }, 'fail-on': { type: 'string', default: 'error' },
        active: { type: 'boolean' }, 'active-auth': { type: 'boolean' }, 'tool-args': { type: 'string' },
        env: { type: 'string', multiple: true }, cwd: { type: 'string' }, ignore: { type: 'string', multiple: true },
        'list-rules': { type: 'boolean' }, 'no-color': { type: 'boolean' }, verbose: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
      },
    });
    if (values.help) return { code: 0, stdout: HELP, stderr };
    if (values.version) return { code: 0, stdout: `${VERSION}\n`, stderr };
    if (values['list-rules']) return { code: 0, stdout: listRules(), stderr };

    if (positionals.length > 1) throw new UsageError('expected a single <url>');
    if ((positionals.length === 1) === (values.stdio !== undefined)) throw new UsageError('give exactly one of <url> or --stdio "<command>"');
    const target = values.target as TargetOpt;
    if (!['claude', 'chatgpt', 'all'].includes(target)) throw new UsageError('--target must be claude, chatgpt or all');
    const format = values.format!;
    if (!['text', 'json', 'markdown', 'sarif'].includes(format)) throw new UsageError('--format must be text, json, markdown or sarif');
    const failOn = values['fail-on'] as FailOn;
    if (!['error', 'warning', 'never'].includes(failOn)) throw new UsageError('--fail-on must be error, warning or never');
    const timeoutMs = Number(values.timeout);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new UsageError('--timeout must be a positive number of milliseconds');
    // Node clamps larger setTimeout delays to 1 ms; withTimeout adds a 1000 ms margin on top.
    if (timeoutMs > MAX_TIMEOUT_MS) throw new UsageError(`--timeout must be at most ${MAX_TIMEOUT_MS} ms`);

    const headers: Record<string, string> = {};
    for (const h of values.header ?? []) { const [k, v] = parseHeader(h); headers[k] = v; }
    const bearer = values.bearer ?? env.MCP_REVIEW_CHECK_TOKEN ?? undefined;
    if (bearer !== undefined && /[\r\n]/.test(bearer)) throw new UsageError('--bearer must not contain CR or LF');

    let spec: TargetSpec;
    if (values.stdio !== undefined) {
      let parts: string[];
      try { parts = tokenizeCommand(values.stdio); } catch (e) { throw new UsageError(`--stdio: ${(e as Error).message}`); }
      if (!parts.length) throw new UsageError('--stdio needs a command');
      const envVars: Record<string, string> = {};
      for (const kv of values.env ?? []) {
        const i = kv.indexOf('=');
        if (i <= 0) throw new UsageError(`--env must look like K=V (got "${kv}")`);
        envVars[kv.slice(0, i)] = kv.slice(i + 1);
      }
      spec = { kind: 'stdio', command: parts[0], args: parts.slice(1), env: envVars, cwd: values.cwd };
    } else {
      const raw = positionals[0];
      let u: URL;
      try { u = new URL(raw); } catch { throw new UsageError(`invalid URL: ${raw}`); }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UsageError('URL must use http or https');
      if (values.env?.length || values.cwd) throw new UsageError('--env and --cwd apply only to --stdio');
      spec = { kind: 'http', url: raw };
    }

    let toolArgs: Record<string, unknown> | undefined;
    if (values['tool-args']) {
      try { toolArgs = JSON.parse(readFileSync(values['tool-args'], 'utf8')); } catch (e) { throw new UsageError(`cannot read --tool-args: ${(e as Error).message}`); }
      if (typeof toolArgs !== 'object' || toolArgs === null || Array.isArray(toolArgs)) throw new UsageError('--tool-args must contain a JSON object {toolName: args}');
    }
    if (values['active-auth']) stderr += 'Notice: --active-auth creates a DCR client on your authorization server and sends bogus /authorize and /token requests.\n';

    const opts: BuildOptions = {
      target: spec, headers, bearer, timeoutMs, platforms: target,
      active: !!values.active, activeAuth: !!values['active-auth'], toolArgs,
    };
    const started = new Date();
    const t0 = performance.now();
    const { snap, stderrTail, tracer } = await buildSnapshot(opts);
    const result = runRules(snap, RULES, { ignore: values.ignore ?? [] });
    const report = buildReport(snap, result, manualChecklist(snap), failOn, started, performance.now() - t0);

    const color = isTty && !values['no-color'] && !env.NO_COLOR && format === 'text' && !values.output;
    const body = render(report, format, color, !!values.verbose);
    if (values.verbose) {
      for (const e of tracer?.exchanges ?? []) stderr += `[http] ${e.label}: ${e.method} ${e.url} -> ${e.status ?? e.error?.message} (${Math.round(e.durationMs)} ms${e.bodyMs !== undefined && e.bodyMs - e.durationMs > 1000 ? `, body ${Math.round(e.bodyMs)} ms` : ''})\n`;
      if (stderrTail) stderr += `[stdio stderr]\n${stderrTail}\n`;
    }
    const code = snap.fatal ? 3 : report.summary.failed ? 1 : 0;
    const s = report.summary;
    const summaryLine = `mcp-review-check: score ${scoreLabel(report)} · ${s.errors} errors · ${s.warnings} warnings · ${s.info} info · ${s.failed ? 'FAIL' : 'PASS'}`;
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
      return { code: 2, stdout: '', stderr: `${stderr}error: ${(e as Error).message}\nRun with --help for usage.\n` };
    }
    return { code: 3, stdout: '', stderr: `${stderr}fatal: ${(e as Error).stack ?? e}\n` };
  }
}

const isMain = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();

if (isMain) {
  runCli(process.argv.slice(2)).then(({ code, stdout, stderr }) => {
    if (stderr) process.stderr.write(stderr);
    process.stdout.write(stdout, () => process.exit(code));
  });
}
