// MAN: manual checklist (§2.10). Never affects score or exit code.
import type { Platform, Snapshot } from '../snapshot.js';
import { activePlatforms } from './engine.js';
import { hasUi } from './util/access.js';
import { displayUrl } from './util/net.js';

export interface ManualItem {
  id: string;
  platforms: Platform[];
  text: string;
  docs: string[];
  feature?: 'ui' | 'oauth';
}

const C_POLICY = 'https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy';
const C_SUBMIT = 'https://claude.com/docs/connectors/building/submission';
const C_REVIEW = 'https://claude.com/docs/connectors/building/review-criteria';
const C_AUTH = 'https://claude.com/docs/connectors/building/authentication';
const O_ERRORS = 'https://developers.openai.com/plugins/deploy/submission-errors';
const O_SUBMIT = 'https://developers.openai.com/plugins/deploy/submission';
const O_GUIDE = 'https://developers.openai.com/plugins/plugin-guidelines';
const O_AUTH = 'https://developers.openai.com/plugins/build/auth';
const O_REVIEW = 'https://developers.openai.com/plugins/deploy/app-review';
const O_UI = 'https://developers.openai.com/plugins/concepts/ui-guidelines';

/** `doc` may list several pages; the first is the one that states the requirement. */
const m = (id: string, p: Platform, text: string, doc: string | string[], feature?: 'ui' | 'oauth'): ManualItem => ({ id, platforms: [p], text, docs: Array.isArray(doc) ? doc : [doc], feature });

export const MANUAL_ITEMS: ManualItem[] = [
  m('MAN-001', 'claude', 'Privacy policy URL (data collection, usage, retention)', C_POLICY),
  m('MAN-002', 'claude', 'Listing: name ≤100, one-liner ≤200, description ≤2000, 1–5 categories, docs URL, privacy URL, support contact, icon; slug is permanent', C_SUBMIT),
  m('MAN-003', 'claude', '≥3 working example prompts; populated test account', C_POLICY),
  m('MAN-004', 'claude', 'Public documentation by publish date', C_REVIEW),
  m('MAN-005', 'claude', 'Carousel screenshots: PNG, ≥1000 px wide, 3–5 images, cropped to the app response', C_SUBMIT, 'ui'),
  m('MAN-006', 'claude', 'Allowed link URIs: https origins or owned custom schemes only', 'https://claude.com/docs/connectors/building/mcp-apps/external-links', 'ui'),
  m('MAN-007', 'claude', 'Rotate refresh tokens for public clients; return the new one in the same response', C_AUTH, 'oauth'),
  m('MAN-008', 'claude', 'Register `https://claude.ai/api/mcp/auth_callback` exactly; loopback callbacks port-agnostic', C_AUTH, 'oauth'),
  m('MAN-009', 'claude', 'WAF/CDN allows Anthropic egress `160.79.104.0/21`', C_AUTH),
  m('MAN-010', 'claude', 'Server calls your own first-party APIs (or legitimately proxied ones)', C_REVIEW),
  m('MAN-011', 'claude', 'Compliance acknowledgments: guidelines, first-party API, financial transactions, AI media generation, prompt injection, conversation data, public docs', C_SUBMIT),
  m('MAN-012', 'claude', 'Tool descriptions accurately describe real behavior (reviewers test each tool in Verified review)', C_REVIEW),
  m('MAN-013', 'spec', "Validate token audience (accept the canonical URI); never pass the client's token upstream", 'https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations', 'oauth'),
  m('MAN-014', 'spec', 'Low-scope token → 403 `insufficient_scope` with `scope` and `resource_metadata`', 'https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#runtime-insufficient-scope-errors', 'oauth'),
  m('MAN-015', 'chatgpt', 'Listing (final submission limits): displayName ≤30, shortDescription ≤30, longDescription ≤4000, developerName ≤80, valid category, ≤20 capabilities of ≤120 chars', O_ERRORS),
  m('MAN-016', 'chatgpt', 'websiteURL, supportURL, privacyPolicyURL, termsOfServiceURL: HTTPS, no credentials, ≤1024 chars, publicly accessible', O_SUBMIT),
  m('MAN-017', 'chatgpt', 'Starter prompts: ≤3, ≤128 chars, single line, unique, no @mentions', O_ERRORS),
  m('MAN-018', 'chatgpt', 'Brand colors `#RRGGBB`, ≥2:1 contrast vs white / vs #212121 (dark)', O_ERRORS),
  m('MAN-019', 'chatgpt', 'Icons square, 48–4096 px, ≤5 MiB, PNG/JPEG/WebP/SVG', O_SUBMIT),
  m('MAN-020', 'chatgpt', 'Exactly 5 positive and 3 negative test cases; tools_triggered exist; release notes', O_ERRORS),
  m('MAN-021', 'chatgpt', 'Demo recording URL covering web, iOS and Android', O_ERRORS),
  m('MAN-022', 'chatgpt', 'Works on desktop and mobile, including UI; light and dark themes; WCAG AA contrast', [O_UI, O_GUIDE]),
  m('MAN-023', 'chatgpt', 'Package: no test_credentials/reviewer_instructions, no clientSecret, no non-empty server headers, no `.app.json`/apps/hooks', O_SUBMIT),
  m('MAN-024', 'chatgpt', "Screenshots only with UI: one per starter prompt, 706 px wide, 400–860 px tall (note: guidelines say they're no longer shown)", O_ERRORS, 'ui'),
  m('MAN-025', 'chatgpt', 'Privacy policy discloses categories, purposes, recipients, retention, user controls; covers every user field tools return', O_GUIDE),
  m('MAN-026', 'chatgpt', "Reviewer test account: works externally, no MFA/SMS/magic link, doesn't expire, seeded data", [O_SUBMIT, O_GUIDE], 'oauth'),
  m('MAN-027', 'chatgpt', "Be ready to justify each tool's three hints (`justification_required` may still appear)", O_ERRORS),
  m('MAN-028', 'chatgpt', 'Advertised OIDC scopes (openid/email/profile) enabled for the client', O_AUTH, 'oauth'),
  m('MAN-029', 'chatgpt', 'Not an unofficial third-party connector, demo or trial; EU data residency projects cannot submit', [O_REVIEW, O_GUIDE]),
  m('MAN-030', 'chatgpt', 'Physical goods only for commerce; no subscription upsell', O_GUIDE),
  m('MAN-031', 'spec', 'Consider running `npx @modelcontextprotocol/conformance server --url <url>` for full schema conformance', 'https://github.com/modelcontextprotocol/conformance'),
];

/** Items for the active platforms and detected features. */
export function manualChecklist(snap: Snapshot): ManualItem[] {
  const active = activePlatforms(snap.options.target);
  const ui = hasUi(snap);
  const oauth = !!snap.authProbe?.prm;
  return MANUAL_ITEMS.filter((i) => i.platforms.some((p) => active.includes(p)))
    .filter((i) => (i.feature === 'ui' ? ui : i.feature === 'oauth' ? oauth : true))
    .map((i) => (i.id === 'MAN-031' && snap.target.kind === 'http' ? { ...i, text: i.text.replace('<url>', displayUrl(snap.target.urlAsEntered)) } : i));
}
