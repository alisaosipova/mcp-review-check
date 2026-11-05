// Types for scripts/release-guard.mjs, used by test/r110-q4-release.test.ts.
export interface CiRun { status?: string; conclusion?: string | null; event?: string; head_branch?: string; html_url?: string }
export function onMain(status: string | undefined): boolean;
export function decide(o: { compareStatus?: string; runs: CiRun[]; sha: string; tag: string }): { verdict: 'pass' | 'wait' | 'fail'; message: string };
