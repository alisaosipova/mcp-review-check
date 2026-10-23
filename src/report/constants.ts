// Report constants (§5.4).
import { CATALOG_DATE } from '../catalog.js';

// Set to a real absolute https URL before release; empty leaves the call to action out. No brand or URL is invented here.
export const CONTACT_URL = '';
export const CTA_TEXT = 'Need help getting your connector approved?';

/** CONTACT_URL when it is a valid absolute http(s) URL, otherwise undefined (placeholders never reach a report). */
export function contactUrl(raw: string = CONTACT_URL): string | undefined {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

export const DISCLAIMER =
  'Passing these automated checks does not guarantee approval. Directory reviews include manual\n' +
  `testing and policy judgment, and requirements change. Rules reflect public docs as of ${CATALOG_DATE}.\n` +
  'mcp-review-check is independent and not affiliated with Anthropic or OpenAI.';

export function ctaLine(): string | undefined {
  const url = contactUrl();
  return url ? `${CTA_TEXT} ${url}` : undefined;
}

export const AUTH_NOTICE =
  'Server requires OAuth. Auth checks ran; tool, resource and UI checks need `--bearer <token>` (obtain a token via your OAuth flow or a test account).';
export const LIST_FAILED_NOTICE =
  'Tool, injection, data and policy checks could not run (see SPEC-020).';
export const TOKEN_REJECTED_NOTICE =
  'Server rejected the token (401). Auth checks ran; tool, resource and UI checks need a valid `--bearer <token>` (obtain a token via your OAuth flow or a test account).';
