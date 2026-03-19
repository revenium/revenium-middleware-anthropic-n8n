import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CreateCompletionRequest } from '../src/types/index.js';

vi.mock('../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(), critical: vi.fn() },
}));

const originalFetch = global.fetch;
const mockFetch = vi.fn();

const createTestPayload = (overrides?: Partial<CreateCompletionRequest>): CreateCompletionRequest => ({
  stopReason: 'END',
  costType: 'AI',
  isStreamed: false,
  operationType: 'CHAT',
  inputTokenCount: 100,
  outputTokenCount: 50,
  reasoningTokenCount: 0,
  cacheCreationTokenCount: 0,
  cacheReadTokenCount: 0,
  totalTokenCount: 150,
  model: 'claude-sonnet-4-20250514',
  transactionId: 'tx-test-123',
  responseTime: new Date().toISOString(),
  requestDuration: 1500,
  provider: 'ANTHROPIC',
  requestTime: new Date().toISOString(),
  completionStartTime: new Date().toISOString(),
  timeToFirstToken: 200,
  middlewareSource: 'n8n',
  ...overrides,
});

describe('Summary Printer', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let setConfig: typeof import('../src/utils/summary-printer.js').setConfig;
  let printUsageSummary: typeof import('../src/utils/summary-printer.js').printUsageSummary;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockFetch.mockReset();
    (global as any).fetch = mockFetch;

    const summaryPrinter = await import('../src/utils/summary-printer.js');
    setConfig = summaryPrinter.setConfig;
    printUsageSummary = summaryPrinter.printUsageSummary;
    setConfig(null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe('printUsageSummary - no config', () => {
    it('does nothing when config is null', () => {
      setConfig(null);
      printUsageSummary(createTestPayload());
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('console.log is not called with null config', () => {
      printUsageSummary(createTestPayload());
      expect(consoleSpy).toHaveBeenCalledTimes(0);
    });
  });

  describe('printUsageSummary - disabled', () => {
    it('does nothing when printSummary is false', () => {
      setConfig({ printSummary: false });
      printUsageSummary(createTestPayload());
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('does nothing when printSummary is undefined', () => {
      setConfig({});
      printUsageSummary(createTestPayload());
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('printUsageSummary - human format', () => {
    it('uses human format when printSummary is true', () => {
      setConfig({ printSummary: true });
      printUsageSummary(createTestPayload());

      const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('REVENIUM USAGE SUMMARY');
    });

    it('includes model name in output', () => {
      setConfig({ printSummary: true });
      printUsageSummary(createTestPayload());

      const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('claude-sonnet-4-20250514');
    });

    it('includes Provider: ANTHROPIC in output', () => {
      setConfig({ printSummary: true });
      printUsageSummary(createTestPayload());

      const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Provider: ANTHROPIC');
    });

    it('includes token counts in output', () => {
      setConfig({ printSummary: true });
      printUsageSummary(createTestPayload());

      const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('100');
      expect(output).toContain('50');
      expect(output).toContain('150');
    });
  });

  describe('printUsageSummary - json format', () => {
    it('outputs valid JSON when printSummary is json', () => {
      setConfig({ printSummary: 'json' });
      printUsageSummary(createTestPayload());

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0];
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('parsed JSON contains expected fields', () => {
      setConfig({ printSummary: 'json' });
      printUsageSummary(createTestPayload());

      const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(parsed.model).toBe('claude-sonnet-4-20250514');
      expect(parsed.provider).toBe('ANTHROPIC');
      expect(parsed.durationSeconds).toBe(1.5);
      expect(parsed.inputTokenCount).toBe(100);
      expect(parsed.outputTokenCount).toBe(50);
      expect(parsed.totalTokenCount).toBe(150);
    });
  });

  describe('printUsageSummary - with teamId (fetches metrics)', () => {
    it('fetches metrics and includes cost in human summary', async () => {
      setConfig({
        printSummary: 'human',
        teamId: 'team-1',
        reveniumApiKey: 'key-123',
        reveniumBaseUrl: 'https://api.test.io',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            _embedded: {
              aICompletionMetricResourceList: [{ totalCost: 0.005 }],
            },
          }),
        text: () => Promise.resolve(''),
      });

      printUsageSummary(createTestPayload());

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('$0.005000');
    });

    it('fetches metrics and includes cost in json summary', async () => {
      setConfig({
        printSummary: 'json',
        teamId: 'team-1',
        reveniumApiKey: 'key-123',
        reveniumBaseUrl: 'https://api.test.io',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            _embedded: {
              aICompletionMetricResourceList: [{ totalCost: 0.005 }],
            },
          }),
        text: () => Promise.resolve(''),
      });

      printUsageSummary(createTestPayload());

      await new Promise(resolve => setTimeout(resolve, 50));

      const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(parsed.cost).toBe(0.005);
      expect(parsed.costStatus).toBeUndefined();
    });
  });

  describe('printUsageSummary - fetch failure', () => {
    it('still prints summary without cost when fetch rejects', async () => {
      vi.useFakeTimers();

      setConfig({
        printSummary: 'human',
        teamId: 'team-1',
        reveniumApiKey: 'key-123',
        reveniumBaseUrl: 'https://api.test.io',
      });

      mockFetch.mockRejectedValue(new Error('Network failure'));

      printUsageSummary(createTestPayload());

      await vi.advanceTimersByTimeAsync(10000);

      const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('REVENIUM USAGE SUMMARY');

      vi.useRealTimers();
    });
  });

  describe('printUsageSummary - traceId included', () => {
    it('shows traceId in human format output', () => {
      setConfig({ printSummary: 'human' });
      printUsageSummary(createTestPayload({ traceId: 'trace-abc-456' }));

      const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('trace-abc-456');
    });

    it('includes traceId in json format output', () => {
      setConfig({ printSummary: 'json' });
      printUsageSummary(createTestPayload({ traceId: 'trace-abc-456' }));

      const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(parsed.traceId).toBe('trace-abc-456');
    });
  });

  describe('printUsageSummary - human format cost status messages', () => {
    it('shows REVENIUM_TEAM_ID hint when teamId is not set', () => {
      setConfig({ printSummary: true });
      printUsageSummary(createTestPayload());

      const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Set REVENIUM_TEAM_ID in .env to see pricing');
    });

    it('shows pending aggregation when teamId is set but no cost returned', async () => {
      vi.useFakeTimers();

      setConfig({
        printSummary: 'human',
        teamId: 'team-1',
        reveniumApiKey: 'key-123',
        reveniumBaseUrl: 'https://api.test.io',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            _embedded: {
              aICompletionMetricResourceList: [],
            },
          }),
        text: () => Promise.resolve(''),
      });

      printUsageSummary(createTestPayload());

      await vi.advanceTimersByTimeAsync(10000);

      const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('pending aggregation');

      vi.useRealTimers();
    });
  });
});
