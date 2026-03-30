import { spawnSync } from 'node:child_process';
import { test, expect } from 'vitest';

test('cli entry point loads and prints help', () => {
  const result = spawnSync('node', ['dist/cli.js', '--help'], {
    encoding: 'utf-8',
    timeout: 10_000,
  });
  expect(result.status).toBe(0);
  const output = `${result.stdout}${result.stderr}`;
  expect(output.toLowerCase()).toContain('hybridclaw');
});
