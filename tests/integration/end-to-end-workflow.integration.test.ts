import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ReveniumService } from '../../src/services/revenium/index.js'
import {
  validateCredentials,
  buildSubscriberObject,
  getStopReason,
  resetGlobalStateForTesting,
} from '../../src/utils/index.js'
import { setToolContext, clearToolContext, runWithToolContext } from '../../src/tool-context.js'
import { meterTool } from '../../src/tool-tracker.js'
import {
  mockReveniumCredentials,
  mockReveniumAPI,
  mockAnthropicResponse,
  setupTestEnvironment,
  cleanupTestEnvironment,
} from './setup.js'

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(), critical: vi.fn() },
}))

vi.mock('../../src/utils/summary-printer.js', () => ({
  setConfig: vi.fn(),
  printUsageSummary: vi.fn(),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch
let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  vi.clearAllMocks()
  clearToolContext()
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

describe('End-to-end workflow', () => {
  it('complete workflow: validate -> track -> verify payload', async () => {
    const credentials = validateCredentials(mockReveniumCredentials)
    const service = new ReveniumService({
      apiKey: credentials.reveniumApiKey,
      baseUrl: credentials.reveniumBaseUrl,
      usageMetadata: mockReveniumCredentials.usageMetadata,
    })

    const generation = mockAnthropicResponse.generations[0]
    const responseMetadata = generation.message.response_metadata
    const usageMetadata = generation.message.usage_metadata

    await service.trackUsage(
      [],
      mockAnthropicResponse as any,
      responseMetadata as any,
      usageMetadata,
      150,
      'claude-sonnet-4-20250514',
    )

    expect(mockFetch).toHaveBeenCalled()

    const [, fetchOptions] = mockFetch.mock.calls[0]
    const payload = JSON.parse(fetchOptions.body)

    expect(payload.provider).toBe('ANTHROPIC')
    expect(payload.inputTokenCount).toBe(25)
    expect(payload.outputTokenCount).toBe(15)
    expect(payload.totalTokenCount).toBe(40)
    expect(payload.subscriber).toBeDefined()
    expect(payload.subscriber.id).toBe('sub-123')
    expect(payload.subscriber.email).toBe('test@example.com')
    expect(payload.traceId).toBe('trace-integration-test')
  })

  it('workflow with tool metering', async () => {
    setToolContext({ workflowId: 'wf-e2e-001', agent: 'test-agent' })

    const result = await meterTool('lookup-tool', async () => ({ result: 'data' }))

    expect(result).toEqual({ result: 'data' })

    await new Promise<void>(resolve => setImmediate(resolve))

    const toolEventCall = mockFetch.mock.calls.find(([url]: [string]) =>
      typeof url === 'string' && url.includes('/tool/events'),
    )

    expect(toolEventCall).toBeDefined()

    const toolPayload = JSON.parse(toolEventCall![1].body)

    expect(toolPayload.middlewareSource).toBe('revenium-anthropic-n8n')
    expect(toolPayload.workflowId).toBe('wf-e2e-001')
    expect(toolPayload.agent).toBe('test-agent')
    expect(toolPayload.toolId).toBe('lookup-tool')
    expect(toolPayload.success).toBe(true)
  })

  it('workflow with subscriber tracking', async () => {
    const credentials = validateCredentials(mockReveniumCredentials)
    const service = new ReveniumService({
      apiKey: credentials.reveniumApiKey,
      baseUrl: credentials.reveniumBaseUrl,
      usageMetadata: {
        subscriberId: 'subscriber-42',
        subscriberEmail: 'user@corp.com',
      },
    })

    const generation = mockAnthropicResponse.generations[0]

    await service.trackUsage(
      [],
      mockAnthropicResponse as any,
      generation.message.response_metadata as any,
      generation.message.usage_metadata,
      100,
      'claude-sonnet-4-20250514',
    )

    const [, fetchOptions] = mockFetch.mock.calls[0]
    const payload = JSON.parse(fetchOptions.body)

    expect(payload.subscriber).toBeDefined()
    expect(payload.subscriber.id).toBe('subscriber-42')
    expect(payload.subscriber.email).toBe('user@corp.com')
  })

  it('workflow handles multiple stop reasons', async () => {
    const stopReasonMap: Array<[string, string]> = [
      ['end_turn', 'END'],
      ['max_tokens', 'TOKEN_LIMIT'],
      ['tool_use', 'END'],
    ]

    for (const [anthropicReason, expectedStop] of stopReasonMap) {
      vi.clearAllMocks()
      mockFetch.mockResolvedValue(mockReveniumAPI.success)

      const credentials = validateCredentials(mockReveniumCredentials)
      const service = ReveniumService.fromCredentials(credentials)

      const response = structuredClone(mockAnthropicResponse)
      response.generations[0].message.response_metadata.stop_reason = anthropicReason

      await service.trackUsage(
        [],
        response as any,
        response.generations[0].message.response_metadata as any,
        response.generations[0].message.usage_metadata,
        100,
        'claude-sonnet-4-20250514',
      )

      const [, fetchOptions] = mockFetch.mock.calls[0]
      const payload = JSON.parse(fetchOptions.body)

      expect(payload.stopReason).toBe(expectedStop)
    }
  })

  it('workflow resilient to tracking failures', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValue(mockReveniumAPI.success)

    const credentials = validateCredentials(mockReveniumCredentials)
    const service = ReveniumService.fromCredentials(credentials)

    const generation = mockAnthropicResponse.generations[0]

    await expect(
      service.trackUsage(
        [],
        mockAnthropicResponse as any,
        generation.message.response_metadata as any,
        generation.message.usage_metadata,
        100,
        'claude-sonnet-4-20250514',
      ),
    ).rejects.toThrow()

    const toolResult = await meterTool('resilient-tool', async () => ({ status: 'ok' }))

    expect(toolResult).toEqual({ status: 'ok' })
  })
})
