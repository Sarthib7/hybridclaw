/**
 * Browser Login — opens a headed Chromium browser with the shared persistent
 * profile directory so the user can manually log into sites (Google, etc.).
 *
 * The logged-in session (cookies, localStorage, IndexedDB) is persisted in
 * `~/.hybridclaw/data/browser-profiles/` and automatically mounted into
 * agent containers, giving the agent access to authenticated browser sessions
 * without needing credentials in chat.
 */
import { type ChildProcess, execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface BrowserLoginOptions {
  /** URL to open when the browser starts (default: about:blank). */
  url?: string;
  /** Override the profile directory. */
  profileDir?: string;
}

function resolvePlaywrightChromium(): string | null {
  const envPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const searchRoots = [
    envPath,
    path.join(
      process.cwd(),
      'node_modules',
      'playwright-core',
      '.local-browsers',
    ),
    path.join(process.cwd(), 'node_modules', 'playwright', '.local-browsers'),
  ].filter(Boolean) as string[];

  for (const root of searchRoots) {
    if (!fs.existsSync(root)) continue;
    try {
      const entries = fs.readdirSync(root);
      const chromiumDir = entries.find((e) => e.startsWith('chromium'));
      if (!chromiumDir) continue;
      const candidates = [
        path.join(root, chromiumDir, 'chrome-linux', 'chrome'),
        path.join(root, chromiumDir, 'chrome-linux', 'headless_shell'),
        path.join(root, chromiumDir, 'chrome'),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
      }
    } catch {}
  }
  return null;
}

function resolveChromeBinary(): string {
  // Prefer system Chrome/Chromium for headed login (better UX)
  const systemBrowsers = [
    'google-chrome',
    'google-chrome-stable',
    'chromium-browser',
    'chromium',
  ];
  for (const browser of systemBrowsers) {
    const result = spawnSync('which', [browser], { encoding: 'utf-8' });
    if (result.status === 0 && result.stdout?.trim()) {
      return result.stdout.trim();
    }
  }

  // Fallback to Playwright-installed Chromium
  const playwrightChromium = resolvePlaywrightChromium();
  if (playwrightChromium) return playwrightChromium;

  throw new Error(
    'No Chrome or Chromium browser found. Install google-chrome, chromium, or run `npx playwright install chromium`.',
  );
}

export async function launchBrowserLogin(
  profileDir: string,
  options: BrowserLoginOptions = {},
): Promise<ChildProcess> {
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });

  const chromeBin = resolveChromeBinary();
  const url = options.url || 'about:blank';

  const args = [
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    url,
  ];

  const child = execFile(chromeBin, args, {
    timeout: 0, // no timeout — user controls the session
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
  });

  return child;
}

export function getBrowserProfileDir(dataDir: string): string {
  return path.join(dataDir, 'browser-profiles');
}
