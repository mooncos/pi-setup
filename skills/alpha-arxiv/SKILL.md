---
name: alpha-arxiv
description: Use the `alpha` CLI (Alpha Hub, powered by alphaXiv) to search, fetch, read, summarize, and annotate arXiv papers, plus inspect linked GitHub repos. Use whenever the user wants to find, read, extract, compare, or take notes on academic papers.
---

# alpha — arXiv research from the CLI

`alpha` is the Alpha Hub CLI (v0.1.4+), backed by alphaXiv. It searches arXiv with several retrieval modes, returns AI-generated reports or raw text for any arXiv paper, browses companion GitHub repos, and stores per-paper local annotations that get re-injected on future fetches.

## When to Use

Reach for this skill any time the user asks to:

- Find arXiv papers on a topic (`search`)
- Read or summarize a paper by arXiv ID or URL (`get`)
- Pull the raw extracted text of a paper (`get --full-text`)
- Ask a targeted question about a specific paper and get back the relevant passages (`ask`)
- Browse the official code repo for a paper (`code`)
- Save / list / clear personal notes attached to a paper ID (`annotate`)

If the request is "find me papers about X", "summarize 2106.09685", "what does this arXiv paper say about Y", "show me the model.py from this paper's repo", or "remember that I think this paper is about Z" — use `alpha`.

## Prerequisites

Before any other command, confirm the user is logged in:

```bash
alpha status
```

If not logged in, run `alpha login` (opens a browser). All other commands need an authenticated session.

## Core Commands

### 1. Search — find papers

```bash
alpha search "<query>" [-m semantic|keyword|both|agentic|all]
```

Modes (pick deliberately):

| Mode       | When to use                                                                 |
|------------|------------------------------------------------------------------------------|
| `semantic` (default) | Fuzzy/conceptual queries — "transformer attention mechanisms"      |
| `keyword`  | Exact phrases, acronyms, author names, method names — "LoRA", "FlashAttention-2" |
| `agentic`  | Open research questions where you want curated, reasoned picks — "hallucination in LLMs" |
| `both`     | Run semantic + keyword side-by-side and compare                             |
| `all`      | Run all three (semantic + keyword + agentic). Use when the user wants breadth |

Output: a numbered list of `[ID=<arxiv-id>] **Title**. Published <date> by <orgs>: <abstract excerpt>...` Feed those IDs straight into `alpha get` / `alpha ask` / `alpha annotate`.

`both` and `all` return JSON with one key per mode — parse accordingly.

### 2. Get — read a paper

```bash
alpha get <arxiv-id-or-url>            # AI-generated structured report
alpha get <arxiv-id-or-url> --full-text  # raw extracted PDF text
```

Accepts:
- Bare arXiv IDs: `1706.03762`, `2106.09685`
- arXiv URLs: `https://arxiv.org/abs/2106.09685`, `/pdf/...`
- alphaXiv URLs

The default report is a long-form analysis (authors/affiliations, context, objectives, methodology, results, contributions, limitations, etc.). It is verbose — capture or grep what you need rather than dumping the whole thing back to the user.

Use `--full-text` when you need exact wording, equations, or to grep for specific terms / citations.

Any `alpha annotate` notes for that paper are appended to the output automatically — useful for "remembering" prior reads.

### 3. Ask — targeted question over a paper

```bash
alpha ask <arxiv-id-or-url> "<question>"
```

Returns the **most question-relevant pages of the paper** wrapped as XML:

```
<paper id="1706.03762v1">
  <page num="4">…page text…</page>
  <page num="8">…page text…</page>
  …
</paper>
```

`ask` is a retrieval primitive, not a chat: the CLI does **not** synthesize a prose answer. It selects and returns the pages most relevant to your question (different questions yield different page subsets, including figure/table captions where applicable). Read the returned passages and answer the user from them, citing page numbers from the `num="N"` attribute.

Use `ask` instead of `get --full-text` when:
- The question is narrow ("what optimizer?", "what dataset?", "how is positional encoding done?")
- You want page-grounded citations
- You want to keep context short — `ask` returns only relevant pages, not the whole PDF

Fall back to `get` (report) for broad summaries and `get --full-text` when you need the entire paper or to grep across all pages.

### 4. Code — read the paper's repo

```bash
alpha code <github-url>            # list root contents
alpha code <github-url> <path>     # read a directory or single file
```

Examples:
```bash
alpha code https://github.com/openai/gpt-2 /
alpha code https://github.com/karpathy/nanoGPT model.py
alpha code https://github.com/karpathy/nanoGPT train.py
```

A directory listing returns each entry with type/size and a content preview. A file path returns the full file contents. Use this to ground claims about a paper in its actual implementation.

### 5. Annotate — persistent local notes

```bash
alpha annotate <paper-id> "<note>"      # save / overwrite a note
alpha annotate <paper-id>               # show the note for that paper
alpha annotate --list                   # list every annotation
alpha annotate <paper-id> --clear       # remove a note
```

Notes are local to the user and re-appear on future `alpha get` calls for that paper. Treat them as the user's research journal: when the user says "note that…", "remember…", or "for next time…", capture it with `annotate`. Keep notes short and durable (key insight, open question, comparison to other work) — not transient task state.

### 6. Auth

```bash
alpha login     # opens browser
alpha status
alpha logout
```

## Global Flags

- `--json` — wrap stdout as JSON. **Note:** for most commands this just JSON-encodes the same human string (or `{"error": "..."}`). It does not produce structured fields. Useful when piping into other tools that need a JSON envelope; do not rely on it for parsed records.
- `-V`, `--cli-version` — print version
- `-h`, `--help` — works on every subcommand (`alpha search --help`, etc.)

## Recommended Workflows

### "Find and digest papers on topic X"
1. `alpha search "X"` (semantic) — scan titles/abstracts.
2. If too narrow/broad, retry with `-m keyword` or `-m agentic`, or `-m all` for breadth.
3. For each promising hit: `alpha get <id>` (report) or `--full-text` (verbatim).
4. Save a one-line takeaway with `alpha annotate <id> "..."` before moving on.

### "Summarize / answer about a specific paper"
1. **Narrow question** ("what optimizer / dataset / loss / baseline?"): `alpha ask <id> "<question>"`, then answer from the returned pages and cite `page N`.
2. **Broad summary**: `alpha get <id>` for the structured report.
3. **Need verbatim wording / equations / specific term**: `alpha get <id> --full-text` and grep within it.
4. If the paper has a repo, `alpha code <gh-url> <path>` to verify implementation details.

### "Compare papers A vs B"
1. `alpha get A` and `alpha get B`.
2. Diff methodology / results sections.
3. Record the comparison via `alpha annotate A "vs B: ..."` and `alpha annotate B "vs A: ..."`.

### "What did I conclude last time about this paper?"
1. `alpha annotate --list` (overview) or `alpha annotate <id>` (specific paper).
2. Or just `alpha get <id>` — notes auto-attach.

## Output Hygiene

`alpha get` reports, `alpha get --full-text`, `alpha ask`, and `alpha search -m all` can all be long. Prefer:
- Capturing output to a file (`alpha get 1706.03762 > /tmp/paper.md`, `alpha ask 1706.03762 "..." > /tmp/ask.xml`) and then reading targeted sections.
- Grepping `--full-text` output for specific terms instead of reading the whole PDF.
- For `ask`: read only the returned `<page>` blocks; cite `page N` in your reply.
- Summarizing back to the user; don't echo full reports unless asked.

## Quick Reference

```bash
alpha status
alpha search "diffusion transformers" -m semantic
alpha search "LoRA" -m keyword
alpha search "RAG for QA" -m all
alpha get 1706.03762
alpha get https://arxiv.org/abs/2106.09685 --full-text
alpha ask 1706.03762 "What optimizer and learning-rate schedule were used?"
alpha code https://github.com/karpathy/nanoGPT model.py
alpha annotate 1706.03762 "Foundational Transformer; 6-layer enc/dec, 8 heads, d=512"
alpha annotate --list
alpha annotate 1706.03762 --clear
```
