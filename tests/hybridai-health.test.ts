import { afterEach, describe, expect, test, vi } from 'vitest';

const probeHybridAIMock = vi.fn();

vi.mock('../src/doctor/provider-probes.js', () => ({
  probeHybridAI: probeHybridAIMock,
}));

vi.mock('../src/config/config.js', () => ({
  LOCAL_HEALTH_CHECK_INTERVAL_MS: 60_000,
}));

vi.mock('../src/logger.js', () => ({
  logger: { warn: vi.fn() },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

async function importFreshModule() {
  probeHybridAIMock.mockReset();
  vi.resetModules();

  vi.doMock('../src/doctor/provider-probes.js', () => ({
    probeHybridAI: probeHybridAIMock,
  }));
  vi.doMock('../src/config/config.js', () => ({
    LOCAL_HEALTH_CHECK_INTERVAL_MS: 60_000,
  }));
  vi.doMock('../src/logger.js', () => ({
    logger: { warn: vi.fn() },
  }));

  return import('../src/providers/hybridai-health.js');
}

describe('hybridai-health', () => {
  test('getHybridAIHealth returns null before any probe runs', async () => {
    const mod = await importFreshModule();
    expect(mod.getHybridAIHealth()).toBeNull();
  });

  test('caches a successful probe result', async () => {
    const mod = await importFreshModule();

    probeHybridAIMock.mockResolvedValueOnce({
      reachable: true,
      detail: '42ms',
      modelCount: 5,
    });

    mod.startHybridAIHealthLoop();

    await vi.waitFor(() => {
      expect(mod.getHybridAIHealth()).not.toBeNull();
    });

    const result = mod.getHybridAIHealth()!;
    expect(result).toMatchObject({
      reachable: true,
      detail: '42ms',
      modelCount: 5,
    });
    expect(typeof result.latencyMs).toBe('number');
    expect(result.error).toBeUndefined();

    mod.stopHybridAIHealthLoop();
  });

  test('caches unreachable result when probe returns reachable=false', async () => {
    const mod = await importFreshModule();

    probeHybridAIMock.mockResolvedValueOnce({
      reachable: false,
      detail: 'API key missing',
    });

    mod.startHybridAIHealthLoop();

    await vi.waitFor(() => {
      expect(mod.getHybridAIHealth()).not.toBeNull();
    });

    expect(mod.getHybridAIHealth()).toMatchObject({
      reachable: false,
      detail: 'API key missing',
    });

    mod.stopHybridAIHealthLoop();
  });

  test('caches error result when probe throws', async () => {
    const mod = await importFreshModule();

    probeHybridAIMock.mockRejectedValueOnce(
      new Error('connect ECONNREFUSED'),
    );

    mod.startHybridAIHealthLoop();

    await vi.waitFor(() => {
      expect(mod.getHybridAIHealth()).not.toBeNull();
    });

    const result = mod.getHybridAIHealth()!;
    expect(result).toMatchObject({
      reachable: false,
      detail: 'connect ECONNREFUSED',
      error: 'connect ECONNREFUSED',
    });
    expect(typeof result.latencyMs).toBe('number');

    mod.stopHybridAIHealthLoop();
  });

  test('loop refreshes cached result on interval', async () => {
    vi.useFakeTimers();

    const mod = await importFreshModule();

    probeHybridAIMock
      .mockResolvedValueOnce({
        reachable: true,
        detail: '10ms',
        modelCount: 3,
      })
      .mockResolvedValueOnce({
        reachable: false,
        detail: 'API key missing',
      });

    mod.startHybridAIHealthLoop();

    // Flush the initial fire-and-forget probe (microtask)
    await vi.advanceTimersByTimeAsync(1);

    expect(mod.getHybridAIHealth()).toMatchObject({
      reachable: true,
      modelCount: 3,
    });

    // Advance past the interval to trigger the second probe
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mod.getHybridAIHealth()).toMatchObject({
      reachable: false,
      detail: 'API key missing',
    });

    mod.stopHybridAIHealthLoop();
  });

  test('stopHybridAIHealthLoop clears the interval', async () => {
    vi.useFakeTimers();

    const mod = await importFreshModule();

    probeHybridAIMock.mockResolvedValue({
      reachable: true,
      detail: '5ms',
      modelCount: 1,
    });

    mod.startHybridAIHealthLoop();

    // Flush initial probe
    await vi.advanceTimersByTimeAsync(1);
    expect(probeHybridAIMock).toHaveBeenCalledTimes(1);

    mod.stopHybridAIHealthLoop();

    // Advance past what would be the next interval tick
    await vi.advanceTimersByTimeAsync(120_000);

    // No additional calls after stopping
    expect(probeHybridAIMock).toHaveBeenCalledTimes(1);
  });

  test('startHybridAIHealthLoop stops previous loop before starting', async () => {
    vi.useFakeTimers();

    const mod = await importFreshModule();

    probeHybridAIMock.mockResolvedValue({
      reachable: true,
      detail: '5ms',
      modelCount: 1,
    });

    // Start twice
    mod.startHybridAIHealthLoop();
    await vi.advanceTimersByTimeAsync(1);
    mod.startHybridAIHealthLoop();
    await vi.advanceTimersByTimeAsync(1);

    // Advance one interval — should fire only once (from the second loop)
    const callsBefore = probeHybridAIMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(probeHybridAIMock).toHaveBeenCalledTimes(callsBefore + 1);

    mod.stopHybridAIHealthLoop();
  });

  test('non-Error throw is stringified in error result', async () => {
    const mod = await importFreshModule();

    probeHybridAIMock.mockRejectedValueOnce('string error');

    mod.startHybridAIHealthLoop();

    await vi.waitFor(() => {
      expect(mod.getHybridAIHealth()).not.toBeNull();
    });

    expect(mod.getHybridAIHealth()).toMatchObject({
      reachable: false,
      detail: 'string error',
      error: 'string error',
    });

    mod.stopHybridAIHealthLoop();
  });
});
