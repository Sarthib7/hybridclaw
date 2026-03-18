import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';
import type { RuntimeConfig } from '../src/config/runtime-config.js';
import { createPluginApi } from '../src/plugins/plugin-api.js';
import type { PluginManager } from '../src/plugins/plugin-manager.js';

function loadRuntimeConfig(): RuntimeConfig {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'config.example.json'), 'utf-8'),
  ) as RuntimeConfig;
}

function makePluginManagerStub(): PluginManager {
  return {
    registerMemoryLayer() {},
    registerProvider() {},
    registerChannel() {},
    registerTool() {},
    registerPromptHook() {},
    registerCommand() {},
    registerService() {},
    registerHook() {},
  } as unknown as PluginManager;
}

test('createPluginApi exposes immutable config snapshots without freezing caller inputs', () => {
  const config = loadRuntimeConfig();
  const pluginConfig = {
    workspaceId: 'workspace-1',
    nested: {
      enabled: true,
    },
  };
  const originalPluginList = structuredClone(config.plugins.list);

  const api = createPluginApi({
    manager: makePluginManagerStub(),
    pluginId: 'demo-plugin',
    pluginDir: '/tmp/demo-plugin',
    registrationMode: 'full',
    config,
    pluginConfig,
    homeDir: '/tmp/home',
    cwd: '/tmp/project',
  });

  expect(Object.isFrozen(api)).toBe(true);
  expect(Object.isFrozen(api.config)).toBe(true);
  expect(Object.isFrozen(api.config.plugins)).toBe(true);
  expect(Object.isFrozen(api.pluginConfig)).toBe(true);
  expect(
    Object.isFrozen(
      (api.pluginConfig as {
        nested: {
          enabled: boolean;
        };
      }).nested,
    ),
  ).toBe(true);
  expect(Object.isFrozen(config)).toBe(false);
  expect(api.config).not.toBe(config);
  expect(api.pluginConfig).not.toBe(pluginConfig);
  expect(
    (api.pluginConfig as {
      nested: {
        enabled: boolean;
      };
    }).nested,
  ).not.toBe(pluginConfig.nested);

  config.plugins.list.push({
    id: 'mutated-plugin',
    enabled: false,
    config: {},
  });
  pluginConfig.nested.enabled = false;

  expect(api.config.plugins.list).toEqual(originalPluginList);
  expect(
    (api.pluginConfig as {
      nested: {
        enabled: boolean;
      };
    }).nested.enabled,
  ).toBe(true);

  expect(() => {
    (
      api.pluginConfig as {
        nested: {
          enabled: boolean;
        };
      }
    ).nested.enabled = false;
  }).toThrow(TypeError);
});
