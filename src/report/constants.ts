// Report constants (§5.4).
import { CATALOG_DATE } from '../catalog.js';
import type { Report } from './index.js';

// The maintainer's contact: an absolute http(s) URL or a mailto: with one plain address; empty leaves the call to action out.
export const CONTACT_URL = 'mailto:20horizon93@gmail.com';
export const CTA_TEXT = 'Need help getting your connector approved?';

const MAILTO = /^mailto:([A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})$/;

/** CONTACT_URL when it is a valid absolute http(s) URL or a mailto: with one plain address (no query, no second
 *  address, no percent-escape that a mail client would decode into one), otherwise undefined (placeholders never reach a report). */
export function contactUrl(raw: string = CONTACT_URL): string | undefined {
  if (MAILTO.test(raw)) return raw;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** How a person reads the contact: the address of a mailto:, the URL itself otherwise. */
function contactLabel(link: string): string {
  return MAILTO.exec(link)?.[1] ?? link;
}

export const DISCLAIMER =
  'Passing these automated checks does not guarantee approval. Directory reviews include manual\n' +
  `testing and policy judgment, and requirements change. Rules reflect public docs as of ${CATALOG_DATE}.\n` +
  'mcp-review-check is independent and not affiliated with Anthropic or OpenAI.';

/** Text and markdown only: a contact URL, no MCP_REVIEW_CHECK_NO_CTA=1, and a BLOCKED verdict, legacy era or auth-required. */
export function ctaLine(r: Report, env: NodeJS.ProcessEnv = process.env, url: string = CONTACT_URL): string | undefined {
  const link = contactUrl(url);
  const due = Object.values(r.summary.verdicts).some((v) => v?.verdict === 'BLOCKED') || r.snap.era.includes('legacy') || r.snap.coverage.toolLevel === 'auth-required';
  return link && due && env.MCP_REVIEW_CHECK_NO_CTA !== '1' ? `${CTA_TEXT} ${contactLabel(link)}` : undefined;
}

export const AUTH_NOTICE =
  'Server requires OAuth. Auth checks ran; tool, resource and UI checks need `--bearer <token>` (or MCP_REVIEW_CHECK_TOKEN): ' +
  'an access token for a test account, issued for this server. How to get one: "Token recipe" in the mcp-review-check README.';
export const LIST_FAILED_NOTICE =
  'Tool, injection, data and policy checks could not run (see SPEC-020).';
export const TOKEN_REJECTED_NOTICE =
  'Server rejected the token (401). Auth checks ran; tool, resource and UI checks need a valid `--bearer <token>` (obtain a token via your OAuth flow or a test account).';
