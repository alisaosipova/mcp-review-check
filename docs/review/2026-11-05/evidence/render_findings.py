#!/usr/bin/env python3
"""Render docs/review/2026-11-05/FINDINGS.md from evidence/workflow-result.json."""
import json, os, collections
HERE = os.path.dirname(os.path.abspath(__file__))
r = json.load(open(os.path.join(HERE, 'workflow-result.json')))
c = r.get('critic') or {}
allf = [f for a in r['areas'] for f in a['findings']] + c.get('findings', [])
DUP = {'A07-02': 'A01-01', 'A12-01': 'A01-01'}
cell = lambda s: ' '.join(str(s or '').split()).replace('|', '\\|')
out = ['# Review round 4 findings (mcp-review-check 1.1.0 at `bc7090d`)', '',
       'Rendered by `evidence/render_findings.py` from `evidence/workflow-result.json`. Method and decisions: [SPEC.md](SPEC.md).', '']
cnt = collections.Counter((f['status'], f['severity']) for f in allf)
dims = collections.Counter(f['dimension'] for f in allf if f['status'] == 'confirmed')
out += ['## Totals', '', '| | high | medium | low | total |', '|---|---|---|---|---|']
for s in ('confirmed', 'disputed', 'refuted'):
    out.append(f"| {s} | {cnt[(s,'high')]} | {cnt[(s,'medium')]} | {cnt[(s,'low')]} | {sum(v for (st,_),v in cnt.items() if st==s)} |")
out += ['', 'Confirmed by dimension: ' + ', '.join(f'{k} {v}' for k, v in dims.most_common()) + '.',
        f"Duplicates (same defect found by two areas, fixed once): {', '.join(f'{a} = {b}' for a, b in DUP.items())}.", '']
for status in ('confirmed', 'disputed'):
    items = sorted([f for f in allf if f['status'] == status], key=lambda f: ({'high': 0, 'medium': 1, 'low': 2}[f['severity']], f['id']))
    if not items: continue
    out += [f'## {status.capitalize()}', '', '| ID | Sev | Dim | File | Finding | Fix |', '|---|---|---|---|---|---|']
    for f in items:
        dup = f" (duplicate of {DUP[f['id']]})" if f['id'] in DUP else ''
        loc = f"`{f['file']}`" + (f":{cell(f.get('line'))}" if f.get('line') else '')
        out.append(f"| {f['id']} | {f['severity']} | {f['dimension']} | {loc} | {cell(f['title'])}{dup} | {cell(f['fix'])[:400]} |")
    out.append('')
out += ['## Improvements and feature ideas (not defects)', '', '| Area | Dim | Value | Effort | Release | Improvement |', '|---|---|---|---|---|---|']
for a in r['areas'] + [{'area': 'critic', 'improvements': c.get('improvements', [])}]:
    for i in a['improvements']:
        out.append(f"| {a['area']} | {cell(i.get('dimension'))} | {cell(i.get('value'))} | {cell(i.get('effort'))} | {cell(i.get('release'))} | **{cell(i['title'])}** {cell(i['detail'])[:300]}{(' Source: ' + cell(i['source'])) if i.get('source') else ''} |")
out += ['', '## Coverage notes', '']
for a in r['areas']:
    out.append(f"- **{a['area']} {a['name']}**: {cell(a['coverage'])[:600]}")
if c: out.append(f"- **critic**: {cell(c.get('coverage'))[:600]}")
open(os.path.join(HERE, '..', 'FINDINGS.md'), 'w').write('\n'.join(out) + '\n')
print('wrote FINDINGS.md:', len(allf), 'findings')
