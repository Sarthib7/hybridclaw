# Contributing

## Development setup

```bash
npm install
```

`npm install` runs the `prepare` script and installs Husky git hooks.

## Code quality checks

```bash
# TypeScript checks
npm run typecheck
npm run lint

# Biome (lint + formatting + import sorting)
npm run check

# Apply Biome fixes to src
npm run format
```

## Git hooks

This repo uses Husky with a pre-commit hook:

```bash
npx biome check --write --staged
```

Before committing, stage your files (`git add ...`). The hook validates and auto-formats staged changes.
