/**
 * Integration test: Real HTTP server + docs rendering.
 *
 * Starts a real HTTP server using the gateway's `serveDocs` handler,
 * reads real markdown files from disk, and verifies HTML rendering,
 * raw markdown serving, search, and redirects.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let server: http.Server;
let baseUrl: string;

// Dynamic import of serveDocs — resolved after server setup.
let serveDocs: typeof import('../src/gateway/docs.js').serveDocs;

beforeAll(async () => {
  // Import docs module — it resolves install root from the package tree,
  // and SITE_DIR/DEVELOPMENT_DOCS_DIR from the real docs/ directory.
  const docsModule = await import('../src/gateway/docs.js');
  serveDocs = docsModule.serveDocs;

  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost`);
    const handled = serveDocs(url, res);
    if (!handled) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe('gateway docs HTTP integration', () => {
  it('GET /docs renders HTML with Getting Started', async () => {
    const res = await fetch(`${baseUrl}/docs`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Getting Started');
  });

  it('GET /docs/getting-started renders section page with authentication link', async () => {
    const res = await fetch(`${baseUrl}/docs/getting-started`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html.toLowerCase()).toContain('authentication');
  });

  it('GET /docs/getting-started/README.md serves raw markdown with correct content-type', async () => {
    const res = await fetch(`${baseUrl}/docs/getting-started/README.md`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get('content-type') || '';
    expect(contentType).toContain('text/markdown');
    const body = await res.text();
    // The raw markdown should contain frontmatter or heading text.
    expect(body).toContain('Getting Started');
  });

  it('GET /docs?search=install returns search results', async () => {
    const res = await fetch(`${baseUrl}/docs?search=install`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    // Search results page should mention the search term or contain result markup.
    expect(html.toLowerCase()).toContain('install');
  });

  it('GET /development/getting-started returns 308 redirect to /docs/getting-started', async () => {
    const res = await fetch(`${baseUrl}/development/getting-started`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(308);
    const location = res.headers.get('location') || '';
    expect(location).toBe('/docs/getting-started');
  });

  it('docs with missing file returns 404 (not a crash)', async () => {
    const res = await fetch(
      `${baseUrl}/docs/this-section-does-not-exist-at-all`,
    );
    // serveDocs returns false for unknown paths, so our wrapper returns 404.
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
  });
});
