// Build dist/ once so e2e tests can spawn the real CLI.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function setup(): void {
  if (process.env.MCP_REVIEW_CHECK_SKIP_BUILD) return;
  execSync('npm run build', { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' });
}
