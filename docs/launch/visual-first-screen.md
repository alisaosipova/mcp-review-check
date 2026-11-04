# Visual first screen: show a rendered run above the fold

Draft for review. Nothing here edits README.md.

## Problem

A visitor reads the title, one sentence and a `npx` line, then a table of rule categories (README.md lines 1-28).
The first rendered report is under `## Example output`, far below the fold. In 10 seconds the visitor cannot see
what the tool prints: findings with fixes, a score and a per-directory verdict.

## What was produced

| File | What it is | How it was made |
|---|---|---|
| `docs/launch/demo-server.mjs` | A 4-tool stdio demo server (Acme Tasks) with two typical mistakes: `create_task` has no title, `import_tasks` takes a free-form URL but says `openWorldHint: false` | Written for the screenshot; no network |
| `docs/launch/sample-output.ansi` | The raw ANSI stdout of one CLI run on it, unedited | Command below |
| `docs/launch/sample-output.txt` | The same text with the ANSI codes stripped | `sed 's/\x1b\[[0-9;]*m//g'` on the `.ansi` file |
| `docs/assets/sample-output.svg` | A static terminal mock of the first 27 lines (up to the verdict), 949x742, pure ASCII | `render-svg.mjs`, command below |
| `docs/launch/render-svg.mjs` | The ANSI-to-SVG generator (SGR 0, 1, 2, 31, 33, 36 only) | |
| `docs/launch/replay-fixture.mjs` | A local stdio server that serves a captured listing from `test/fixtures/real/` (used for the aggregate, not for the image) | |

### Why a demo server and not a captured listing (2026-11-04)

The first version of the image was a replayed third-party listing with the server, fixture and vendor names
replaced by `<server>`, `<fixture>` and similar placeholders, from the 0.7.0 CLI, 42 lines and 153 columns wide.
Readers took the placeholders for rendering bugs, the text was too small at `width="900"`, and the coloured runs
were placed at absolute x positions measured for one font, so in other renderers (ImageMagick, and browsers whose
fallback monospace font is wider) they overlapped (`Result:FAIL`). The demo server gives the same kind of report
with real names and nothing to redact, and the renderer now fixes every run's width with `textLength`, wraps at
100 columns and uses a 15 px font. Checked in Chromium, Firefox and ImageMagick: identical output.

### What the image shows

- `ERRORS (1)`: `TOOL-006 [claude] create_task: no title`, with `fix` and `docs` lines.
- `WARNINGS (1)`: `TOOL-015 [chatgpt] import_tasks: openWorldHint: false but free-form "url" parameter ...`.
- `INFO (2)`: the two `SRV-002` lines every stdio run gets (a directory needs a deployed HTTPS server).
- `FIX SNIPPETS`: `create_task: {"title":"Create task"}`.
- `Score 84/100`, then `Claude: BLOCKED (1 error) · ChatGPT: NEEDS ATTENTION (1 warning) · Result: FAIL`.

Not in the image (the lines after the verdict): the contact line and the 3-line disclaimer. They are in the
`.ansi` and `.txt` files.

### Colours (from `src/report/text.ts`)

The SVG uses exactly the CLI's SGR codes: the header line bold; `ERRORS` and the `x` mark red (31); `WARNINGS` and
`!` yellow (33); `INFO` and `i` cyan (36); `fix`, `docs`, the local banner and the manual-items line dim (2);
`FIX SNIPPETS` bold. On the verdict line only the word `FAIL` (or `INCOMPLETE`) is coloured, red; the verdict
words `BLOCKED`, `NEEDS ATTENTION` and `NO AUTOMATED BLOCKERS` are printed uncoloured, and the SVG keeps that.

## Decisions for you before publishing

1. **Height.** The image stops at the verdict line (27 of 33 lines). `--lines` on `render-svg.mjs` sets the cut.

## README placement proposal

Put the image directly after the one-line description and the `npx` line, before the long paragraph: that is
after README.md line 5 (`Run \`npx mcp-review-check ...\``) and before line 7 (`\`mcp-review-check\` connects to
your server ...`). The visitor then sees the title, what it does, how to run it and what it prints, in the first
scroll.

Snippet (a relative path, so it renders on GitHub; npm does not ship `docs/`, so for the npm page use the absolute
raw URL variant below):

```markdown
<p align="center">
  <img src="docs/assets/sample-output.svg" alt="mcp-review-check report for a small demo server: one error (TOOL-006, a tool without a title) and one warning (TOOL-015), each with a fix and a docs link, a copy-paste fix snippet, Score 84/100, and the verdict Claude: BLOCKED, ChatGPT: NEEDS ATTENTION, Result: FAIL" width="900">
</p>

<sub>A real run of mcp-review-check 1.0.0 on a small demo server (<a href="docs/launch/demo-server.mjs"><code>docs/launch/demo-server.mjs</code></a>, two typical mistakes), cut after the verdict line. Text version of a longer report: [Example output](#example-output).</sub>
```

npm variant (the npm README renders images from absolute URLs only; `docs/` is not in the package `files`):

```markdown
<img src="https://raw.githubusercontent.com/alisaosipova/mcp-review-check/main/docs/assets/sample-output.svg" alt="..." width="900">
```

Keep `## Example output` as the text version: it is searchable and readable without images.

## asciinema recording recipe (needs a TTY, so for you to run)

asciinema is not installed on this host (`command -v asciinema` printed nothing). The recording is optional: the
SVG already covers the README without media playback.

What to record: one command and its full report, about 15-25 seconds; no typing mistakes, no shell prompt with
your hostname or paths.

Which server: the synthetic `test/fixtures/bad-server.mjs` (project-owned, no third-party names; 143 lines in full,
42 with `--quiet`, from `wc -l`), or your own server. Do not record the replay of a `test/fixtures/real/` file
unredacted: it would show a third-party server's name.

```bash
# 1. Install (Kali): asciinema; agg only if you also want a GIF
sudo apt install asciinema
# optional GIF renderer: cargo install --git https://github.com/asciinema/agg

# 2. Prepare a clean shell, 120x32 terminal
cd ~/packages/mcp-review-check && npm run build
export PS1='$ ' COLUMNS=120 LINES=32

# 3. Record (Ctrl+D or `exit` ends it); --idle-time-limit caps pauses at 2 s
asciinema rec --idle-time-limit 2 --title "mcp-review-check" docs/launch/demo.cast
#    inside the recording, type:
#    node dist/cli.js --quiet --stdio -- node test/fixtures/bad-server.mjs
#    exit

# 4. Check it locally before sharing
asciinema play docs/launch/demo.cast
grep -c "$(hostname)" docs/launch/demo.cast   # expect 0

# 5. Optional GIF (large; the SVG is usually better for the README)
agg --theme monokai --font-size 14 docs/launch/demo.cast docs/assets/demo.gif
```

Where to upload: `asciinema upload docs/launch/demo.cast` publishes it to asciinema.org (needs a network call and,
to keep it under your account, `asciinema auth` first). Link it from the README as a thumbnail that opens the
player:

```markdown
[![asciicast](https://asciinema.org/a/<id>.svg)](https://asciinema.org/a/<id>)
```

Alternatives: attach the `.cast` or GIF to the GitHub release, or keep only the SVG. Commit the `.cast` only if you
want it in the repo (it is plain text, a few KB).

## Regenerating

```bash
npm run build
FORCE_COLOR=1 node dist/cli.js --stdio -- node docs/launch/demo-server.mjs > docs/launch/sample-output.ansi
# exit code 1 (Result: FAIL)
sed 's/\x1b\[[0-9;]*m//g' docs/launch/sample-output.ansi > docs/launch/sample-output.txt
node docs/launch/render-svg.mjs docs/launch/sample-output.ansi docs/assets/sample-output.svg --lines 27 \
  --title '$ npx mcp-review-check --stdio -- node docs/launch/demo-server.mjs'
```
