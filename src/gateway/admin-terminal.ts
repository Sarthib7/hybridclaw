import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { type IPty, spawn as spawnPty } from 'node-pty';
import type WebSocket from 'ws';
import * as wsModule from 'ws';
import { resolveInstallRoot } from '../infra/install-root.js';
import { logger } from '../logger.js';

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const MIN_COLS = 24;
const MAX_COLS = 320;
const MIN_ROWS = 10;
const MAX_ROWS = 120;
const ATTACH_TIMEOUT_MS = 15_000;
const OUTPUT_BUFFER_LIMIT_BYTES = 256 * 1024;

export interface AdminTerminalStartOptions {
  cols?: number;
  rows?: number;
}

export interface AdminTerminalStartResponse {
  sessionId: string;
  websocketPath: string;
}

type ClientMessage =
  | {
      type: 'auth';
      token: string;
    }
  | {
      type: 'input';
      data: string;
    }
  | {
      type: 'resize';
      cols: number;
      rows: number;
    };

type ServerMessage =
  | {
      type: 'output';
      data: string;
    }
  | {
      type: 'exit';
      exitCode: number | null;
      signal: number | null;
    };

type TerminalSession = {
  id: string;
  pty: IPty;
  socket: WebSocket | null;
  outputBuffer: string[];
  outputBufferBytes: number;
  exited: boolean;
  exitCode: number | null;
  signal: number | null;
  attachTimer: NodeJS.Timeout | null;
  closed: boolean;
};

type WebSocketServerInstance = {
  handleUpgrade: (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    cb: (socket: WebSocket) => void,
  ) => void;
  close: () => void;
};

function clampDimension(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function resolveTuiLaunchCommand(): { command: string; args: string[] } {
  const installRoot = resolveInstallRoot();
  const builtEntrypoint = path.join(installRoot, 'dist', 'cli.js');
  if (fs.existsSync(builtEntrypoint)) {
    return { command: process.execPath, args: [builtEntrypoint, 'tui'] };
  }

  const sourceEntrypoint = path.join(installRoot, 'src', 'cli.ts');
  const tsxPackageDir = path.join(installRoot, 'node_modules', 'tsx');
  if (fs.existsSync(sourceEntrypoint) && fs.existsSync(tsxPackageDir)) {
    return {
      command: process.execPath,
      args: ['--import', 'tsx', sourceEntrypoint, 'tui'],
    };
  }

  throw new Error(
    'Unable to locate the HybridClaw CLI entrypoint for the embedded terminal.',
  );
}

function ensureNodePtySpawnHelpersExecutable(installRoot: string): void {
  const prebuildsDir = path.join(
    installRoot,
    'node_modules',
    'node-pty',
    'prebuilds',
  );

  let entries: string[];
  try {
    entries = fs.readdirSync(prebuildsDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const helperPath = path.join(prebuildsDir, entry, 'spawn-helper');
    let stat: fs.Stats;
    try {
      stat = fs.statSync(helperPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if ((stat.mode & 0o111) !== 0) continue;
    fs.chmodSync(helperPath, stat.mode | 0o755);
    logger.warn(
      { helperPath },
      'Restored execute bit on node-pty spawn-helper',
    );
  }
}

function formatLaunchCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(' ');
}

function parseClientMessage(raw: WebSocket.Data): ClientMessage | null {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const candidate = parsed as Record<string, unknown>;
  if (candidate.type === 'auth' && typeof candidate.token === 'string') {
    return {
      type: 'auth',
      token: candidate.token,
    };
  }
  if (candidate.type === 'input' && typeof candidate.data === 'string') {
    return {
      type: 'input',
      data: candidate.data,
    };
  }
  if (
    candidate.type === 'resize' &&
    typeof candidate.cols === 'number' &&
    typeof candidate.rows === 'number'
  ) {
    return {
      type: 'resize',
      cols: candidate.cols,
      rows: candidate.rows,
    };
  }
  return null;
}

function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function createAdminTerminalManager(): {
  startSession: (
    options?: AdminTerminalStartOptions,
  ) => AdminTerminalStartResponse;
  stopSession: (sessionId: string) => boolean;
  handleUpgrade: (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    url: URL,
    auth?: {
      hasSessionAuth?: boolean;
      validateToken?: (token: string) => boolean;
    },
  ) => boolean;
  dispose: () => void;
} {
  const sessions = new Map<string, TerminalSession>();
  const WebSocketServerCtor =
    (
      wsModule as unknown as {
        WebSocketServer?: new (options: {
          noServer: true;
        }) => WebSocketServerInstance;
        Server?: new (options: { noServer: true }) => WebSocketServerInstance;
      }
    ).WebSocketServer ||
    (
      wsModule as unknown as {
        Server?: new (options: { noServer: true }) => WebSocketServerInstance;
      }
    ).Server;
  if (!WebSocketServerCtor) {
    throw new Error('ws WebSocketServer constructor is unavailable.');
  }
  const wss = new WebSocketServerCtor({ noServer: true });

  const cleanupSession = (
    sessionId: string,
    options?: { killPty?: boolean; closeSocket?: boolean },
  ): boolean => {
    const session = sessions.get(sessionId);
    if (!session || session.closed) return false;
    session.closed = true;
    sessions.delete(sessionId);
    if (session.attachTimer) {
      clearTimeout(session.attachTimer);
      session.attachTimer = null;
    }
    if (options?.closeSocket !== false && session.socket) {
      try {
        session.socket.close();
      } catch {
        // Ignore websocket close races during teardown.
      }
      session.socket = null;
    }
    if (options?.killPty !== false && !session.exited) {
      try {
        session.pty.kill();
      } catch {
        // Ignore PTY teardown races during cleanup.
      }
    }
    return true;
  };

  const sendMessage = (
    session: TerminalSession,
    message: ServerMessage,
  ): void => {
    const socket = session.socket;
    if (!socket || socket.readyState !== socket.OPEN) return;
    socket.send(encodeServerMessage(message));
  };

  const bufferOutput = (session: TerminalSession, data: string): void => {
    if (!data) return;
    session.outputBuffer.push(data);
    session.outputBufferBytes += Buffer.byteLength(data, 'utf8');
    while (
      session.outputBuffer.length > 0 &&
      session.outputBufferBytes > OUTPUT_BUFFER_LIMIT_BYTES
    ) {
      const removed = session.outputBuffer.shift() || '';
      session.outputBufferBytes -= Buffer.byteLength(removed, 'utf8');
    }
  };

  const flushBufferedOutput = (session: TerminalSession): void => {
    if (session.outputBuffer.length === 0) return;
    for (const chunk of session.outputBuffer) {
      sendMessage(session, {
        type: 'output',
        data: chunk,
      });
    }
    session.outputBuffer = [];
    session.outputBufferBytes = 0;
  };

  return {
    startSession(options) {
      const cols = clampDimension(
        options?.cols,
        DEFAULT_COLS,
        MIN_COLS,
        MAX_COLS,
      );
      const rows = clampDimension(
        options?.rows,
        DEFAULT_ROWS,
        MIN_ROWS,
        MAX_ROWS,
      );
      const installRoot = resolveInstallRoot();
      ensureNodePtySpawnHelpersExecutable(installRoot);
      const launch = resolveTuiLaunchCommand();
      const sessionId = randomUUID();
      const launchCwd = process.cwd();
      let pty: IPty;
      try {
        logger.info(
          {
            sessionId,
            cols,
            rows,
            cwd: launchCwd,
            installRoot,
            command: launch.command,
            args: launch.args,
            launchText: formatLaunchCommand(launch.command, launch.args),
          },
          'Starting admin terminal PTY',
        );
        pty = spawnPty(launch.command, launch.args, {
          cols,
          cwd: launchCwd,
          env: {
            ...process.env,
            COLORTERM: 'truecolor',
            TERM: 'xterm-256color',
          },
          name: 'xterm-256color',
          rows,
        });
      } catch (error) {
        logger.error(
          {
            error,
            sessionId,
            cols,
            rows,
            cwd: launchCwd,
            installRoot,
            command: launch.command,
            args: launch.args,
            launchText: formatLaunchCommand(launch.command, launch.args),
            execPath: process.execPath,
          },
          'Failed to start admin terminal PTY',
        );
        throw error;
      }

      const session: TerminalSession = {
        id: sessionId,
        pty,
        socket: null,
        outputBuffer: [],
        outputBufferBytes: 0,
        exited: false,
        exitCode: null,
        signal: null,
        attachTimer: setTimeout(() => {
          logger.warn(
            { sessionId },
            'Admin terminal timed out waiting for websocket attachment',
          );
          cleanupSession(sessionId);
        }, ATTACH_TIMEOUT_MS),
        closed: false,
      };

      pty.onData((data) => {
        if (session.closed) return;
        if (session.socket) {
          sendMessage(session, {
            type: 'output',
            data,
          });
          return;
        }
        bufferOutput(session, data);
      });

      pty.onExit(({ exitCode, signal }) => {
        if (session.closed) return;
        session.exited = true;
        session.exitCode = exitCode ?? null;
        session.signal = signal ?? null;
        sendMessage(session, {
          type: 'exit',
          exitCode: exitCode ?? null,
          signal: signal ?? null,
        });
        if (session.socket) {
          try {
            session.socket.close();
          } catch {
            // Ignore close races; the close handler performs final cleanup.
          }
        } else {
          setTimeout(() => {
            cleanupSession(sessionId, {
              killPty: false,
            });
          }, 1_000);
        }
      });

      sessions.set(sessionId, session);
      logger.info({ sessionId, cols, rows }, 'Started admin terminal session');

      return {
        sessionId,
        websocketPath: `/api/admin/terminal/stream?sessionId=${encodeURIComponent(sessionId)}`,
      };
    },

    stopSession(sessionId) {
      return cleanupSession(sessionId);
    },

    handleUpgrade(req, socket, head, url, auth) {
      if (url.pathname !== '/api/admin/terminal/stream') {
        return false;
      }

      const sessionId = String(url.searchParams.get('sessionId') || '').trim();
      const session = sessions.get(sessionId);
      if (!session || session.closed) {
        return false;
      }

      if (session.socket && session.socket.readyState === session.socket.OPEN) {
        return false;
      }

      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        let authenticated = auth?.hasSessionAuth === true;
        let authTimer: NodeJS.Timeout | null = null;
        const closeUnauthorized = () => {
          if (authTimer) {
            clearTimeout(authTimer);
            authTimer = null;
          }
          try {
            ws.close(4401, 'Unauthorized');
          } catch {
            ws.close();
          }
        };
        const attachSocket = () => {
          if (session.attachTimer) {
            clearTimeout(session.attachTimer);
            session.attachTimer = null;
          }
          if (authTimer) {
            clearTimeout(authTimer);
            authTimer = null;
          }
          session.socket = ws;
          flushBufferedOutput(session);
          if (session.exited) {
            sendMessage(session, {
              type: 'exit',
              exitCode: session.exitCode,
              signal: session.signal,
            });
          }
        };

        if (authenticated) {
          attachSocket();
        } else {
          authTimer = setTimeout(() => {
            closeUnauthorized();
          }, ATTACH_TIMEOUT_MS);
        }

        ws.on('message', (raw: WebSocket.Data) => {
          const message = parseClientMessage(raw);
          if (!message || session.closed) return;
          if (!authenticated) {
            if (message.type !== 'auth') {
              closeUnauthorized();
              return;
            }
            const token = message.token.trim();
            if (!token || !auth?.validateToken?.(token)) {
              closeUnauthorized();
              return;
            }
            authenticated = true;
            attachSocket();
            return;
          }
          if (message.type === 'auth') {
            return;
          }
          if (message.type === 'input') {
            session.pty.write(message.data);
            return;
          }
          session.pty.resize(
            clampDimension(message.cols, DEFAULT_COLS, MIN_COLS, MAX_COLS),
            clampDimension(message.rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS),
          );
        });

        ws.on('close', () => {
          if (authTimer) {
            clearTimeout(authTimer);
            authTimer = null;
          }
          if (session.socket === ws) {
            session.socket = null;
            cleanupSession(sessionId);
          }
        });

        ws.on('error', (error: Error) => {
          logger.debug({ error, sessionId }, 'Admin terminal websocket error');
        });
      });

      return true;
    },

    dispose() {
      for (const sessionId of sessions.keys()) {
        cleanupSession(sessionId);
      }
      wss.close();
    },
  };
}
