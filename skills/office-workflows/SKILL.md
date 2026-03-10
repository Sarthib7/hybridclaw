---
name: office-workflows
description: Use this skill for cross-format office tasks such as CSV/TSV cleanup into XLSX, XLSX analysis into PPTX summaries, or document-plus-deck deliverables that should be coordinated with delegate.
user-invocable: true
disable-model-invocation: false
metadata:
  hybridclaw:
    tags:
      - office
      - workflow
      - delegation
    related_skills:
      - xlsx
      - docx
      - pptx
---

# Office Workflows

Use this skill when the task spans multiple office formats or involves both analysis and polished deliverables.

## Recommended Patterns

- CSV/TSV -> XLSX:
  Run `node skills/xlsx/scripts/import_delimited.cjs input.csv output.xlsx --json`, validate the workbook, then polish the structure with the `xlsx` skill.
- XLSX -> PPTX summary:
  Use `delegate` in `chain` mode.
  Step 1: inspect the workbook and extract the few metrics or charts that matter.
  Step 2: build the deck with the `pptx` skill.
  Step 3: run PPTX visual QA on thumbnails.
- XLSX -> DOCX memo:
  Analyze the workbook first, then draft the memo in Markdown and convert with `pandoc` or generate/edit a DOCX directly.

## Delegation Guidance

- Use `parallel` mode for independent research branches, such as "analyze workbook tabs" and "inspect brand template assets".
- Use `chain` mode when later outputs depend on prior findings.
- Keep each delegated prompt explicit about file paths, expected output, and whether the subagent should modify files or only return findings.

## Templates

- Prefer user-supplied templates from current-turn attachments or mounted workspace paths.
- For branded deliverables, inspect the template first, then preserve its structure while swapping in updated data and copy.
