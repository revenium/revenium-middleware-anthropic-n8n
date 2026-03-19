import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(), critical: vi.fn() },
}));

import {
  getStopReason,
  getISOTimestamp,
  calculateDuration,
  generateCorrelationId,
  getTimeoutConfig,
  buildSubscriberObject,
  getSecureHeaders,
  checkRateLimit,
  resetGlobalStateForTesting,
} from '../src/utils/index.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  resetGlobalStateForTesting();
});

describe('getStopReason', () => {
  it('maps end_turn to END', () => {
    expect(getStopReason('end_turn')).toBe('END');
  });

  it('maps max_tokens to TOKEN_LIMIT', () => {
    expect(getStopReason('max_tokens')).toBe('TOKEN_LIMIT');
  });

  it('maps stop_sequence to END_SEQUENCE', () => {
    expect(getStopReason('stop_sequence')).toBe('END_SEQUENCE');
  });

  it('maps tool_use to END', () => {
    expect(getStopReason('tool_use')).toBe('END');
  });

  it('returns END for undefined', () => {
    expect(getStopReason(undefined)).toBe('END');
  });

  it('returns END for unknown reason', () => {
    expect(getStopReason('unknown_value' as any)).toBe('END');
  });
});

describe('getISOTimestamp', () => {
  it('returns a valid ISO string format', () => {
    const timestamp = getISOTimestamp();
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('returns ISO string for a specific date', () => {
    const date = new Date('2026-01-15T10:30:00.000Z');
    expect(getISOTimestamp(date)).toBe('2026-01-15T10:30:00.000Z');
  });

  it('returns current time when no date provided', () => {
    const before = Date.now();
    const timestamp = getISOTimestamp();
    const after = Date.now();
    const parsed = new Date(timestamp).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});

describe('calculateDuration', () => {
  it('calculates difference between start and end', () => {
    expect(calculateDuration(1000, 2500)).toBe(1500);
  });

  it('uses Date.now when no endTime provided', () => {
    const start = Date.now() - 500;
    const duration = calculateDuration(start);
    expect(duration).toBeGreaterThanOrEqual(500);
    expect(duration).toBeLessThan(1000);
  });

  it('handles zero duration', () => {
    expect(calculateDuration(5000, 5000)).toBe(0);
  });
});

describe('generateCorrelationId', () => {
  it('starts with revenium-', () => {
    expect(generateCorrelationId()).toMatch(/^revenium-/);
  });

  it('produces unique values across calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateCorrelationId()));
    expect(ids.size).toBe(50);
  });

  it('has three parts separated by hyphens after the prefix', () => {
    const id = generateCorrelationId();
    const parts = id.split('-');
    expect(parts.length).toBe(3);
    expect(parts[0]).toBe('revenium');
    expect(/^\d+$/.test(parts[1]!)).toBe(true);
    expect(parts[2]!.length).toBeGreaterThanOrEqual(1);
    expect(parts[2]!.length).toBeLessThanOrEqual(9);
  });
});

describe('getTimeoutConfig', () => {
  it('returns default values when no env vars are set', () => {
    delete process.env.REVENIUM_MODEL_TIMEOUT;
    delete process.env.REVENIUM_TOOL_TIMEOUT;
    delete process.env.REVENIUM_STREAM_TIMEOUT;
    delete process.env.REVENIUM_API_TIMEOUT;

    const config = getTimeoutConfig();
    expect(config.modelInvocation).toBe(150000);
    expect(config.toolExecution).toBe(15000);
    expect(config.streamTimeout).toBe(60000);
    expect(config.apiTimeout).toBe(10000);
  });

  it('uses env vars when set', () => {
    process.env.REVENIUM_MODEL_TIMEOUT = '200000';
    process.env.REVENIUM_TOOL_TIMEOUT = '20000';
    process.env.REVENIUM_STREAM_TIMEOUT = '90000';
    process.env.REVENIUM_API_TIMEOUT = '15000';

    const config = getTimeoutConfig();
    expect(config.modelInvocation).toBe(200000);
    expect(config.toolExecution).toBe(20000);
    expect(config.streamTimeout).toBe(90000);
    expect(config.apiTimeout).toBe(15000);
  });

  it('falls back to defaults for invalid env values', () => {
    process.env.REVENIUM_MODEL_TIMEOUT = 'not-a-number';

    const config = getTimeoutConfig();
    expect(config.modelInvocation).toBe(150000);
  });

  it('returns correct structure with all four keys', () => {
    const config = getTimeoutConfig();
    expect(Object.keys(config).sort()).toEqual(
      ['apiTimeout', 'modelInvocation', 'streamTimeout', 'toolExecution']
    );
  });
});

describe('buildSubscriberObject', () => {
  it('returns undefined for empty metadata', () => {
    expect(buildSubscriberObject({})).toBeUndefined();
  });

  it('builds with camelCase fields', () => {
    const result = buildSubscriberObject({
      subscriberId: 'sub-123',
      subscriberEmail: 'user@example.com',
    });
    expect(result).toEqual({ id: 'sub-123', email: 'user@example.com' });
  });

  it('builds with snake_case fields', () => {
    const result = buildSubscriberObject({
      subscriber_id: 'sub-456',
      subscriber_email: 'alt@example.com',
    });
    expect(result).toEqual({ id: 'sub-456', email: 'alt@example.com' });
  });

  it('includes credential when both name and value provided', () => {
    const result = buildSubscriberObject({
      subscriberId: 'sub-789',
      subscriberCredentialName: 'api-key',
      subscriberCredential: 'secret-value',
    });
    expect(result).toEqual({
      id: 'sub-789',
      credential: { name: 'api-key', value: 'secret-value' },
    });
  });

  it('omits credential when only name provided', () => {
    const result = buildSubscriberObject({
      subscriberId: 'sub-100',
      subscriberCredentialName: 'api-key',
    });
    expect(result).toEqual({ id: 'sub-100' });
    expect(result?.credential).toBeUndefined();
  });

  it('returns undefined for whitespace-only values', () => {
    expect(buildSubscriberObject({ subscriberId: '   ', subscriberEmail: '  ' })).toBeUndefined();
  });
});

describe('getSecureHeaders', () => {
  it('returns all required headers', () => {
    const headers = getSecureHeaders('test-api-key-value');

    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Accept']).toBe('application/json');
    expect(headers['x-api-key']).toBe('test-api-key-value');
    expect(headers['X-Correlation-ID']).toMatch(/^revenium-/);
    expect(headers['User-Agent']).toBe('n8n-revenium-anthropic-middleware/1.0.0');
    expect(headers['Cache-Control']).toBe('no-store');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });
});

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetGlobalStateForTesting();
  });

  it('allows requests within limits', () => {
    expect(checkRateLimit({ maxRequestsPerMinute: 10, maxRequestsPerHour: 100 })).toBe(true);
  });

  it('rejects when per-minute limit is exceeded', () => {
    const config = { maxRequestsPerMinute: 3, maxRequestsPerHour: 100 };
    checkRateLimit(config);
    checkRateLimit(config);
    checkRateLimit(config);
    expect(checkRateLimit(config)).toBe(false);
  });

  it('rejects when per-hour limit is exceeded', () => {
    const config = { maxRequestsPerMinute: 100, maxRequestsPerHour: 2 };
    checkRateLimit(config);
    checkRateLimit(config);
    expect(checkRateLimit(config)).toBe(false);
  });
});
