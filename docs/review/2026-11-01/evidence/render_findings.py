import json,sys,os,glob
root='docs/review/2026-11-01'; ev=f'{root}/evidence'
partial = '--partial' in sys.argv
def decide(sev, votes):
    ok=[v for v in votes if not v.get('refuted')]
    if not votes: return 'unverified', sev, None, None
    if len(votes)==1: verdict = 'confirmed' if ok and ok[0].get('confidence',0)>=0.6 else ('disputed' if ok else 'refuted')
    else: verdict = 'confirmed' if len(ok)==2 or (len(ok)==1 and ok[0].get('confidence',0)>=0.8 and any(v.get('refuted') and v.get('confidence',1)<0.6 for v in votes)) else ('disputed' if ok else 'refuted')
    fs=next((v['corrected_severity'] for v in ok if v.get('corrected_severity')),sev)
    cd=next((v['corrected_description'] for v in ok if v.get('corrected_description')),None)
    rp=next((v['repro'] for v in ok if v.get('repro')),None)
    return verdict, fs, cd, rp
raw={}
for p in glob.glob(f'{ev}/01-find-raw/F*.json'):
    f=json.load(open(p)); raw[f['id']]=f
votes={}
for p in glob.glob(f'{ev}/02-verify/F*.json'):
    v=json.load(open(p)); votes[v['id']]=v['votes']
critic=None
if os.path.exists(f'{ev}/03-critic/critic.json'): critic=json.load(open(f'{ev}/03-critic/critic.json'))
r2dir=f'{ev}/04-round2'
arb={}
for p2 in glob.glob(f'{r2dir}/arbiter/*.json'):
    a=json.load(open(p2)); arb[a['id']]=a
r2=[]
for p2 in glob.glob(f'{r2dir}/verify/R*.json'):
    v=json.load(open(p2)); r2.append(dict(v, corrected=v.get('corrected_description'), votes=v.get('votes',[])))
r2imps=[json.load(open(p2)) for p2 in glob.glob(f'{r2dir}/find/R*.json')]
r2imps=[f for f in r2imps if f['kind']=='improvement']
rows=[]
for fid,f in sorted(raw.items()):
    if f['kind']=='improvement': continue
    vs=votes.get(fid,[])
    verdict,fs,cd,rp=decide(f['severity'],vs)
    rows.append(dict(f,verdict=verdict,final_severity=fs,corrected=cd,repro=rp,votes=vs))
crows=[]
if critic:
    for v in critic.get('verified',[]):
        crows.append(dict(v, kind=v.get('kind'), final_severity=v.get('final_severity',v.get('severity')), corrected=v.get('corrected_description'), votes=v.get('votes',[])))
allrows=rows+crows
for r in allrows:
    a=arb.get(r['id'])
    if a:
        r['verdict']={'confirmed':'confirmed','refuted':'refuted','partially-confirmed':'confirmed'}[a['verdict']]
        r['final_severity']=a['final_severity']
        if a.get('corrected_description'): r['corrected']=a['corrected_description']
        if a.get('repro'): r['repro']=a['repro']
        r['votes']=r['votes']+[{'lens':'ARBITER (round 2)','refuted':a['verdict']=='refuted','confidence':a['confidence'],'reasoning':('['+a['verdict']+'] ' if a['verdict']=='partially-confirmed' else '')+a['reasoning']}]
        r['arbitrated']=True
allrows=allrows+r2
SR={'high':0,'medium':1,'low':2}
def esc(s): return (s or '').replace('/home/kali/packages/mcp-review-check/','').replace('|','\\|').replace('\n',' ')
L=[]
L.append(f"# Findings 2026-11-01: mcp-review-check 0.1.0 ({'PARTIAL DRAFT, verification still running' if partial else 'final'})\n")
L.append('> Part of [SPEC.md](SPEC.md). Every row links to its raw finding (`evidence/01-find-raw/<id>.json`) and verifier votes (`evidence/02-verify/<id>.json`; critic items C### in `evidence/03-critic/`). Verdict rules are in SPEC §3.2. Content is in Russian as produced by the reviewers; identifiers, paths and code are English.\n')
from collections import Counter
c=Counter(r['verdict'] for r in allrows)
L.append('## 0. Summary\n')
L.append('| Verdict | Count |\n|---|---|')
for k in ['confirmed','disputed','refuted','unverified']: L.append(f'| {k} | {c.get(k,0)} |')
L.append(f"| improvements (not verified, see §4) | {sum(1 for f in raw.values() if f['kind']=='improvement') + len(r2imps) + (len([f for f in critic.get('findings',[]) if f['kind']=='improvement']) if critic else 0)} |")
L.append('')
L.append(f"Rounds: F### = round 1 (Find), C### = round-1 critic, R### = round 2 (untouched areas). {len(arb)} round-1 disputed findings were settled by round-2 arbiters (`evidence/04-round2/arbiter/`); their rows carry an ARBITER vote. Round-2 raw findings: `evidence/04-round2/find/`, votes: `evidence/04-round2/verify/`.")
L.append('')
def section(title, rs, with_detail):
    L.append(f'## {title}\n')
    if not rs: L.append('_none_\n'); return
    L.append('| ID | Sev | Kind | File | Title |\n|---|---|---|---|---|')
    for r in sorted(rs,key=lambda r:(SR[r['final_severity']],r['id'])):
        L.append(f"| {r['id']} | {r['final_severity']} | {r['kind']} | `{esc(r['file'])}{(':'+str(r['line'])) if r.get('line') else ''}` | {esc(r['title'])} |")
    L.append('')
    if not with_detail: return
    for r in sorted(rs,key=lambda r:(SR[r['final_severity']],r['id'])):
        L.append(f"### {r['id']} [{r['final_severity']}/{r['kind']}] {r['title']}\n")
        L.append(f"**Where.** `{r['file']}{(':'+str(r['line'])) if r.get('line') else ''}` (reviewer: {r.get('dimension','critic')})\n")
        L.append(f"**What.** {r.get('corrected') or r['description']}\n")
        if r.get('failure_scenario'): L.append(f"**Failure scenario.** {r['failure_scenario']}\n")
        L.append(f"**Evidence.** {r['evidence']}\n")
        if r.get('repro'): L.append(f"**Repro (verifier).**\n\n```\n{r['repro'][:3000]}\n```\n")
        L.append(f"**Suggested fix.** {r['suggested_fix']}\n")
        L.append('**Verifier votes.**\n')
        for v in r['votes']:
            L.append(f"- *{v.get('lens')}*: {'REFUTED' if v.get('refuted') else 'confirmed'} (conf {v.get('confidence')}) — {v.get('reasoning','')}")
        L.append('')
section('1. Confirmed', [r for r in allrows if r['verdict']=='confirmed'], True)
section('2. Disputed (verifiers disagree; maintainer decides)', [r for r in allrows if r['verdict']=='disputed'], True)
L.append('## 3. Refuted (kept so they are not re-reported)\n')
rf=[r for r in allrows if r['verdict']=='refuted']
L.append('| ID | File | Original title | Why refuted |\n|---|---|---|---|')
for r in sorted(rf,key=lambda r:r['id']):
    why=' / '.join(esc(v.get('reasoning',''))[:300] for v in r['votes'])
    L.append(f"| {r['id']} | `{esc(r['file'])}` | {esc(r['title'])} | {why} |")
L.append('')
uv=[r for r in allrows if r['verdict']=='unverified']
if uv:
    L.append('## 3b. Not yet verified\n')
    L.append('| ID | Sev | File | Title |\n|---|---|---|---|')
    for r in uv: L.append(f"| {r['id']} | {r['severity']} | `{esc(r['file'])}` | {esc(r['title'])} |")
    L.append('')
L.append('## 4. Improvements (not adversarially verified; triage by maintainer)\n')
imps=[f for f in raw.values() if f['kind']=='improvement']
if critic: imps += [dict(f,id=f'C-imp-{i+1}',dimension='critic') for i,f in enumerate(critic.get('findings',[])) if f['kind']=='improvement']
imps += r2imps
L.append('| ID | Sev | File | Title | Suggested change |\n|---|---|---|---|---|')
for f in sorted(imps,key=lambda f:(SR[f['severity']],f['id'])):
    L.append(f"| {f['id']} | {f['severity']} | `{esc(f['file'])}` | {esc(f['title'])} | {esc(f['suggested_fix'])[:400]} |")
L.append('')
if critic and critic.get('untouched_areas'):
    L.append('## 5. Areas the round-1 critic flagged as uncovered (all reviewed in round 2; see `evidence/04-round2/area-notes.json` for what was checked and found clean)\n')
    for a in critic['untouched_areas']: L.append(f'- {a}')
    L.append('')
open(f'{root}/FINDINGS.md','w').write('\n'.join(L)+'\n')
print(dict(c), 'improvements', len(imps))
