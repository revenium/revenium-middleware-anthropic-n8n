import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    models: {
      list: vi.fn(),
    },
  }));
  return { default: MockAnthropic };
});

vi.mock('../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(), critical: vi.fn() },
}));

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicService } from '../src/services/anthropic/index.js';
import { FALLBACK_MODELS } from '../src/constants/constants.js';

const MockAnthropic = vi.mocked(Anthropic);

function getMockClient() {
  const lastCall = MockAnthropic.mock.results[MockAnthropic.mock.results.length - 1];
  return lastCall?.value as { models: { list: ReturnType<typeof vi.fn> } };
}

describe('AnthropicService', () => {
  const defaultConfig = {
    apiKey: 'sk-ant-test-key-1234567890abcdef',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('creates instance with config', () => {
      const service = new AnthropicService(defaultConfig);
      expect(service).toBeInstanceOf(AnthropicService);
      expect(MockAnthropic).toHaveBeenCalledOnce();
    });

    it('uses default baseURL when not provided', () => {
      new AnthropicService(defaultConfig);
      expect(MockAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: defaultConfig.apiKey,
          baseURL: 'https://api.anthropic.com',
        }),
      );
    });
  });

  describe('getModels', () => {
    it('returns formatted models from API', async () => {
      const service = new AnthropicService(defaultConfig);
      const mockClient = getMockClient();
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'claude-opus-4-20250514', type: 'model' },
          { id: 'claude-sonnet-4-20250514', type: 'model' },
        ],
      });

      const models = await service.getModels();

      expect(models.length).toBe(2);
      expect(models[0]!.value).toBe('claude-opus-4-20250514');
      expect(models[0]!.name).toBe('Claude Opus 4');
    });

    it('filters to chat models only', async () => {
      const service = new AnthropicService(defaultConfig);
      const mockClient = getMockClient();
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'claude-opus-4-20250514', type: 'model' },
          { id: 'claude-sonnet-4-20250514', type: 'model' },
          { id: 'claude-haiku-4-20250514', type: 'model' },
          { id: 'claude-3-5-sonnet-20241022', type: 'model' },
          { id: 'claude-2.1', type: 'model' },
          { id: 'embedding-model-v1', type: 'model' },
          { id: 'text-search-v2', type: 'model' },
        ],
      });

      const models = await service.getModels();

      const modelIds = models.map(m => m.value);
      expect(modelIds).toContain('claude-opus-4-20250514');
      expect(modelIds).toContain('claude-sonnet-4-20250514');
      expect(modelIds).toContain('claude-haiku-4-20250514');
      expect(modelIds).toContain('claude-3-5-sonnet-20241022');
      expect(modelIds).toContain('claude-2.1');
      expect(modelIds).not.toContain('embedding-model-v1');
      expect(modelIds).not.toContain('text-search-v2');
    });

    it('sorts by priority with opus first then sonnet then haiku', async () => {
      const service = new AnthropicService(defaultConfig);
      const mockClient = getMockClient();
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'claude-haiku-4-20250514', type: 'model' },
          { id: 'claude-sonnet-4-20250514', type: 'model' },
          { id: 'claude-opus-4-20250514', type: 'model' },
        ],
      });

      const models = await service.getModels();

      expect(models[0]!.value).toBe('claude-opus-4-20250514');
      expect(models[1]!.value).toBe('claude-sonnet-4-20250514');
      expect(models[2]!.value).toBe('claude-haiku-4-20250514');
    });

    it('returns fallback models when API fails', async () => {
      const service = new AnthropicService(defaultConfig);
      const mockClient = getMockClient();
      mockClient.models.list.mockRejectedValue(new Error('API connection failed'));

      const models = await service.getModels();

      expect(models).toEqual(FALLBACK_MODELS);
    });

    it('returns fallback models when API returns empty data', async () => {
      const service = new AnthropicService(defaultConfig);
      const mockClient = getMockClient();
      mockClient.models.list.mockResolvedValue({ data: [] });

      const models = await service.getModels();

      expect(models).toEqual(FALLBACK_MODELS);
    });

    it('returns fallback models when API returns invalid data', async () => {
      const service = new AnthropicService(defaultConfig);
      const mockClient = getMockClient();
      mockClient.models.list.mockResolvedValue({ data: null });

      const models = await service.getModels();

      expect(models).toEqual(FALLBACK_MODELS);
    });

    it('formats known model names correctly', async () => {
      const service = new AnthropicService(defaultConfig);
      const mockClient = getMockClient();
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'claude-opus-4-20250514', type: 'model' },
          { id: 'claude-3-5-sonnet-20241022', type: 'model' },
          { id: 'claude-3-haiku-20240307', type: 'model' },
        ],
      });

      const models = await service.getModels();

      const nameMap = Object.fromEntries(models.map(m => [m.value, m.name]));
      expect(nameMap['claude-opus-4-20250514']).toBe('Claude Opus 4');
      expect(nameMap['claude-3-5-sonnet-20241022']).toBe('Claude 3.5 Sonnet');
      expect(nameMap['claude-3-haiku-20240307']).toBe('Claude 3 Haiku');
    });

    it('returns modelId as-is for unknown models', async () => {
      const service = new AnthropicService(defaultConfig);
      const mockClient = getMockClient();
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'claude-3-future-20260101', type: 'model' }],
      });

      const models = await service.getModels();

      expect(models[0]!.name).toBe('claude-3-future-20260101');
    });
  });

  describe('isChatModel (via getModels filtering)', () => {
    it('includes claude-opus-4-20250514', async () => {
      const service = new AnthropicService(defaultConfig);
      const mockClient = getMockClient();
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'claude-opus-4-20250514', type: 'model' }],
      });

      const models = await service.getModels();

      expect(models.map(m => m.value)).toContain('claude-opus-4-20250514');
    });

    it('includes claude-sonnet-4-20250514', async () => {
      const service = new AnthropicService(defaultConfig);
      const mockClient = getMockClient();
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'claude-sonnet-4-20250514', type: 'model' }],
      });

      const models = await service.getModels();

      expect(models.map(m => m.value)).toContain('claude-sonnet-4-20250514');
    });

    it('includes claude-3-5-sonnet-20241022', async () => {
      const service = new AnthropicService(defaultConfig);
      const mockClient = getMockClient();
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'claude-3-5-sonnet-20241022', type: 'model' }],
      });

      const models = await service.getModels();

      expect(models.map(m => m.value)).toContain('claude-3-5-sonnet-20241022');
    });

    it('excludes non-claude models', async () => {
      const service = new AnthropicService(defaultConfig);
      const mockClient = getMockClient();
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'gpt-4', type: 'model' },
          { id: 'embedding-v1', type: 'model' },
        ],
      });

      const models = await service.getModels();

      expect(models).toEqual(FALLBACK_MODELS);
    });
  });

  describe('getModelPriority (via sort order)', () => {
    it('sorts claude-opus-4 models first', async () => {
      const service = new AnthropicService(defaultConfig);
      const mockClient = getMockClient();
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'claude-3-haiku-20240307', type: 'model' },
          { id: 'claude-opus-4-20250514', type: 'model' },
          { id: 'claude-3-5-sonnet-20241022', type: 'model' },
        ],
      });

      const models = await service.getModels();

      expect(models[0]!.value).toBe('claude-opus-4-20250514');
    });

    it('sorts unknown models last', async () => {
      const service = new AnthropicService(defaultConfig);
      const mockClient = getMockClient();
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'claude-3-unknown-20260101', type: 'model' },
          { id: 'claude-opus-4-20250514', type: 'model' },
        ],
      });

      const models = await service.getModels();

      expect(models[models.length - 1]!.value).toBe('claude-3-unknown-20260101');
    });
  });

  describe('validateModel', () => {
    it('returns true for valid model names', () => {
      const service = new AnthropicService(defaultConfig);
      expect(service.validateModel('claude-sonnet-4-20250514')).toBe(true);
    });

    it('throws for invalid model names', () => {
      const service = new AnthropicService(defaultConfig);
      expect(() => service.validateModel('')).toThrow();
    });
  });

  describe('fromCredentials', () => {
    it('creates service from credentials object', () => {
      const credentials = {
        anthropicApiKey: 'sk-ant-cred-key-1234567890abcdef',
        reveniumApiKey: 'rev_1234567890abcdef',
        reveniumBaseUrl: 'https://api.revenium.ai',
      };

      const service = AnthropicService.fromCredentials(credentials as any);

      expect(service).toBeInstanceOf(AnthropicService);
    });

    it('uses anthropicApiKey and anthropicBaseUrl from credentials', () => {
      const credentials = {
        anthropicApiKey: 'sk-ant-cred-key-1234567890abcdef',
        anthropicBaseUrl: 'https://api.anthropic.com',
        reveniumApiKey: 'rev_1234567890abcdef',
        reveniumBaseUrl: 'https://api.revenium.ai',
      };

      AnthropicService.fromCredentials(credentials as any);

      expect(MockAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: credentials.anthropicApiKey,
          baseURL: credentials.anthropicBaseUrl,
        }),
      );
    });
  });
});
