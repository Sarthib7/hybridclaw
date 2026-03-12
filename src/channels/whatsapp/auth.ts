import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { useMultiFileAuthState } from '@whiskeysockets/baileys';

export const WHATSAPP_AUTH_DIR = path.join(
  os.homedir(),
  '.hybridclaw',
  'credentials',
  'whatsapp',
);

export async function ensureWhatsAppAuthDir(
  authDir = WHATSAPP_AUTH_DIR,
): Promise<string> {
  await fs.mkdir(authDir, { recursive: true });
  return authDir;
}

export async function resetWhatsAppAuthState(
  authDir = WHATSAPP_AUTH_DIR,
): Promise<string> {
  await fs.rm(authDir, { recursive: true, force: true });
  await fs.mkdir(authDir, { recursive: true });
  return authDir;
}

export async function loadWhatsAppAuthState(authDir = WHATSAPP_AUTH_DIR) {
  const resolvedAuthDir = await ensureWhatsAppAuthDir(authDir);
  return useMultiFileAuthState(resolvedAuthDir);
}

export async function getWhatsAppAuthStatus(
  authDir = WHATSAPP_AUTH_DIR,
): Promise<{
  linked: boolean;
  jid: string | null;
}> {
  const credsPath = path.join(authDir, 'creds.json');
  try {
    const raw = await fs.readFile(credsPath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      registered?: unknown;
      me?: { id?: unknown } | null;
    };
    const jid =
      typeof parsed?.me?.id === 'string' && parsed.me.id.trim()
        ? parsed.me.id.trim()
        : null;
    const linked = jid != null || parsed?.registered === true;
    return { linked, jid };
  } catch {
    return { linked: false, jid: null };
  }
}
