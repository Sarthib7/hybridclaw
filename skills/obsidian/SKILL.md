---
name: obsidian
description: Read, search, organize, and create notes in the Obsidian vault.
user-invocable: true
metadata:
  hybridclaw:
    tags:
      - obsidian
      - markdown
      - notes
      - vault
    related_skills:
      - notion
      - project-manager
      - write-blog-post
---

# Obsidian

Obsidian vaults are normal folders on disk. Notes are usually `*.md`. Do not
touch `.obsidian/`, `.canvas`, or plugin data unless the user explicitly asks.

## Typical Vault Structure

- notes: `*.md`
- config: `.obsidian/`
- canvases: `*.canvas`
- attachments: images, PDFs, and other files in normal folders

## Vault Location

Resolve the vault path first. Use this order:

1. user-provided vault path
2. remembered vault path from `MEMORY.md`
3. `OBSIDIAN_VAULT_PATH`
4. `obsidian-cli print-default --path-only`
5. macOS config: `~/Library/Application Support/obsidian/obsidian.json`
   Use the vault with `"open": true`.
6. common defaults:
   - `~/Documents/Obsidian Vault`
   - `~/Documents/Obsidian`
   - `~/Library/Mobile Documents/iCloud~md~obsidian/Documents`

Do not treat the current workspace as the vault unless the user explicitly says
so, the workspace contains `.obsidian/`, or Obsidian's config points there.

If you find a stable, unambiguous vault path, save a short fact to `MEMORY.md`,
for example `Obsidian vault: /absolute/path/to/vault`. Do not save ambiguous or
temporary vaults.

## Quick Start

Assume:

```bash
VAULT="/absolute/path/to/vault"
```

Pick default vault:

```bash
obsidian-cli print-default --path-only
```

Alternative:

```bash
printenv OBSIDIAN_VAULT_PATH
sed -n '1,120p' "$HOME/Library/Application Support/obsidian/obsidian.json"
```

Read:

```bash
sed -n '1,220p' "$VAULT/Folder/Note.md"
```

List:

```bash
rg --files "$VAULT" -g '*.md'
```

Search:

```bash
obsidian-cli search "keyword"
obsidian-cli search-content "keyword"
```

Alternative:

```bash
rg --files "$VAULT" -g '*.md' | rg -i 'keyword'
rg -n --glob '*.md' 'keyword' "$VAULT"
```

Create:

```bash
obsidian-cli create "Folder/New note" --content "# Title"
```

Alternative:

```bash
printf '# Title\n' > "$VAULT/Folder/New note.md"
```

Append:

```bash
printf '\nNew content\n' >> "$VAULT/Folder/Existing note.md"
```

Move / rename:

```bash
obsidian-cli move "Old Path/Note" "New Path/Note"
```

Alternative:

```bash
mv "$VAULT/Old Path/Note.md" "$VAULT/New Path/Note.md"
```

If you move manually, search for and fix stale links before finishing.

Delete:

```bash
obsidian-cli delete "Path/Note"
```

Alternative:

```bash
rm -f "$VAULT/Path/Note.md"
```

Wikilinks:

- prefer `[[Note Name]]` when nearby notes use wikilinks
- match the vault's existing frontmatter, heading, tag, and link style
- search before creating to avoid duplicate notes
- read before write; do not delete or overwrite notes unless the user asked
