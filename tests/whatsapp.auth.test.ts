import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

import { getWhatsAppAuthStatus } from '../src/channels/whatsapp/auth.ts';

function makeTempAuthDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hybridclaw-whatsapp-auth-'));
}

test('treats me.id as linked even when registered is false', async () => {
  const authDir = makeTempAuthDir();
  const credsPath = path.join(authDir, 'creds.json');
  fs.writeFileSync(
    credsPath,
    JSON.stringify({
      registered: false,
      me: { id: '491701234567:18@s.whatsapp.net' },
    }),
    'utf-8',
  );

  await expect(getWhatsAppAuthStatus(authDir)).resolves.toEqual({
    linked: true,
    jid: '491701234567:18@s.whatsapp.net',
  });
});

test('returns unlinked when auth state is missing', async () => {
  const authDir = makeTempAuthDir();

  await expect(getWhatsAppAuthStatus(authDir)).resolves.toEqual({
    linked: false,
    jid: null,
  });
});
