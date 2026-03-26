---
title: HybridClaw Docs
description: User-facing HybridClaw documentation for installation, setup, operations, extensibility, and runtime internals.
sidebar_position: 1
---

# HybridClaw Docs

This section turns the repo-shipped markdown docs into a browsable manual for
operators, contributors, and advanced users. Start with the section that best
matches what you need right now. In the browser docs shell, each page can open
its raw `.md` source directly or copy the full page markdown from the document
header.

## Version 0.9.2 Highlights

- Prompt context can be grounded directly from inline references such as
  `@file`, `@folder`, `@diff`, `@staged`, `@git:<count>`, and `@url`, plus
  current-turn uploads from the web chat and TUI.
- Community skills can be imported with `hybridclaw skill import` from
  packaged `official/<skill>` sources, `skills-sh`, `clawhub`, `lobehub`,
  `claude-marketplace`, `well-known`, and explicit GitHub repo/path sources.
- Portable `.claw` archives can declare skill imports that are restored during
  `hybridclaw agent install`, which keeps transferred agents closer to their
  original working setup.
- The built-in `/development` docs shell exposes raw-markdown and
  copy-as-markdown actions so repo docs are easier to browse from a running
  gateway.
- Gateway status surfaces use TTL-cached on-demand health probes, and the
  HybridAI/upload hardening in this patch aligns reachability and attachment
  validation with the configured runtime base URL and stricter media checks.

## Browse By Section

- [Getting Started](./getting-started/README.md) for installation,
  onboarding, provider authentication, and first-run setup
- [Guides](./guides/README.md) for local providers, MCP, bundled skills,
  voice/TTS, and optional office tooling
- [Reference](./reference/README.md) for model selection, configuration,
  diagnostics, commands, and FAQ
- [Extensibility](./extensibility/README.md) for tools, skills, plugins,
  agent packages, and extension-specific operator workflows
- [Internals](./internals/README.md) for architecture, runtime behavior,
  session routing, testing, and release mechanics

## Fast Paths

- Need to install HybridClaw quickly? Go to
  [Installation](./getting-started/installation.md).
- Need the shortest path to a running gateway and chat UI? Go to
  [Quick Start](./getting-started/quickstart.md).
- Need command lookup or troubleshooting help? Go to
  [Commands](./reference/commands.md) and
  [Diagnostics](./reference/diagnostics.md).
- Need setup answers before deploying? Go to [FAQ](./reference/faq.md).
