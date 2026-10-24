// Single source of the version: package.json (always shipped next to dist/ in the npm tarball).
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const VERSION: string = pkg.version;
/** The repository's web URL (git+https://github.com/o/r.git -> https://github.com/o/r), for SARIF informationUri. */
export const REPOSITORY_URL: string = String(pkg.repository?.url ?? pkg.repository ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
