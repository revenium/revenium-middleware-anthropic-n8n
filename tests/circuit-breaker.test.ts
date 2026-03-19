import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logTokenUsage, resetGlobalStateForTesting, flushBatchesForTesting } from '../src/utils/index.js';
import { reveniumCircuitBreaker } from '../src/constants/constants.js';
import type { UsageMetadata, ReveniumConfig } from '../src/types/index.js';

vi.mock('../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(), critical: vi.fn() }
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;
let originalEnv: NodeJS.ProcessEnv;

const mockConfig: ReveniumConfig = {
  apiKey: 'test-revenium-api-key-12345678',
  baseUrl: 'https://api.revenium.ai'
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetGlobalStateForTesting();
  originalEnv = { ...process.env };
  delete process.env.REVENIUM_METERING_API_KEY;
  delete process.env.REVENIUM_METERING_BASE_URL;
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ id: 'resp-123' }),
    text: () => Promise.resolve(''),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env = originalEnv;
});

function callLogTokenUsage(config?: ReveniumConfig, metadata: UsageMetadata = {}) {
  return logTokenUsage(
    'resp-001',
    'claude-sonnet-4-20250514',
    100,
    50,
    150,
    10,
    'END',
    '2026-02-25T10:00:00.000Z',
    '2026-02-25T10:00:01.000Z',
    1000,
    metadata,
    false,
    0,
    config,
    0,
    0,
  );
}

async function drainBatch(extraMs = 0) {
  await vi.advanceTimersByTimeAsync(5100 + extraMs);
}

describe('Circuit Breaker', () => {
  it('sends request to Revenium API on successful call', async () => {
    const promise = callLogTokenUsage(mockConfig);
    await drainBatch();
    await promise;

    expect(mockFetch).toHaveBeenCalled();
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toContain('/ai/completions');
    const body = JSON.parse(options.body);
    expect(body.provider).toBe('ANTHROPIC');
    expect(body.middlewareSource).toBe('n8n');
  });

  it('retries on transient failure then succeeds', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'resp-retry' }),
        text: () => Promise.resolve(''),
      });

    const promise = callLogTokenUsage(mockConfig);
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('opens circuit breaker after exhausting max retries', async () => {
    reveniumCircuitBreaker.state = 'OPEN';
    reveniumCircuitBreaker.failures = 5;
    reveniumCircuitBreaker.lastFailureTime = Date.now();

    const promise = callLogTokenUsage(mockConfig);
    await drainBatch();
    await promise;

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('includes correct payload structure', async () => {
    const promise = callLogTokenUsage(mockConfig);
    await drainBatch();
    await promise;

    const [, options] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(options.body);
    expect(body.stopReason).toBe('END');
    expect(body.model).toBe('claude-sonnet-4-20250514');
    expect(body.inputTokenCount).toBe(100);
    expect(body.outputTokenCount).toBe(50);
    expect(body.totalTokenCount).toBe(150);
    expect(body.provider).toBe('ANTHROPIC');
    expect(body.middlewareSource).toBe('n8n');
    expect(body.costType).toBe('AI');
    expect(body.operationType).toBe('CHAT');
  });

  it('skips metering when config and env vars are missing', async () => {
    const promise = callLogTokenUsage(undefined);
    await drainBatch();
    await promise;

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('falls back to environment variables when config is not provided', async () => {
    process.env.REVENIUM_METERING_API_KEY = 'env-api-key-that-is-long-enough';
    process.env.REVENIUM_METERING_BASE_URL = 'https://api.revenium.ai';

    const promise = callLogTokenUsage(undefined);
    await drainBatch();
    await promise;

    expect(mockFetch).toHaveBeenCalled();
  });

  it('includes subscriber metadata in payload', async () => {
    const metadata: UsageMetadata = {
      subscriberId: 'sub-001',
      subscriberEmail: 'user@test.com',
    };

    const promise = callLogTokenUsage(mockConfig, metadata);
    await drainBatch();
    await promise;

    const [, options] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(options.body);
    expect(body.subscriber).toBeDefined();
    expect(body.subscriber.id).toBe('sub-001');
    expect(body.subscriber.email).toBe('user@test.com');
  });

  it('does not include subscriber when metadata is empty', async () => {
    const promise = callLogTokenUsage(mockConfig, {});
    await drainBatch();
    await promise;

    const [, options] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(options.body);
    expect(body.subscriber).toBeUndefined();
  });

  it('sets isStreamed and timeToFirstToken in payload', async () => {
    const promise = logTokenUsage(
      'resp-stream',
      'claude-sonnet-4-20250514',
      200,
      100,
      300,
      20,
      'END',
      '2026-02-25T12:00:00.000Z',
      '2026-02-25T12:00:02.000Z',
      2000,
      {},
      true,
      450,
      mockConfig,
      0,
      0,
    );
    await drainBatch();
    await promise;

    const [, options] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(options.body);
    expect(body.isStreamed).toBe(true);
    expect(body.timeToFirstToken).toBe(450);
  });

  it('includes reasoning and cache creation tokens in payload', async () => {
    const promise = logTokenUsage(
      'resp-reasoning',
      'claude-sonnet-4-20250514',
      300,
      150,
      500,
      25,
      'END',
      '2026-02-25T14:00:00.000Z',
      '2026-02-25T14:00:03.000Z',
      3000,
      {},
      false,
      0,
      mockConfig,
      50,
      75,
    );
    await drainBatch();
    await promise;

    const [, options] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(options.body);
    expect(body.cacheCreationTokenCount).toBe(50);
    expect(body.reasoningTokenCount).toBe(75);
    expect(body.cacheReadTokenCount).toBe(25);
  });
});
