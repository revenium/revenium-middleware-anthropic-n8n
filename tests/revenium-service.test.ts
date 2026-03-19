import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(), critical: vi.fn() },
}));

vi.mock('../src/utils/summary-printer.js', () => ({
  setConfig: vi.fn(),
  printUsageSummary: vi.fn(),
}));

import { ReveniumService } from '../src/services/revenium/index.js';
import type { CreateCompletionResponse } from '../src/types/index.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const defaultConfig = {
  apiKey: 'test-revenium-api-key-12345',
  baseUrl: 'https://api.revenium.ai',
};

const createMockResult = () => ({
  generations: [{
    text: 'Test response',
    message: {
      content: 'Test response',
      id: 'msg_test123',
    },
  }],
});

const createMockResponseMetadata = (overrides?: Record<string, unknown>) => ({
  stop_reason: 'end_turn',
  usage: {
    input_tokens: 10,
    output_tokens: 8,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ id: 'resp-123' }),
    text: () => Promise.resolve(''),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReveniumService', () => {
  describe('constructor', () => {
    it('creates service with config', () => {
      const service = new ReveniumService(defaultConfig);
      expect(service).toBeInstanceOf(ReveniumService);
    });

    it('calls setConfig on summary printer', async () => {
      const { setConfig } = await import('../src/utils/summary-printer.js');
      new ReveniumService({ ...defaultConfig, teamId: 'team-1', printSummary: true });

      expect(setConfig).toHaveBeenCalledWith({
        reveniumApiKey: defaultConfig.apiKey,
        reveniumBaseUrl: defaultConfig.baseUrl,
        teamId: 'team-1',
        printSummary: true,
      });
    });
  });

  describe('trackUsage - successful', () => {
    it('sends tracking data via fetch', async () => {
      const service = new ReveniumService(defaultConfig);
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata(), undefined, 500, 'claude-sonnet-4-20250514');

      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('returns response with id', async () => {
      const service = new ReveniumService(defaultConfig);
      const result = await service.trackUsage([], createMockResult() as any, createMockResponseMetadata(), undefined, 500, 'claude-sonnet-4-20250514');

      expect(result.id).toBe('resp-123');
    });

    it('payload has provider ANTHROPIC', async () => {
      const service = new ReveniumService(defaultConfig);
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata(), undefined, 500, 'claude-sonnet-4-20250514');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.provider).toBe('ANTHROPIC');
    });

    it('payload has middlewareSource n8n', async () => {
      const service = new ReveniumService(defaultConfig);
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata(), undefined, 500, 'claude-sonnet-4-20250514');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.middlewareSource).toBe('n8n');
    });

    it('payload has correct stopReason for end_turn', async () => {
      const service = new ReveniumService(defaultConfig);
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata(), undefined, 500, 'claude-sonnet-4-20250514');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stopReason).toBe('END');
    });
  });

  describe('trackUsage - token extraction', () => {
    it('extracts input_tokens and output_tokens from usage', async () => {
      const service = new ReveniumService(defaultConfig);
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata(), undefined, 500, 'claude-sonnet-4-20250514');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.inputTokenCount).toBe(10);
      expect(body.outputTokenCount).toBe(8);
    });

    it('calculates totalTokenCount', async () => {
      const service = new ReveniumService(defaultConfig);
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata(), undefined, 500, 'claude-sonnet-4-20250514');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.totalTokenCount).toBe(18);
    });

    it('extracts cache_creation_input_tokens and cache_read_input_tokens', async () => {
      const metadata = createMockResponseMetadata({
        usage: {
          input_tokens: 10,
          output_tokens: 8,
          cache_creation_input_tokens: 5,
          cache_read_input_tokens: 3,
        },
      });
      const service = new ReveniumService(defaultConfig);
      await service.trackUsage([], createMockResult() as any, metadata, undefined, 500, 'claude-sonnet-4-20250514');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.cacheCreationTokenCount).toBe(5);
      expect(body.cacheReadTokenCount).toBe(3);
    });
  });

  describe('trackUsage - stop reason mapping', () => {
    it('maps end_turn to END', async () => {
      const service = new ReveniumService(defaultConfig);
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata({ stop_reason: 'end_turn' }), undefined, 500, 'claude-sonnet-4-20250514');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stopReason).toBe('END');
    });

    it('maps max_tokens to TOKEN_LIMIT', async () => {
      const service = new ReveniumService(defaultConfig);
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata({ stop_reason: 'max_tokens' }), undefined, 500, 'claude-sonnet-4-20250514');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stopReason).toBe('TOKEN_LIMIT');
    });

    it('maps stop_sequence to END_SEQUENCE', async () => {
      const service = new ReveniumService(defaultConfig);
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata({ stop_reason: 'stop_sequence' }), undefined, 500, 'claude-sonnet-4-20250514');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stopReason).toBe('END_SEQUENCE');
    });

    it('maps tool_use to END', async () => {
      const service = new ReveniumService(defaultConfig);
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata({ stop_reason: 'tool_use' }), undefined, 500, 'claude-sonnet-4-20250514');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stopReason).toBe('END');
    });

    it('defaults to END when no stop_reason', async () => {
      const service = new ReveniumService(defaultConfig);
      const metadata = createMockResponseMetadata();
      delete (metadata as any).stop_reason;
      await service.trackUsage([], createMockResult() as any, metadata, undefined, 500, 'claude-sonnet-4-20250514');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stopReason).toBe('END');
    });
  });

  describe('trackUsage - error handling', () => {
    it('throws ReveniumError when no usage data', async () => {
      const service = new ReveniumService(defaultConfig);
      const metadata = { stop_reason: 'end_turn' };

      await expect(
        service.trackUsage([], createMockResult() as any, metadata, undefined, 500, 'claude-sonnet-4-20250514'),
      ).rejects.toThrow('Usage tracking failed');
    });

    it('throws ReveniumError when API returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Server error'),
      });

      const service = new ReveniumService(defaultConfig);

      await expect(
        service.trackUsage([], createMockResult() as any, createMockResponseMetadata(), undefined, 500, 'claude-sonnet-4-20250514'),
      ).rejects.toThrow('Usage tracking failed');
    });
  });

  describe('trackUsage - streaming options', () => {
    it('payload has isStreamed true when options.isStreamed is true', async () => {
      const service = new ReveniumService(defaultConfig);
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata(), undefined, 500, 'claude-sonnet-4-20250514', { isStreamed: true });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.isStreamed).toBe(true);
    });

    it('payload has timeToFirstToken from options', async () => {
      const service = new ReveniumService(defaultConfig);
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata(), undefined, 500, 'claude-sonnet-4-20250514', { timeToFirstToken: 150 });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.timeToFirstToken).toBe(150);
    });
  });

  describe('trackUsage - usage metadata', () => {
    it('includes subscriber info from config.usageMetadata', async () => {
      const service = new ReveniumService({
        ...defaultConfig,
        usageMetadata: { subscriberEmail: 'test@example.com', subscriberId: 'sub-1' },
      });
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata(), undefined, 500, 'claude-sonnet-4-20250514');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.subscriber).toBeDefined();
      expect(body.subscriber.email).toBe('test@example.com');
      expect(body.subscriber.id).toBe('sub-1');
    });

    it('includes traceId from config.usageMetadata', async () => {
      const service = new ReveniumService({
        ...defaultConfig,
        usageMetadata: { traceId: 'trace-abc-123' },
      });
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata(), undefined, 500, 'claude-sonnet-4-20250514');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.traceId).toBe('trace-abc-123');
    });

    it('includes organizationName from config.usageMetadata', async () => {
      const service = new ReveniumService({
        ...defaultConfig,
        usageMetadata: { organizationName: 'Acme Corp' },
      });
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata(), undefined, 500, 'claude-sonnet-4-20250514');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.organizationName).toBe('Acme Corp');
    });
  });

  describe('sendTrackingData', () => {
    it('URL is correct', async () => {
      const service = new ReveniumService(defaultConfig);
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata(), undefined, 500, 'claude-sonnet-4-20250514');

      const url = mockFetch.mock.calls[0][0];
      expect(url).toBe('https://api.revenium.ai/meter/v2/ai/completions');
    });

    it('headers include x-api-key', async () => {
      const service = new ReveniumService(defaultConfig);
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata(), undefined, 500, 'claude-sonnet-4-20250514');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['x-api-key']).toBe('test-revenium-api-key-12345');
    });

    it('headers include User-Agent with n8n-revenium-anthropic-middleware', async () => {
      const service = new ReveniumService(defaultConfig);
      await service.trackUsage([], createMockResult() as any, createMockResponseMetadata(), undefined, 500, 'claude-sonnet-4-20250514');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['User-Agent']).toContain('n8n-revenium-anthropic-middleware');
    });
  });

  describe('fromCredentials', () => {
    it('creates service from credentials', () => {
      const credentials = {
        anthropicApiKey: 'sk-ant-test',
        reveniumApiKey: 'rev-key-123',
        reveniumBaseUrl: 'https://api.revenium.ai',
      };

      const service = ReveniumService.fromCredentials(credentials as any);

      expect(service).toBeInstanceOf(ReveniumService);
    });

    it('maps reveniumApiKey to apiKey', async () => {
      const { setConfig } = await import('../src/utils/summary-printer.js');
      const credentials = {
        anthropicApiKey: 'sk-ant-test',
        reveniumApiKey: 'rev-key-456',
        reveniumBaseUrl: 'https://api.revenium.ai',
      };

      ReveniumService.fromCredentials(credentials as any);

      expect(setConfig).toHaveBeenCalledWith(
        expect.objectContaining({ reveniumApiKey: 'rev-key-456' }),
      );
    });

    it('maps reveniumBaseUrl to baseUrl', async () => {
      const { setConfig } = await import('../src/utils/summary-printer.js');
      const credentials = {
        anthropicApiKey: 'sk-ant-test',
        reveniumApiKey: 'rev-key-789',
        reveniumBaseUrl: 'https://custom.revenium.ai',
      };

      ReveniumService.fromCredentials(credentials as any);

      expect(setConfig).toHaveBeenCalledWith(
        expect.objectContaining({ reveniumBaseUrl: 'https://custom.revenium.ai' }),
      );
    });
  });
});
