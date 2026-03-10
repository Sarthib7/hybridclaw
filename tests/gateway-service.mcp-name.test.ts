import { expect, test } from 'vitest';

import { parseMcpServerName } from '../src/gateway/gateway-service.js';

test('accepts stable lowercase MCP server names', () => {
  expect(parseMcpServerName('github')).toEqual({ name: 'github' });
  expect(parseMcpServerName('hf_server-1')).toEqual({
    name: 'hf_server-1',
  });
});

test('rejects MCP server names that would sanitize unpredictably', () => {
  expect(parseMcpServerName('')).toEqual({
    error: 'Usage: `mcp add <name> <json>`',
  });
  expect(parseMcpServerName('foo bar').error).toContain(
    'MCP server name must use lowercase letters',
  );
  expect(parseMcpServerName('FooBar').error).toContain(
    'MCP server name must use lowercase letters',
  );
  expect(parseMcpServerName('foo/bar').error).toContain(
    'MCP server name must use lowercase letters',
  );
});
