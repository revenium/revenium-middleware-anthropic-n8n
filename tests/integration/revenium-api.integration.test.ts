import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ReveniumService } from '../../src/services/revenium/index.js'
import { buildReveniumUrl } from '../../src/utils/url-builder.js'
import {
  mockReveniumCredentials,
  mockReveniumAPI,
  mockAnthropicResponse,
} from './setup.js'

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(), critical: vi.fn() }
}))

vi.mock('../../src/utils/summary-printer.js', () => ({
  setConfig: vi.fn(),
  printUsageSummary: vi.fn(),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

const createService = (overrides?: Record<string, unknown>) => new ReveniumService({
  apiKey: mockReveniumCredentials.reveniumApiKey,
  baseUrl: mockReveniumCredentials.reveniumBaseUrl,
  usageMetadata: mockReveniumCredentials.usageMetadata as Record<string, unknown>,
  ...overrides,
})

const callTrackUsage = async (service: ReveniumService) => {
  const result = mockAnthropicResponse as any
  const responseMetadata = result.generations[0].message.response_metadata
  const usageMetadata = responseMetadata.usage
  return service.trackUsage(
    [],
    result,
    responseMetadata,
    usageMetadata,
    1500,
    'claude-sonnet-4-20250514',
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockResolvedValue(mockReveniumAPI.success)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('API payload structure', () => {
  it('sends correct payload fields', async () => {
    const service = createService()
    await callTrackUsage(service)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)

    expect(body.provider).toBe('ANTHROPIC')
    expect(body.middlewareSource).toBe('n8n')
    expect(body.costType).toBe('AI')
    expect(body.operationType).toBe('CHAT')
  })

  it('includes token counts from Anthropic format', async () => {
    const service = createService()
    await callTrackUsage(service)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)

    expect(body.inputTokenCount).toBe(25)
    expect(body.outputTokenCount).toBe(15)
    expect(body.totalTokenCount).toBe(40)
  })

  it('includes stop reason mapping', async () => {
    const service = createService()
    await callTrackUsage(service)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)

    expect(body.stopReason).toBe('END')
  })

  it('includes subscriber data', async () => {
    const service = createService()
    await callTrackUsage(service)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)

    expect(body.subscriber).toBeDefined()
    expect(body.subscriber.id).toBe(mockReveniumCredentials.usageMetadata.subscriberId)
    expect(body.subscriber.email).toBe(mockReveniumCredentials.usageMetadata.subscriberEmail)
  })

  it('includes trace and organization metadata', async () => {
    const service = createService()
    await callTrackUsage(service)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)

    expect(body.traceId).toBe(mockReveniumCredentials.usageMetadata.traceId)
    expect(body.organizationName).toBe(mockReveniumCredentials.usageMetadata.organizationName)
    expect(body.productName).toBe(mockReveniumCredentials.usageMetadata.productName)
  })
})

describe('API headers', () => {
  it('sends correct headers', async () => {
    const service = createService()
    await callTrackUsage(service)

    const headers = mockFetch.mock.calls[0][1].headers

    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Accept']).toBe('application/json')
    expect(headers['x-api-key']).toBe(mockReveniumCredentials.reveniumApiKey)
    expect(headers['User-Agent']).toMatch(/n8n-revenium-anthropic-middleware/)
  })

  it('API URL is correctly built', async () => {
    const service = createService()
    await callTrackUsage(service)

    const url = mockFetch.mock.calls[0][0] as string

    expect(url).toMatch(/\/meter\/v2\/ai\/completions$/)
  })
})

describe('API error handling', () => {
  it('handles 400 Bad Request', async () => {
    mockFetch.mockResolvedValue(mockReveniumAPI.error400)
    const service = createService()

    await expect(callTrackUsage(service)).rejects.toThrow()
    await expect(callTrackUsage(service)).rejects.toMatchObject({
      cause: expect.objectContaining({ code: 'API_ERROR' }),
    })
  })

  it('handles 401 Unauthorized', async () => {
    mockFetch.mockResolvedValue(mockReveniumAPI.error401)
    const service = createService()

    await expect(callTrackUsage(service)).rejects.toThrow()
  })

  it('handles 429 Rate Limit', async () => {
    mockFetch.mockResolvedValue(mockReveniumAPI.error429)
    const service = createService()

    await expect(callTrackUsage(service)).rejects.toThrow()
  })

  it('handles 500 Server Error', async () => {
    mockFetch.mockResolvedValue(mockReveniumAPI.error500)
    const service = createService()

    await expect(callTrackUsage(service)).rejects.toThrow()
  })

  it('handles network timeout', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    mockFetch.mockRejectedValue(abortError)
    const service = createService()

    await expect(callTrackUsage(service)).rejects.toThrow()
  })
})

describe('API URL building', () => {
  it('builds correct URL for different base URLs', () => {
    const fromBase = buildReveniumUrl('https://api.revenium.ai', '/ai/completions')
    const fromMeterV2 = buildReveniumUrl('https://api.revenium.ai/meter/v2', '/ai/completions')

    expect(fromBase).toBe('https://api.revenium.ai/meter/v2/ai/completions')
    expect(fromMeterV2).toBe('https://api.revenium.ai/meter/v2/ai/completions')
    expect(fromBase).toBe(fromMeterV2)
  })
})
