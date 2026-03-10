---
name: pptx
description: Use this skill for .pptx presentations: create decks, edit templates safely, export thumbnails for QA, and produce polished slide layouts with pptxgenjs plus OOXML editing.
user-invocable: true
disable-model-invocation: false
requires:
  bins:
    - node
metadata:
  hybridclaw:
    tags:
      - office
      - presentation
      - pptx
    related_skills:
      - office-workflows
      - xlsx
      - docx
---

# PPTX

Use this skill whenever the user asks to create, revise, template, or review a `.pptx` presentation.

## Start Here

- For new decks, read [pptxgenjs.md](./pptxgenjs.md).
- For template edits or preserving an existing deck, read [editing.md](./editing.md).

## Working Rules

- For template-based editing, use unpack -> edit OOXML -> pack. Do not round-trip an existing deck through `pptxgenjs`.
- For new decks, use `pptxgenjs` from a CommonJS `.cjs` script with `require("pptxgenjs")`.
- Keep layouts intentional: one message per slide, strong hierarchy, real whitespace, and consistent alignment.
- Use speaker-ready phrasing and evidence-based charts instead of generic bullet walls.

## Visual QA Is Mandatory

1. Export the deck to PDF:
```bash
node skills/office/soffice.cjs convert deck.pptx /tmp/pptx-export --format pdf --json
```
2. Render slide thumbnails:
```bash
node skills/pptx/scripts/thumbnail.cjs deck.pptx /tmp/pptx-thumbs --count 6 --json
```
3. Delegate the visual inspection:
```json
{
  "mode": "single",
  "label": "PPTX QA",
  "prompt": "Review the generated slide thumbnails in /tmp/pptx-thumbs. Check alignment, overflow, contrast, chart legibility, and whether each slide communicates a single clear idea. Summarize concrete slide-by-slide fixes."
}
```
4. Apply fixes and rerun QA until the deck is presentation-ready.

## Templates

- Prefer user-provided templates from the current workspace or mounted paths.
- Bundled starter templates can live under `skills/office/templates/`.
- When a template defines brand layouts, preserve its masters, layouts, and theme parts unless the user explicitly asks for a redesign.
