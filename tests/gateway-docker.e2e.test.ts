import { execSync } from 'node:child_process';
import { describe, test, expect, afterAll, beforeAll } from 'vitest';

/**
 * E2E tests that boot the gateway Docker image the same way a real deployment
 * would, then verify runtime-critical files and HTTP endpoints.
 *
 * Requires:
 *   HYBRIDCLAW_RUN_DOCKER_E2E=1        — gate flag (CI sets this)
 *   HYBRIDCLAW_E2E_IMAGE               — pre-built image tag
 *
 * When HYBRIDAI_API_KEY is set (CI secret on internal PRs), the gateway runs
 * with a real key — identical to production.  Provider health probes connect
 * to the real API and /health reflects live reachability.
 *
 * When the secret is unavailable (fork PRs, local dev without key), a dummy
 * key is used so the gateway still starts.  Provider probes fail gracefully
 * in the background; static content and endpoint tests still run.
 *
 * All execSync calls use only hardcoded strings (no user input).
 */

const DOCKER_E2E = process.env.HYBRIDCLAW_RUN_DOCKER_E2E === '1';
const IMAGE = process.env.HYBRIDCLAW_E2E_IMAGE || 'hybridclaw-gateway:e2e';
const CI_FALLBACK_KEY = 'hai-ci-placeholder-not-a-real-key';
const API_KEY = process.env.HYBRIDAI_API_KEY || CI_FALLBACK_KEY;
const HAS_REAL_KEY = !!process.env.HYBRIDAI_API_KEY;
const CONTAINER_NAME = `gw-e2e-${process.pid}`;
const HOST_PORT = 9199;
const GATEWAY_URL = `http://127.0.0.1:${HOST_PORT}`;
const STARTUP_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 5_000;

function dockerExec(cmd: string): string {
  // All arguments are hardcoded constants — no injection risk.
  return execSync(`docker exec ${CONTAINER_NAME} ${cmd}`, {
    encoding: 'utf-8',
    timeout: 10_000,
  }).trim();
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${GATEWAY_URL}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) {
        const body = (await res.json()) as { status: string };
        if (body.status === 'ok') return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    const logs = execSync(`docker logs ${CONTAINER_NAME}`, {
      encoding: 'utf-8',
      timeout: 5_000,
    });
    console.error('--- gateway container logs ---\n', logs);
  } catch {
    // ignore
  }
  throw new Error(
    `Gateway did not become healthy within ${STARTUP_TIMEOUT_MS}ms`,
  );
}

describe.skipIf(!DOCKER_E2E)('gateway Docker image', () => {
  beforeAll(async () => {
    // Start the container the same way a real deployment would.
    execSync(
      [
        'docker run -d',
        `--name ${CONTAINER_NAME}`,
        `-p ${HOST_PORT}:9090`,
        '-e HYBRIDCLAW_ACCEPT_TRUST=true',
        '-e HEALTH_HOST=0.0.0.0',
        `-e HYBRIDAI_API_KEY=${API_KEY}`,
        IMAGE,
      ].join(' '),
      { stdio: 'pipe', timeout: 15_000 },
    );
    await waitForHealth();
  }, STARTUP_TIMEOUT_MS + 10_000);

  afterAll(() => {
    try {
      execSync(`docker rm -f ${CONTAINER_NAME}`, {
        stdio: 'pipe',
        timeout: 15_000,
      });
    } catch {
      // best-effort cleanup
    }
  });

  // ── Runtime file checks ──────────────────────────────────────────────

  const requiredFiles = [
    'docs/development/README.md',
    'docs/development/getting-started/README.md',
    'docs/development/getting-started/installation.md',
    'docs/development/getting-started/quickstart.md',
    'docs/index.html',
    'docs/chat.html',
    'docs/agents.html',
    'templates/SOUL.md',
    'skills/hybridclaw-help/SKILL.md',
  ];

  test.each(requiredFiles)('image contains %s', (filePath) => {
    const result = dockerExec(`test -f ${filePath} && echo exists`);
    expect(result).toBe('exists');
  });

  // ── HTTP endpoint checks ─────────────────────────────────────────────

  test('/health returns ok', async () => {
    const res = await fetch(`${GATEWAY_URL}/health`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.version).toBeTruthy();
  });

  test('/docs renders Getting Started content', async () => {
    const res = await fetch(`${GATEWAY_URL}/docs`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Getting Started');
    expect(html).toContain('Installation');
  });

  test('/docs/getting-started renders section page', async () => {
    const res = await fetch(`${GATEWAY_URL}/docs/getting-started`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Getting Started');
  });

  test('/docs/getting-started/README.md serves raw markdown', async () => {
    const res = await fetch(
      `${GATEWAY_URL}/docs/getting-started/README.md`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    const md = await res.text();
    expect(md).toContain('# Getting Started');
  });

  test('/ serves the landing page', async () => {
    const res = await fetch(GATEWAY_URL, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('HybridClaw');
  });

  test('/chat serves the chat SPA', async () => {
    const res = await fetch(`${GATEWAY_URL}/chat`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toBeTruthy();
  });

  // ── Provider health (real key only) ──────────────────────────────────

  test.skipIf(!HAS_REAL_KEY)(
    '/health reports HybridAI provider reachable',
    async () => {
      // Allow time for the background provider probe to complete
      await new Promise((r) => setTimeout(r, 3_000));
      const res = await fetch(`${GATEWAY_URL}/health`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = (await res.json()) as {
        providerHealth?: {
          hybridai?: { reachable: boolean };
        };
      };
      expect(body.providerHealth?.hybridai?.reachable).toBe(true);
    },
  );
});
