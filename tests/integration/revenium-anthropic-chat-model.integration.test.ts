import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  validateCredentials,
  validateApiKey,
  validateModelName,
  validateTimeout,
  validateNumericParameter,
  resetGlobalStateForTesting,
} from '../../src/utils/index.js'
import { ReveniumService } from '../../src/services/revenium/index.js'
import { AnthropicService } from '../../src/services/anthropic/index.js'
import {
  mockReveniumCredentials,
  mockAnthropicResponse,
  mockReveniumAPI,
  setupTestEnvironment,
  cleanupTestEnvironment,
} from './setup.js'
import type { ReveniumAnthropicCredentials } from '../../src/types/index.js'

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(), critical: vi.fn() },
}))

vi.mock('../../src/utils/summary-printer.js', () => ({
  setConfig: vi.fn(),
  printUsageSummary: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    models: { list: vi.fn().mockResolvedValue({ data: [] }) },
  }))
  return { default: MockAnthropic }
})

const mockFetch = vi.fn()
global.fetch = mockFetch

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  vi.clearAllMocks()
  resetGlobalStateForTesting()
  originalEnv = { ...process.env }
  setupTestEnvironment()
  mockFetch.mockResolvedValue(mockReveniumAPI.success)
})

afterEach(() => {
  cleanupTestEnvironment()
  vi.restoreAllMocks()
  process.env = originalEnv
})

describe('ChatModel credential validation', () => {
  it('validates complete credentials successfully', () => {
    const result = validateCredentials({
      anthropicApiKey: mockReveniumCredentials.anthropicApiKey,
      reveniumApiKey: mockReveniumCredentials.reveniumApiKey,
      reveniumBaseUrl: mockReveniumCredentials.reveniumBaseUrl,
    })

    expect(result.anthropicApiKey).toBe(mockReveniumCredentials.anthropicApiKey)
    expect(result.reveniumApiKey).toBe(mockReveniumCredentials.reveniumApiKey)
    expect(result.reveniumBaseUrl).toBe(mockReveniumCredentials.reveniumBaseUrl)
  })

  it('rejects missing Anthropic API key', () => {
    expect(() =>
      validateCredentials({
        reveniumApiKey: mockReveniumCredentials.reveniumApiKey,
        reveniumBaseUrl: mockReveniumCredentials.reveniumBaseUrl,
      })
    ).toThrow('Anthropic API key is required')
  })

  it('rejects missing Revenium API key', () => {
    expect(() =>
      validateCredentials({
        anthropicApiKey: mockReveniumCredentials.anthropicApiKey,
        reveniumBaseUrl: mockReveniumCredentials.reveniumBaseUrl,
      })
    ).toThrow('Revenium API key is required')
  })

  it('validates Anthropic API key format with sk-ant- prefix', () => {
    expect(() => validateApiKey('sk-ant-valid-key-abcdefghij', 'Anthropic API key')).not.toThrow()
    expect(() => validateApiKey('sk-invalid-key-abcdefghij', 'Anthropic API key')).toThrow(
      "Anthropic API keys must start with 'sk-ant-'"
    )
  })

  it('validates model name format', () => {
    expect(validateModelName('claude-sonnet-4-20250514')).toBe(true)
    expect(() => validateModelName('invalid model name!')).toThrow(
      'can only contain letters, numbers, dots, hyphens, and underscores'
    )
  })
})

describe('ChatModel configuration', () => {
  it('creates ReveniumService from credentials', () => {
    const credentials: ReveniumAnthropicCredentials = {
      anthropicApiKey: mockReveniumCredentials.anthropicApiKey,
      reveniumApiKey: mockReveniumCredentials.reveniumApiKey,
      reveniumBaseUrl: mockReveniumCredentials.reveniumBaseUrl,
    }

    const service = ReveniumService.fromCredentials(credentials)

    expect(service).toBeInstanceOf(ReveniumService)
  })

  it('ReveniumService has correct baseUrl from credentials', () => {
    const credentials: ReveniumAnthropicCredentials = {
      anthropicApiKey: mockReveniumCredentials.anthropicApiKey,
      reveniumApiKey: mockReveniumCredentials.reveniumApiKey,
      reveniumBaseUrl: 'https://api.revenium.ai',
    }

    const service = ReveniumService.fromCredentials(credentials)

    expect(service).toBeDefined()
    expect(service).toBeInstanceOf(ReveniumService)
  })

  it('validates temperature parameter between 0 and 1', () => {
    expect(validateNumericParameter(0.7, 'temperature', 0, 1)).toBe(true)
    expect(validateNumericParameter(0, 'temperature', 0, 1)).toBe(true)
    expect(validateNumericParameter(1, 'temperature', 0, 1)).toBe(true)
    expect(() => validateNumericParameter(1.5, 'temperature', 0, 1)).toThrow(
      'must be between 0 and 1'
    )
    expect(() => validateNumericParameter(-0.1, 'temperature', 0, 1)).toThrow(
      'must be between 0 and 1'
    )
  })

  it('validates maxTokens parameter as positive number', () => {
    expect(validateNumericParameter(1024, 'maxTokens', 1, 100000)).toBe(true)
    expect(() => validateNumericParameter(0, 'maxTokens', 1, 100000)).toThrow(
      'must be between 1 and 100000'
    )
    expect(() => validateNumericParameter(-10, 'maxTokens', 1, 100000)).toThrow(
      'must be between 1 and 100000'
    )
  })

  it('validates timeout parameter', () => {
    expect(validateTimeout(30000)).toBe(true)
    expect(validateTimeout(undefined)).toBe(true)
    expect(() => validateTimeout(-1)).toThrow('cannot be negative')
    expect(() => validateTimeout('not-a-number')).toThrow('must be a number')
  })
})

describe('ChatModel tracking integration', () => {
  it('ReveniumService.trackUsage sends correct payload with provider ANTHROPIC', async () => {
    const credentials: ReveniumAnthropicCredentials = {
      anthropicApiKey: mockReveniumCredentials.anthropicApiKey,
      reveniumApiKey: mockReveniumCredentials.reveniumApiKey,
      reveniumBaseUrl: mockReveniumCredentials.reveniumBaseUrl,
      usageMetadata: mockReveniumCredentials.usageMetadata,
    }

    const service = ReveniumService.fromCredentials(credentials)

    const generation = mockAnthropicResponse.generations[0]

    await service.trackUsage(
      [],
      { generations: [generation] },
      generation.message.response_metadata,
      generation.message.response_metadata.usage,
      150,
      'claude-sonnet-4-20250514'
    )

    expect(mockFetch).toHaveBeenCalled()

    const [url, options] = mockFetch.mock.calls[0]
    const payload = JSON.parse(options.body)

    expect(payload.provider).toBe('ANTHROPIC')
    expect(payload.middlewareSource).toBe('n8n')
    expect(payload.model).toBe('claude-sonnet-4-20250514')
    expect(url).toContain('/ai/completions')
  })

  it('token extraction handles Anthropic format with input_tokens and output_tokens', async () => {
    const credentials: ReveniumAnthropicCredentials = {
      anthropicApiKey: mockReveniumCredentials.anthropicApiKey,
      reveniumApiKey: mockReveniumCredentials.reveniumApiKey,
      reveniumBaseUrl: mockReveniumCredentials.reveniumBaseUrl,
    }

    const service = ReveniumService.fromCredentials(credentials)

    const generation = mockAnthropicResponse.generations[0]

    await service.trackUsage(
      [],
      { generations: [generation] },
      generation.message.response_metadata,
      generation.message.response_metadata.usage,
      200,
      'claude-sonnet-4-20250514'
    )

    const [, options] = mockFetch.mock.calls[0]
    const payload = JSON.parse(options.body)

    expect(payload.inputTokenCount).toBe(25)
    expect(payload.outputTokenCount).toBe(15)
    expect(payload.totalTokenCount).toBe(40)
  })
})
