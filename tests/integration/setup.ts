import { vi } from 'vitest'
import { buildReveniumUrl } from '../../src/utils/url-builder.js'

export const mockAnthropicResponse = {
  generations: [{
    text: 'Test response from Claude',
    message: {
      content: 'Test response from Claude',
      id: 'msg_test_12345',
      response_metadata: {
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 25,
          output_tokens: 15,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
      usage_metadata: {
        input_tokens: 25,
        output_tokens: 15,
        total_tokens: 40,
      },
    },
  }],
}

export const mockStreamingResponse = {
  chunks: [
    { text: 'Hello', generationInfo: {} },
    { text: ' world', generationInfo: {} },
    {
      text: '!',
      generationInfo: {
        response_metadata: {
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
        usage_metadata: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
        },
      },
    },
  ],
}

export const mockReveniumCredentials = {
  anthropicApiKey: 'sk-ant-test-key-abcdefghijklmnop1234567890',
  reveniumApiKey: 'rev-test-api-key-abcdefghij1234567890',
  reveniumBaseUrl: 'https://api.revenium.ai',
  anthropicBaseUrl: 'https://api.anthropic.com',
  printSummary: false as boolean | 'human' | 'json',
  teamId: 'team-test-123',
  usageMetadata: {
    traceId: 'trace-integration-test',
    subscriberId: 'sub-123',
    subscriberEmail: 'test@example.com',
    organizationName: 'TestOrg',
    productName: 'TestProduct',
  },
}

export const mockReveniumAPI = {
  success: {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ id: 'resp-integration-123', status: 'ok' }),
    text: () => Promise.resolve(''),
    headers: new Headers({ 'content-type': 'application/json' }),
  },
  error400: {
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    json: () => Promise.resolve({ error: 'Invalid payload' }),
    text: () => Promise.resolve('Invalid payload'),
    headers: new Headers({ 'content-type': 'application/json' }),
  },
  error401: {
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    json: () => Promise.resolve({ error: 'Invalid API key' }),
    text: () => Promise.resolve('Invalid API key'),
    headers: new Headers({ 'content-type': 'application/json' }),
  },
  error429: {
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
    json: () => Promise.resolve({ error: 'Rate limited' }),
    text: () => Promise.resolve('Rate limited'),
    headers: new Headers({ 'content-type': 'application/json' }),
  },
  error500: {
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    json: () => Promise.resolve({ error: 'Server error' }),
    text: () => Promise.resolve('Server error'),
    headers: new Headers({ 'content-type': 'application/json' }),
  },
  timeout: () => new Promise((_, reject) =>
    setTimeout(() => reject(new Error('AbortError: The operation was aborted')), 100)
  ),
}

export function createMockExecuteFunctions() {
  return {
    getInputData: vi.fn().mockReturnValue([{ json: { prompt: 'Test prompt' } }]),
    getNodeParameter: vi.fn().mockImplementation((param: string) => {
      const defaults: Record<string, unknown> = {
        prompt: 'Test prompt',
        model: 'claude-sonnet-4-20250514',
        temperature: 0.7,
        maxTokens: 1024,
        systemMessage: '',
        options: {},
      }
      return defaults[param] ?? ''
    }),
    getNode: vi.fn().mockReturnValue({ name: 'TestNode', type: 'test' }),
    getCredentials: vi.fn().mockResolvedValue(mockReveniumCredentials),
    helpers: {
      returnJsonArray: vi.fn().mockImplementation((data: unknown[]) => data.map(item => ({ json: item }))),
    },
    getInputConnectionData: vi.fn(),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }
}

export function createMockSupplyDataFunctions() {
  return {
    getNode: vi.fn().mockReturnValue({ name: 'TestChatModel', type: 'test' }),
    getNodeParameter: vi.fn().mockImplementation((param: string) => {
      const defaults: Record<string, unknown> = {
        model: 'claude-sonnet-4-20250514',
        options: {
          temperature: 0.7,
          maxTokensToSample: 1024,
        },
      }
      return defaults[param] ?? ''
    }),
    getCredentials: vi.fn().mockResolvedValue(mockReveniumCredentials),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }
}

export function setupFetchMock(mockFetch: ReturnType<typeof vi.fn>) {
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/ai/completions')) {
      return Promise.resolve(mockReveniumAPI.success)
    }
    if (typeof url === 'string' && url.includes('/tool/events')) {
      return Promise.resolve(mockReveniumAPI.success)
    }
    return Promise.resolve(mockReveniumAPI.success)
  })
}

export function resetMocks(mockFetch: ReturnType<typeof vi.fn>) {
  vi.clearAllMocks()
  setupFetchMock(mockFetch)
}

export function setupTestEnvironment() {
  process.env.REVENIUM_LOG_LEVEL = 'debug'
  process.env.REVENIUM_METERING_API_KEY = mockReveniumCredentials.reveniumApiKey
  process.env.REVENIUM_METERING_BASE_URL = mockReveniumCredentials.reveniumBaseUrl
}

export function cleanupTestEnvironment() {
  delete process.env.REVENIUM_LOG_LEVEL
  delete process.env.REVENIUM_METERING_API_KEY
  delete process.env.REVENIUM_METERING_BASE_URL
}

export async function sendToReveniumAPI(
  payload: Record<string, unknown>,
  mockFetch: ReturnType<typeof vi.fn>
): Promise<Response> {
  const url = buildReveniumUrl(mockReveniumCredentials.reveniumBaseUrl, '/ai/completions')
  return mockFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-key': mockReveniumCredentials.reveniumApiKey,
    },
    body: JSON.stringify(payload),
  })
}
