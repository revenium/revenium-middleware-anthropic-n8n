import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  validateCredentials,
  buildSubscriberObject,
  getStopReason,
  getTimeoutConfig,
  resetGlobalStateForTesting,
} from '../../src/utils/index.js'
import { setToolContext, getToolContext, clearToolContext, runWithToolContext } from '../../src/tool-context.js'
import { meterTool, reportToolCall } from '../../src/tool-tracker.js'
import {
  mockReveniumCredentials,
  setupTestEnvironment,
  cleanupTestEnvironment,
} from './setup.js'
import type { UsageMetadata } from '../../src/types/index.js'

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(), critical: vi.fn() }
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
  mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', text: () => Promise.resolve('') })
})

afterEach(() => {
  cleanupTestEnvironment()
  vi.restoreAllMocks()
  process.env = originalEnv
})

describe('Agent execution flow', () => {
  it('validates credentials for agent use', () => {
    const result = validateCredentials(mockReveniumCredentials as unknown as Record<string, unknown>)

    expect(result).toBeDefined()
    expect(result.anthropicApiKey).toBe(mockReveniumCredentials.anthropicApiKey)
    expect(result.reveniumApiKey).toBe(mockReveniumCredentials.reveniumApiKey)
    expect(result.reveniumBaseUrl).toBe(mockReveniumCredentials.reveniumBaseUrl)
  })

  it('tool context persists across agent operations', async () => {
    setToolContext({ workflowId: 'wf-agent-001', agent: 'test-agent' })

    await meterTool('lookup-tool', () => 'result')

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    const [, fetchOptions] = mockFetch.mock.calls[0]
    const payload = JSON.parse(fetchOptions.body)

    expect(payload.workflowId).toBe('wf-agent-001')
    expect(payload.agent).toBe('test-agent')
  })

  it('tool metering tracks execution within agent context', async () => {
    const result = await runWithToolContext(
      { workflowId: 'wf-ctx-002', agent: 'ctx-agent', traceId: 'trace-abc' },
      () => meterTool('context-tool', () => 42)
    )

    expect(result).toBe(42)

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    const [, fetchOptions] = mockFetch.mock.calls[0]
    const payload = JSON.parse(fetchOptions.body)

    expect(payload.workflowId).toBe('wf-ctx-002')
    expect(payload.agent).toBe('ctx-agent')
    expect(payload.traceId).toBe('trace-abc')
  })
})

describe('Agent with memory', () => {
  it('subscriber metadata preserved in agent context', () => {
    const usageMetadata: UsageMetadata = {
      subscriberId: 'sub-agent-123',
      subscriberEmail: 'agent@example.com',
    }

    const subscriber = buildSubscriberObject(usageMetadata)

    expect(subscriber).toBeDefined()
    expect(subscriber!.id).toBe('sub-agent-123')
    expect(subscriber!.email).toBe('agent@example.com')
  })

  it('stop reason mapping for agent tool calls', () => {
    expect(getStopReason('tool_use')).toBe('END')
    expect(getStopReason('end_turn')).toBe('END')
  })
})

describe('Agent with tools', () => {
  it('meterTool tracks tool execution success', async () => {
    const result = await meterTool('success-tool', () => ({ value: 'ok' }))

    expect(result).toEqual({ value: 'ok' })

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    const [, fetchOptions] = mockFetch.mock.calls[0]
    const payload = JSON.parse(fetchOptions.body)

    expect(payload.success).toBe(true)
    expect(payload.toolId).toBe('success-tool')
    expect(payload.errorMessage).toBeUndefined()
  })

  it('meterTool tracks tool execution failure', async () => {
    await expect(
      meterTool('failing-tool', () => { throw new Error('tool broke') })
    ).rejects.toThrow('tool broke')

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    const [, fetchOptions] = mockFetch.mock.calls[0]
    const payload = JSON.parse(fetchOptions.body)

    expect(payload.success).toBe(false)
    expect(payload.errorMessage).toBe('tool broke')
    expect(payload.toolId).toBe('failing-tool')
  })

  it('reportToolCall sends manual tool report', async () => {
    reportToolCall('manual-tool', {
      durationMs: 150,
      success: true,
      operation: 'search',
      agent: 'report-agent',
      workflowId: 'wf-report-001',
    })

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    const [url, fetchOptions] = mockFetch.mock.calls[0]
    const payload = JSON.parse(fetchOptions.body)

    expect(url).toContain('/tool/events')
    expect(payload.toolId).toBe('manual-tool')
    expect(payload.durationMs).toBe(150)
    expect(payload.success).toBe(true)
    expect(payload.operation).toBe('search')
    expect(payload.agent).toBe('report-agent')
    expect(payload.workflowId).toBe('wf-report-001')
  })
})

describe('Agent error handling', () => {
  it('agent continues when tracking fails', async () => {
    delete process.env.REVENIUM_METERING_API_KEY

    const result = await meterTool('resilient-tool', () => 'still works')

    expect(result).toBe('still works')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
