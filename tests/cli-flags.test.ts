import { describe, expect, it } from 'vitest';

import { hasSandboxFlag, parseGatewayFlags } from '../src/cli-flags.js';

describe('parseGatewayFlags', () => {
  it('parses gateway lifecycle flags without sandbox override', () => {
    expect(parseGatewayFlags(['--foreground'])).toEqual({
      foreground: true,
      help: false,
      sandboxMode: null,
    });
  });

  it('parses equals-style sandbox override', () => {
    expect(parseGatewayFlags(['--foreground', '--sandbox=host'])).toEqual({
      foreground: true,
      help: false,
      sandboxMode: 'host',
    });
  });

  it('parses split sandbox override', () => {
    expect(parseGatewayFlags(['--sandbox', 'container'])).toEqual({
      foreground: false,
      help: false,
      sandboxMode: 'container',
    });
  });

  it('parses help without starting the command', () => {
    expect(parseGatewayFlags(['--help'])).toEqual({
      foreground: false,
      help: true,
      sandboxMode: null,
    });
  });

  it('throws on invalid sandbox override', () => {
    expect(() => parseGatewayFlags(['--sandbox=weird'])).toThrow(
      /Invalid value for --sandbox/,
    );
  });
});

describe('hasSandboxFlag', () => {
  it('detects sandbox flags in gateway subcommand args', () => {
    expect(hasSandboxFlag(['status', '--sandbox=host'])).toBe(true);
    expect(hasSandboxFlag(['status'])).toBe(false);
  });
});
