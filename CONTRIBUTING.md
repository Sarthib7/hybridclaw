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

## Container runtime image

HybridClaw runtime commands (`gateway`, `tui`, `onboarding`) require a local Docker
image matching `container.image` (default: `hybridclaw-agent`).

When the image is missing, startup logic in `src/container-setup.ts` does:

1. pull a remote image (for default image: GHCR `v<app-version>`, `latest`, then Docker Hub fallback)
2. if pull fails, run local build (`npm run build:container`)

Maintainer overrides:

- `HYBRIDCLAW_CONTAINER_PULL_IMAGE=<registry/image:tag>` force a specific pull target
- `HYBRIDCLAW_CONTAINER_REBUILD=if-stale|always|never` adjust rebuild policy
- `HYBRIDCLAW_CONTAINER_IMAGE=<name[:tag]> npm run build:container` build/tag custom image

Build context hygiene is enforced by `container/.dockerignore` to avoid accidentally
shipping local secrets/artifacts into published images.

## Container publishing (GHCR + optional Docker Hub)

Container publishing is automated by GitHub Actions on release tags:

- workflow: `.github/workflows/publish-container.yml`
- trigger: push tag `v*`
- destinations:
  - GHCR: `ghcr.io/<org>/hybridclaw-agent`
  - Docker Hub mirror: `hybridaione/hybridclaw-agent` when Docker Hub credentials are configured
- tags:
  - always: `vX.Y.Z`
  - stable tags only (no `-rc`/`-beta` suffix): `latest`

The workflow fails if the pushed git tag does not match `package.json` version.
GHCR publishing is unconditional on release tags. Docker Hub publishing is optional and only runs when repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are configured.

Manual publish fallback:

```bash
VERSION="v$(node -p \"require('./package.json').version\")"
DOCKERHUB_IMAGE="hybridaione/hybridclaw-agent"
GHCR_IMAGE="ghcr.io/hybridaione/hybridclaw-agent"

docker build \
  -t "${DOCKERHUB_IMAGE}:${VERSION}" \
  -t "${DOCKERHUB_IMAGE}:latest" \
  -t "${GHCR_IMAGE}:${VERSION}" \
  -t "${GHCR_IMAGE}:latest" \
  ./container

docker login -u <dockerhub-username>
docker push "${DOCKERHUB_IMAGE}:${VERSION}"
docker push "${DOCKERHUB_IMAGE}:latest"

docker login ghcr.io -u <github-username>
docker push "${GHCR_IMAGE}:${VERSION}"
docker push "${GHCR_IMAGE}:latest"
```

Manual GHCR-only publish:

1. Create a GitHub token that can publish packages:
   - classic PAT: `write:packages` (and `read:packages`)
   - fine-grained PAT: package permissions with write access for this repository/org
2. Authenticate Docker to GHCR:

```bash
export GHCR_USER="<github-username>"
export GHCR_TOKEN="<github-token>"
echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin
```

3. Build and push versioned image (and `latest` for stable releases):

```bash
VERSION="v$(node -p \"require('./package.json').version\")"
GHCR_IMAGE="ghcr.io/hybridaione/hybridclaw-agent"

docker build \
  -t "${GHCR_IMAGE}:${VERSION}" \
  -t "${GHCR_IMAGE}:latest" \
  ./container

docker push "${GHCR_IMAGE}:${VERSION}"
docker push "${GHCR_IMAGE}:latest"
```

## Advanced runtime reference

This section contains maintainer-focused runtime internals that are intentionally
kept out of the end-user README.

### Configuration internals

HybridClaw runtime configuration is typed and validated in
`~/.hybridclaw/config.json` (auto-created on first run). Use
`config.example.json` as the reference.

Core details:

- Runtime hot-reloads most settings (model defaults, heartbeat, prompt hooks, limits).
- Legacy runtime paths (`./config.json`, `./data`) are migrated to `~/.hybridclaw/*` on startup; merge/rollback backups are written to `~/.hybridclaw/migration-backups/` when conflicts exist.
- Some settings still require restart (for example bind host/port).
- Default bot is configured via `hybridai.defaultChatbotId`.
- `hybridai.maxTokens` sets default completion budget per model call.
- Trust-model acceptance is persisted under `security.*` and enforced before runtime start.

Common advanced areas:

- Discord behavior + policy controls: `discord.*` and `discord.guilds.*`.
- Approval policy controls (workspace-local): `./.hybridclaw/policy.yaml`.
- Scheduler jobs: `scheduler.jobs[]` (cron/every/at + delivery targets).
- Memory compaction + consolidation: `sessionCompaction.*`, `memory.*`.
- Proactive runtime: `proactive.*`.
- Observability export: `observability.*`.
- Skills roots: `skills.extraDirs`.

### Audit trail internals

HybridClaw records forensic audit events by default:

- append-only session wire logs: `~/.hybridclaw/data/audit/<session>/wire.jsonl`
- tamper-evident hash chain (`_prevHash` -> `_hash`)
- normalized SQLite tables (`audit_events`, `approvals`)

Useful maintainer commands:

- `hybridclaw audit recent 50`
- `hybridclaw audit search "tool.call" 50`
- `hybridclaw audit approvals 50 --denied`
- `hybridclaw audit verify <sessionId>`
- `hybridclaw audit instructions`
- `hybridclaw audit instructions --approve`

Instruction approval baseline:

- file: `~/.hybridclaw/data/audit/instruction-hashes.json`
- `hybridclaw audit instructions` fails when instruction files changed
- `hybridclaw audit instructions --approve` updates approved baseline
- `hybridclaw tui` performs this check before startup

### Observability push internals

HybridClaw can forward audit-derived events to HybridAI ingest:

- endpoint: `POST /api/v1/agent-observability/events:batch`
- token source: `POST /api/v1/agent-observability/ingest-token:ensure`
- source table: local `audit_events` (ordered by `id`)
- persisted cursor: `observability_offsets`
- cached ingest tokens: `observability_ingest_tokens`

Runtime diagnostics:

- `GET /api/status` returns an `observability` status block.

### Agent workspace internals

Each agent has a persistent workspace bootstrap:

- `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, `AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`, `BOOT.md`
- templates are seeded from `templates/`
- turn transcript mirror: `<workspace>/.session-transcripts/*.jsonl`

### Skills internals

HybridClaw supports `SKILL.md`-based skills (`<skill-name>/SKILL.md`).

Skill roots include:

- `config.skills.extraDirs[]`
- bundled package skills (`skills/`)
- `$CODEX_HOME/skills`, `~/.codex/skills`, `~/.claude/skills`, `~/.agents/skills`
- project/workspace roots: `./.agents/skills`, `./skills`

Resolution rules:

- precedence: `extra < bundled < codex < claude < agents-personal < agents-project < workspace`
- skills merge by `name`; higher precedence overrides lower
- trust-aware scanning blocks risky personal/workspace skills

Frontmatter contract:

- required: `name`, `description`
- optional: `user-invocable`, `disable-model-invocation`, `always`, `requires.*`, `metadata.hybridclaw.*`

Invocation paths:

- `/skill <name> [input]`
- `/skill:<name> [input]`
- `/<name> [input]` (if `user-invocable: true`)

### Agent tool/runtime internals

Container-side sandboxed tool families:

- file tools (`read`, `write`, `edit`, `delete`)
- search tools (`glob`, `grep`)
- shell (`bash`)
- memory/session tools (`memory`, `session_search`)
- delegation (`delegate`)
- web extraction (`web_fetch`)
- optional browser automation (`browser_*`)

Prompt/runtime internals:

- session compaction with pre-compaction memory flush
- prompt hook pipeline (`bootstrap`, `memory`, `safety`, `proactivity`)
- hook config in `config.promptHooks`

### Testing and structure

Run local checks:

```bash
npm run typecheck
npm run lint
npm run check
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:live
```

Repository structure (core):

```text
src/gateway.ts                    Core runtime entrypoint (DB, scheduler, heartbeat, HTTP API)
src/tui.ts                        Terminal adapter (thin client to gateway)
src/channels/discord/runtime.ts   Discord runtime integration and message transport
src/channels/discord/*.ts         Discord responsibility modules
src/gateway-service.ts            Core shared agent/session logic
src/gateway-client.ts             HTTP client for thin clients (e.g. TUI)
tests/                            Vitest suites (unit/integration/e2e/live)
container/src/                    Agent code (tools, HybridAI client, IPC)
templates/                        Workspace bootstrap files
~/.hybridclaw/data/               Runtime data directory (default)
```
