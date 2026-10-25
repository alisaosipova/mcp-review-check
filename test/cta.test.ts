// The call to action: the maintainer's contact on a BLOCKED, legacy-era or auth-required result, in text and markdown.
import { describe, expect, it } from 'vitest';
import type { EngineResult } from '../src/rules/engine.js';
import { runRules } from '../src/rules/engine.js';
import { manualChecklist, RULES } from '../src/rules/index.js';
import { CONTACT_URL, contactUrl, CTA_TEXT, ctaLine, DISCLAIMER } from '../src/report/constants.js';
import { buildReport } from '../src/report/index.js';
import { toJson } from '../src/report/json.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { renderSarif } from '../src/report/sarif.js';
import { renderText } from '../src/report/text.js';
import type { Snapshot } from '../src/snapshot.js';
import { BAD, cli } from './cli-runner.js';
import { loadSnapshot } from './helpers.js';

const URL_SET = 'https://example.test/help';
const ADDRESS = '20horizon93@gmail.com';
const MAIL_LINE = `${CTA_TEXT} ${ADDRESS}`;
const started = new Date('2026-10-22T10:00:00Z');
const NONE: EngineResult = { findings: [], ignored: [], skipped: [], rulesRun: 0 };

/** A report on a modern-era snapshot: with the rules' findings (BLOCKED on minimal-http) or with none. */
function report(name: string, over: Partial<Snapshot> = {}, findings = true) {
  const s = { ...loadSnapshot(name), era: 'modern', ...over } as Snapshot;
  return buildReport(s, findings ? runRules(s, RULES) : NONE, manualChecklist(s), 'error', started, 1);
}

// The CLI computes the line (ctaLine) and passes it to the text and markdown renderers as an option.
const text = (r: ReturnType<typeof report>, line?: string) => renderText(r, { color: false, verbose: false, cta: line });
const markdown = (r: ReturnType<typeof report>, line?: string) => renderMarkdown(r, { cta: line });
const cta = ctaLine;
const disclaimerStart = DISCLAIMER.split('\n')[0];

describe('call to action', () => {
  it('CTA only on BLOCKED, legacy era or auth-required, above the disclaimer, text and markdown only', () => {
    const blocked = report('minimal-http');
    expect(blocked.summary.verdicts.claude?.verdict).toBe('BLOCKED');
    const line = cta(blocked, {}, URL_SET);
    expect(line).toBe(`${CTA_TEXT} ${URL_SET}`);

    // The three conditions, each on its own; a clean modern server with full coverage gets no CTA.
    expect(cta(report('minimal-http', { era: 'legacy' }, false), {}, URL_SET)).toBe(line);
    expect(cta(report('minimal-http', { era: 'sse-legacy' }, false), {}, URL_SET)).toBe(line);
    expect(cta(report('auth-required', {}, false), {}, URL_SET)).toBe(line);
    const clean = report('minimal-http', {}, false);
    expect(clean.summary.verdicts.claude?.verdict).toBe('NO AUTOMATED BLOCKERS');
    expect(cta(clean, {}, URL_SET)).toBeUndefined();
    expect(cta(report('minimal-http', { era: 'dual' }, false), {}, URL_SET)).toBeUndefined();

    // Above the disclaimer, which it never replaces.
    for (const out of [text(blocked, line), markdown(blocked, line)]) {
      expect(out).toContain(line!);
      expect(out).toContain(disclaimerStart);
      expect(out.indexOf(line!)).toBeLessThan(out.indexOf(disclaimerStart));
    }
    expect(text(blocked)).not.toContain(CTA_TEXT);
    // SARIF never has it; JSON has the contact as data in its own field.
    expect(renderSarif(blocked)).not.toContain(CTA_TEXT);
    expect(renderSarif(blocked)).not.toContain(ADDRESS);
    expect(toJson(blocked)).toHaveProperty('contact', { text: CTA_TEXT, url: `mailto:${ADDRESS}` });
  });

  it('the contact is the maintainer\'s address; a mailto: shows as the bare address and only a plain one is accepted', () => {
    expect(CONTACT_URL).toBe(`mailto:${ADDRESS}`);
    expect(cta(report('minimal-http'), {})).toBe(MAIL_LINE);
    for (const bad of ['mailto:', 'mailto:a@b', 'mailto:a@b.test?subject=x', 'mailto:a@b.test,c@d.test', 'mailto:a@b.test%0Abcc:c@d.test',
      'mailto:<a@b.test>', 'javascript:alert(1)', 'MAILTO:a@b.test', 'mailto:a b@c.test',
      'mailto:x%2Cevil%40attacker.test@b.test', 'mailto:a%0Abcc%3Ac%40d.test@b.test']) expect(contactUrl(bad), bad).toBeUndefined();
    expect(contactUrl('mailto:first.last+mcp@mail.example.test')).toBe('mailto:first.last+mcp@mail.example.test');
  });

  it('MCP_REVIEW_CHECK_NO_CTA=1 or an empty URL hides the CTA; SARIF has no CTA; end to end it shows the address', async () => {
    const blocked = report('minimal-http', { era: 'legacy' });
    expect(cta(blocked, {}, URL_SET)).toBe(`${CTA_TEXT} ${URL_SET}`);
    expect(cta(blocked, { MCP_REVIEW_CHECK_NO_CTA: '1' }, URL_SET)).toBeUndefined();
    expect(cta(blocked, {}, '')).toBeUndefined();
    expect(cta(blocked, {}, '<CONTACT_URL>')).toBeUndefined();
    expect(cta(blocked, {})).toBe(MAIL_LINE); // CONTACT_URL by default

    expect(text(blocked)).not.toContain(CTA_TEXT);
    expect(markdown(blocked)).not.toContain(CTA_TEXT);
    const sarif = renderSarif(blocked);
    expect(sarif).not.toContain(CTA_TEXT);
    expect(JSON.parse(sarif).runs[0].properties).not.toHaveProperty('contact');

    // End to end on a BLOCKED server: the address above the disclaimer in text and markdown, none in SARIF.
    for (const format of ['text', 'markdown', 'sarif']) {
      const run = await cli(['--stdio', BAD, '--format', format]);
      expect(run.code).toBe(1);
      expect(run.stdout).toContain('mcp-review-check');
      if (format === 'sarif') expect(run.stdout).not.toContain(CTA_TEXT);
      else expect(run.stdout.indexOf(MAIL_LINE), format).toBeGreaterThan(-1);
      if (format !== 'sarif') expect(run.stdout.indexOf(MAIL_LINE)).toBeLessThan(run.stdout.indexOf(disclaimerStart));
      const off = await cli(['--stdio', BAD, '--format', format], { MCP_REVIEW_CHECK_NO_CTA: '1' });
      expect(off.stdout).not.toContain(CTA_TEXT);
    }
    const json = await cli(['--stdio', BAD, '--format', 'json']);
    expect(json.json.contact).toEqual({ text: CTA_TEXT, url: `mailto:${ADDRESS}` });
  });
});
