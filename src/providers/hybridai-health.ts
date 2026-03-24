import {
  LOCAL_HEALTH_CHECK_INTERVAL_MS,
} from '../config/config.js';
import { logger } from '../logger.js';
import { probeHybridAI } from '../doctor/provider-probes.js';

export interface HybridAIHealthResult {
  reachable: boolean;
  detail: string;
  modelCount?: number;
  latencyMs?: number;
  error?: string;
}

let cachedResult: HybridAIHealthResult | null = null;
let probeTimer: ReturnType<typeof setInterval> | null = null;

async function runProbe(): Promise<HybridAIHealthResult> {
  const startedAt = Date.now();
  try {
    const result = await probeHybridAI();
    return {
      reachable: result.reachable,
      detail: result.detail,
      modelCount: result.modelCount,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: error }, 'HybridAI health probe failed');
    return {
      reachable: false,
      detail: message,
      error: message,
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function refreshCache(): Promise<void> {
  cachedResult = await runProbe();
}

export function getHybridAIHealth(): HybridAIHealthResult | null {
  return cachedResult;
}

export function startHybridAIHealthLoop(): void {
  stopHybridAIHealthLoop();
  void refreshCache();
  probeTimer = setInterval(
    () => {
      void refreshCache();
    },
    Math.max(5_000, LOCAL_HEALTH_CHECK_INTERVAL_MS),
  );
}

export function stopHybridAIHealthLoop(): void {
  if (!probeTimer) return;
  clearInterval(probeTimer);
  probeTimer = null;
}
