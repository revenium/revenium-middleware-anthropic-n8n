import {
  DEFAULT_BATCH_CONFIG,
  reveniumCircuitBreaker,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_RATE_LIMIT_CONFIG,
  rateLimitState,
  ANTHROPIC_STOP_REASON_MAP,
} from '../constants/constants.js';
import {
  MODEL_INVOCATION_TIMEOUT,
  TOOL_EXECUTION_TIMEOUT,
  STREAM_TIMEOUT,
  API_TIMEOUT,
  getTimeoutFromEnv,
} from '../constants/timeouts.js';
import type {
  AnthropicFinishReason,
  ReveniumStopReason,
  CreateCompletionRequest,
  CreateCompletionResponse,
  UsageMetadata,
  ReveniumConfig,
  ReveniumAnthropicCredentials,
  SubscriberInfo,
  BatchedRequest,
  CircuitBreakerConfig,
  RateLimitConfig,
} from '../types/index.js';

import { logger } from './logger.js';

export {
  extractPrompts,
  shouldCapturePrompts,
  sanitizeCredentials,
  getMaxPromptSize,
  type PromptData,
} from './prompt-extraction.js';

export interface TimeoutConfig {
  modelInvocation: number;
  toolExecution: number;
  streamTimeout: number;
  apiTimeout: number;
}

export function getTimeoutConfig(): TimeoutConfig {
  return {
    modelInvocation: getTimeoutFromEnv(
      'REVENIUM_MODEL_TIMEOUT',
      MODEL_INVOCATION_TIMEOUT
    ),
    toolExecution: getTimeoutFromEnv(
      'REVENIUM_TOOL_TIMEOUT',
      TOOL_EXECUTION_TIMEOUT
    ),
    streamTimeout: getTimeoutFromEnv('REVENIUM_STREAM_TIMEOUT', STREAM_TIMEOUT),
    apiTimeout: getTimeoutFromEnv('REVENIUM_API_TIMEOUT', API_TIMEOUT),
  };
}

export function generateCorrelationId(): string {
  return `revenium-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

let batchQueue: BatchedRequest[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let isProcessingBatch = false;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldAllowRequest(config: CircuitBreakerConfig): boolean {
  const now = Date.now();

  switch (reveniumCircuitBreaker.state) {
    case 'CLOSED':
      return true;
    case 'OPEN':
      if (
        now - reveniumCircuitBreaker.lastFailureTime >
        config.recoveryTimeoutMs
      ) {
        reveniumCircuitBreaker.state = 'HALF_OPEN';
        return true;
      }
      return false;
    case 'HALF_OPEN':
      return true;
    default:
      return true;
  }
}

function recordSuccess(): void {
  reveniumCircuitBreaker.failures = 0;
  reveniumCircuitBreaker.state = 'CLOSED';
}

function recordFailure(config: CircuitBreakerConfig): void {
  reveniumCircuitBreaker.failures++;
  reveniumCircuitBreaker.lastFailureTime = Date.now();

  if (reveniumCircuitBreaker.failures >= config.failureThreshold) {
    reveniumCircuitBreaker.state = 'OPEN';
    logger.warning(
      'Revenium API circuit breaker opened due to %d failures',
      reveniumCircuitBreaker.failures
    );
  }
}

async function processBatch(): Promise<void> {
  if (isProcessingBatch || batchQueue.length === 0) return;

  isProcessingBatch = true;
  const currentBatch = [...batchQueue];
  batchQueue = [];

  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }

  logger.debug('Processing batch of %d Revenium requests', currentBatch.length);

  const requestGroups = new Map<string, BatchedRequest[]>();

  for (const item of currentBatch) {
    const key = `${item.config.apiKey}:${item.config.baseUrl}`;
    if (!requestGroups.has(key)) {
      requestGroups.set(key, []);
    }
    requestGroups.get(key)!.push(item);
  }

  for (const [, requests] of requestGroups) {
    await processBatchGroup(requests);
  }

  isProcessingBatch = false;
}

async function processBatchGroup(requests: BatchedRequest[]): Promise<void> {
  if (requests.length === 0) return;
  const config = requests[0]!.config;
  const circuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG;

  if (!shouldAllowRequest(circuitBreakerConfig)) {
    logger.warning(
      'Revenium API circuit breaker is open, rejecting batch of %d requests',
      requests.length
    );
    requests.forEach(item => {
      item.reject(new Error('Circuit breaker is open'));
    });
    return;
  }

  const promises = requests.map(async item => {
    try {
      await createCompletionWithRetry(
        item.request,
        config,
        circuitBreakerConfig
      );
      logger.debug(
        'Batch request completed successfully for transaction: %s',
        item.request.transactionId
      );
      item.resolve();
    } catch (error) {
      logger.error(
        'Batch request failed for transaction %s: %s',
        item.request.transactionId,
        error instanceof Error ? error.message : String(error)
      );
      item.reject(error);
    }
  });

  await Promise.allSettled(promises);
}

async function createCompletionWithRetry(
  request: CreateCompletionRequest,
  config: ReveniumConfig,
  circuitBreakerConfig: CircuitBreakerConfig
): Promise<void> {
  for (let attempt = 1; attempt <= circuitBreakerConfig.maxRetries; attempt++) {
    try {
      await createCompletion(request, config);
      recordSuccess();
      return;
    } catch (error) {
      if (attempt === circuitBreakerConfig.maxRetries) {
        recordFailure(circuitBreakerConfig);
        throw error;
      } else {
        await sleep(circuitBreakerConfig.retryDelayMs);
      }
    }
  }
}

function scheduleBatchProcessing(): void {
  if (batchTimer) return;

  batchTimer = setTimeout(() => {
    processBatch().catch(error => {
      logger.error(
        'Error processing batch: %s',
        error instanceof Error ? error.message : String(error)
      );
    });
  }, DEFAULT_BATCH_CONFIG.flushIntervalMs);
}

function addToBatch(
  request: CreateCompletionRequest,
  config: ReveniumConfig
): Promise<void> {
  return new Promise((resolve, reject) => {
    const batchedRequest: BatchedRequest = {
      request,
      config,
      timestamp: Date.now(),
      resolve,
      reject,
    };

    batchQueue.push(batchedRequest);

    if (batchQueue.length >= DEFAULT_BATCH_CONFIG.maxBatchSize) {
      setImmediate(() => {
        processBatch().catch(error => {
          logger.error(
            'Error processing full batch: %s',
            error instanceof Error ? error.message : String(error)
          );
        });
      });
    } else {
      scheduleBatchProcessing();
    }

    const now = Date.now();
    const hasOldRequests = batchQueue.some(
      item => now - item.timestamp > DEFAULT_BATCH_CONFIG.maxWaitTimeMs
    );

    if (hasOldRequests) {
      setImmediate(() => {
        processBatch().catch(error => {
          logger.error(
            'Error processing aged batch: %s',
            error instanceof Error ? error.message : String(error)
          );
        });
      });
    }
  });
}

export interface ErrorContext {
  correlationId: string;
  operation: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export function validateSecureUrl(
  url: string,
  allowedUrls: string[],
  urlType: string
): boolean {
  if (!url || typeof url !== 'string')
    throw new Error(`Invalid ${urlType}: URL must be a non-empty string`);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid ${urlType}: URL format is invalid`);
  }

  if (parsedUrl.protocol !== 'https:')
    throw new Error(`Invalid ${urlType}: Only HTTPS URLs are allowed`);

  const isAllowed = allowedUrls.some(allowedUrl => {
    try {
      const allowedParsed = new URL(allowedUrl);
      return (
        parsedUrl.hostname === allowedParsed.hostname &&
        (url.startsWith(allowedUrl) || allowedUrl.startsWith(url))
      );
    } catch {
      return false;
    }
  });

  if (!isAllowed) {
    throw new Error(
      `Invalid ${urlType}: URL not in allowlist. Allowed domains: ${allowedUrls.map(u => new URL(u).hostname).join(', ')}`
    );
  }

  return true;
}

export function validateApiKey(apiKey: string, keyType: string): boolean {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error(`Invalid ${keyType}: API key must be a non-empty string`);
  }

  const trimmedKey = apiKey.trim();

  if (trimmedKey.length === 0) {
    throw new Error(
      `Invalid ${keyType}: API key cannot be empty or only whitespace`
    );
  }

  if (trimmedKey.length < 20) {
    throw new Error(
      `Invalid ${keyType}: API key appears too short (minimum 20 characters)`
    );
  }

  const placeholders = [
    'your-api-key',
    'api-key-here',
    'replace-me',
    'test',
    'demo',
    'example',
  ];
  if (
    placeholders.some(placeholder =>
      trimmedKey.toLowerCase().includes(placeholder)
    )
  ) {
    throw new Error(
      `Invalid ${keyType}: API key appears to be a placeholder value`
    );
  }

  if (
    keyType.toLowerCase().includes('anthropic') &&
    !trimmedKey.startsWith('sk-ant-')
  ) {
    throw new Error(
      `Invalid ${keyType}: Anthropic API keys must start with 'sk-ant-'`
    );
  }

  return true;
}

export function validateModelName(modelName: string): boolean {
  if (!modelName || typeof modelName !== 'string') {
    throw new Error('Invalid model name: must be a non-empty string');
  }

  const trimmedName = modelName.trim();

  if (trimmedName.length === 0) {
    throw new Error('Invalid model name: cannot be empty or only whitespace');
  }

  const validModelNameRegex = /^[a-zA-Z0-9._-]+$/;
  if (!validModelNameRegex.test(trimmedName)) {
    throw new Error(
      'Invalid model name: can only contain letters, numbers, dots, hyphens, and underscores'
    );
  }

  if (trimmedName.length > 100) {
    throw new Error('Invalid model name: maximum length is 100 characters');
  }

  return true;
}

export function validateNumericParameter(
  value: unknown,
  paramName: string,
  min: number,
  max: number,
  allowUndefined: boolean = false
): boolean {
  if (value === undefined || value === null) {
    if (allowUndefined) return true;
    throw new Error(`Invalid ${paramName}: parameter is required`);
  }

  if (typeof value !== 'number') {
    throw new Error(`Invalid ${paramName}: must be a number`);
  }

  if (isNaN(value) || !isFinite(value)) {
    throw new Error(`Invalid ${paramName}: must be a finite number`);
  }

  if (value < min || value > max) {
    throw new Error(`Invalid ${paramName}: must be between ${min} and ${max}`);
  }

  return true;
}

export function validateTimeout(
  timeout: unknown,
  allowUndefined: boolean = true
): boolean {
  if (timeout === undefined || timeout === null) {
    if (allowUndefined) return true;
    throw new Error('Invalid timeout: parameter is required');
  }

  if (typeof timeout !== 'number') {
    throw new Error('Invalid timeout: must be a number (milliseconds)');
  }

  if (isNaN(timeout) || !isFinite(timeout)) {
    throw new Error('Invalid timeout: must be a finite number');
  }

  if (timeout < 0) {
    throw new Error('Invalid timeout: cannot be negative');
  }

  if (timeout > 24 * 60 * 60 * 1000) {
    throw new Error('Invalid timeout: cannot exceed 24 hours');
  }

  return true;
}

export function getStopReason(
  anthropicStopReason?: AnthropicFinishReason
): ReveniumStopReason {
  if (!anthropicStopReason) return 'END';
  return (ANTHROPIC_STOP_REASON_MAP[anthropicStopReason] as ReveniumStopReason) || 'END';
}

function sanitizeStringField(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function buildSubscriberObject(
  usageMetadata: UsageMetadata
): SubscriberInfo | undefined {
  const id = sanitizeStringField(
    usageMetadata.subscriberId || usageMetadata.subscriber_id
  );
  const email = sanitizeStringField(
    usageMetadata.subscriberEmail || usageMetadata.subscriber_email
  );
  const credentialName = sanitizeStringField(
    usageMetadata.subscriberCredentialName ||
      usageMetadata.subscriber_credential_name
  );
  const credentialValue = sanitizeStringField(
    usageMetadata.subscriberCredential || usageMetadata.subscriber_credential
  );

  if (!id && !email && !credentialName && !credentialValue) {
    return undefined;
  }

  const subscriber: SubscriberInfo = {};

  if (id) subscriber.id = id;
  if (email) subscriber.email = email;

  if (credentialName && credentialValue) {
    subscriber.credential = {
      name: credentialName,
      value: credentialValue,
    };
  }

  return subscriber;
}

function validateMeteringPrerequisites(
  config?: ReveniumConfig
): { apiKey: string; baseUrl: string } | null {
  const apiKey = config?.apiKey || process.env.REVENIUM_METERING_API_KEY;
  const baseUrl =
    config?.baseUrl ||
    process.env.REVENIUM_METERING_BASE_URL ||
    'https://api.revenium.ai';

  if (!apiKey) {
    logger.warning(
      'Skipping metering call: REVENIUM_METERING_API_KEY not provided'
    );
    return null;
  }

  const circuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG;

  if (!shouldAllowRequest(circuitBreakerConfig)) {
    logger.warning(
      'Revenium API circuit breaker is open, skipping usage logging'
    );
    return null;
  }

  if (!checkRateLimit()) {
    logger.warning('Rate limit exceeded, skipping usage logging');
    return null;
  }

  return { apiKey, baseUrl };
}

export function validateCredentials(
  rawCredentials: Record<string, unknown>
): ReveniumAnthropicCredentials {
  const anthropicApiKey = rawCredentials.anthropicApiKey as string;
  const reveniumApiKey = rawCredentials.reveniumApiKey as string;

  if (!anthropicApiKey) {
    throw new Error('Anthropic API key is required');
  }

  if (!reveniumApiKey) {
    throw new Error('Revenium API key is required');
  }

  const credentials: ReveniumAnthropicCredentials = {
    anthropicApiKey,
    reveniumApiKey,
    reveniumBaseUrl:
      (rawCredentials.reveniumBaseUrl as string) || 'https://api.revenium.ai',
  };

  if (rawCredentials.anthropicBaseUrl) {
    credentials.anthropicBaseUrl = rawCredentials.anthropicBaseUrl as string;
  }
  if (rawCredentials.printSummary !== undefined && rawCredentials.printSummary !== null) {
    credentials.printSummary = rawCredentials.printSummary as boolean | 'human' | 'json';
  }
  if (rawCredentials.teamId) {
    credentials.teamId = rawCredentials.teamId as string;
  }

  return credentials;
}

export function checkRateLimit(
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG
): boolean {
  const now = Date.now();

  if (now - rateLimitState.minuteWindowStart > 60000) {
    rateLimitState.requestsThisMinute = 0;
    rateLimitState.minuteWindowStart = now;
  }
  if (now - rateLimitState.hourWindowStart > 3600000) {
    rateLimitState.requestsThisHour = 0;
    rateLimitState.hourWindowStart = now;
  }

  if (rateLimitState.requestsThisMinute >= config.maxRequestsPerMinute) {
    return false;
  }
  if (rateLimitState.requestsThisHour >= config.maxRequestsPerHour) {
    return false;
  }

  rateLimitState.requestsThisMinute++;
  rateLimitState.requestsThisHour++;
  return true;
}

export function getSecureHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-api-key': apiKey,
    'X-Correlation-ID': generateCorrelationId(),
    'User-Agent': 'n8n-revenium-anthropic-middleware/1.0.0',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

export function validateResponseHeaders(_response: Response): boolean {
  return true;
}

export async function createCompletion(
  request: CreateCompletionRequest,
  config: ReveniumConfig
): Promise<CreateCompletionResponse> {
  const { buildReveniumUrl } = await import('./url-builder.js');

  const reveniumUrl = buildReveniumUrl(config.baseUrl, '/ai/completions');

  logger.debug(
    'Sending Revenium completion request: url=%s, transactionId=%s, model=%s',
    reveniumUrl,
    request.transactionId,
    request.model
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(reveniumUrl, {
      method: 'POST',
      headers: getSecureHeaders(config.apiKey),
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `Revenium API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const result = (await response.json()) as CreateCompletionResponse;
    logger.debug(
      'Revenium completion response: responseId=%s',
      result.id
    );

    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function logTokenUsage(
  responseId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
  cachedTokens: number,
  stopReason: ReveniumStopReason,
  requestTime: string,
  responseTime: string,
  requestDuration: number,
  usageMetadata: UsageMetadata = {},
  isStreamed: boolean = false,
  timeToFirstToken: number = 0,
  config?: ReveniumConfig,
  cacheCreationTokens: number = 0,
  reasoningTokens: number = 0
): Promise<void> {
  const prereqs = validateMeteringPrerequisites(config);
  if (!prereqs) return;

  const subscriber = buildSubscriberObject(usageMetadata);

  const request: CreateCompletionRequest = {
    stopReason,
    costType: 'AI',
    isStreamed,
    operationType: 'CHAT',
    inputTokenCount: inputTokens,
    outputTokenCount: outputTokens,
    reasoningTokenCount: reasoningTokens,
    cacheCreationTokenCount: cacheCreationTokens,
    cacheReadTokenCount: cachedTokens,
    totalTokenCount: totalTokens,
    model,
    transactionId: responseId,
    responseTime,
    requestDuration: Math.round(requestDuration),
    provider: 'ANTHROPIC',
    requestTime,
    completionStartTime: responseTime,
    timeToFirstToken: timeToFirstToken || Math.round(requestDuration),
    middlewareSource: 'n8n',
    ...(subscriber && { subscriber }),
    ...(usageMetadata.traceId && { traceId: usageMetadata.traceId }),
    ...(usageMetadata.taskType && { taskType: usageMetadata.taskType }),
    ...(usageMetadata.agent && { agent: usageMetadata.agent }),
    ...((usageMetadata.organizationName || usageMetadata.organizationId || usageMetadata.organization_id) && {
      organizationName: usageMetadata.organizationName || usageMetadata.organizationId || usageMetadata.organization_id,
    }),
    ...((usageMetadata.productName || usageMetadata.productId || usageMetadata.product_id) && {
      productName: usageMetadata.productName || usageMetadata.productId || usageMetadata.product_id,
    }),
    ...(usageMetadata.subscriptionId && { subscriptionId: usageMetadata.subscriptionId }),
    ...(usageMetadata.responseQualityScore && { responseQualityScore: usageMetadata.responseQualityScore }),
  };

  try {
    await addToBatch(request, prereqs);
  } catch (error) {
    logger.warning(
      'Failed to batch Revenium request: %s',
      error instanceof Error ? error.message : String(error)
    );
  }
}

export function getISOTimestamp(date?: Date): string {
  return (date || new Date()).toISOString();
}

export function calculateDuration(startTime: number, endTime?: number): number {
  return (endTime || Date.now()) - startTime;
}

export { createReveniumError, getErrorDetails, getErrorMessage, sanitizeForLogging, safeStringify } from './error-handling/index.js';

export {
  hasValidSchema,
  hasToolSchemaStructure,
  hasValidId,
  hasValidMessage,
  isN8nMemoryConnection,
  hasLoadMemoryVariables,
  hasGetMessages,
  hasSaveContext,
  isHistoryMessage,
  isLangChainMessage,
  hasUsageMetadata,
  hasTokenUsage,
} from './validation/index.js';

export function resetGlobalStateForTesting(): void {
  batchQueue = [];
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  isProcessingBatch = false;
  reveniumCircuitBreaker.failures = 0;
  reveniumCircuitBreaker.lastFailureTime = 0;
  reveniumCircuitBreaker.state = 'CLOSED';
  rateLimitState.requestsThisMinute = 0;
  rateLimitState.requestsThisHour = 0;
  rateLimitState.minuteWindowStart = Date.now();
  rateLimitState.hourWindowStart = Date.now();
}

export async function flushBatchesForTesting(): Promise<void> {
  await processBatch();
}
