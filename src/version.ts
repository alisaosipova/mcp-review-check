// Single source of the version: package.json (always shipped next to dist/ in the npm tarball).
import { readFileSync } from 'node:fs';

export const VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
