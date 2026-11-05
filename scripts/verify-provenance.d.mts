// Types for scripts/verify-provenance.mjs, used by test/r110-q4-release.test.ts.
export const PACKAGE: string;
export const WORKFLOW_PATH: string;
export const SLSA_V1: string;
export function slsaStatement(doc: unknown): Record<string, any> | string;
export function checkProvenance(doc: unknown, want: { version: string; sha512: string; repository: string; ref: string; sha: string; runId: string; server?: string }): string[];
