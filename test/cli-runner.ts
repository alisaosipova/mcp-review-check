// Spawn the built CLI (dist/cli.js) asynchronously so in-process fixture servers keep running.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
export const GOOD = `node ${fileURLToPath(new URL('./fixtures/good-server.mjs', import.meta.url))}`;
export const BAD = `node ${fileURLToPath(new URL('./fixtures/bad-server.mjs', import.meta.url))}`;

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
  json?: any;
}

export function cli(args: string[], env: Record<string, string> = {}): Promise<CliRun> {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...process.env, NO_COLOR: '1', ...env }, maxBuffer: 32 * 1024 * 1024, timeout: 90000 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
      let json: unknown;
      try { json = JSON.parse(stdout); } catch { /* not JSON */ }
      resolve({ code, stdout, stderr, json });
    });
  });
}

export const ruleIds = (json: any): string[] => [...new Set<string>(json.findings.map((f: any) => f.ruleId))].sort();
export const nonInfo = (json: any): any[] => json.findings.filter((f: any) => f.severity !== 'info');
