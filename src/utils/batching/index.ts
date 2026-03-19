import type { CreateCompletionRequest, CreateCompletionResponse, ReveniumConfig } from '../../types/index.js';
import { createReveniumError } from '../error-handling/index.js';
import { logger } from '../logger.js';

export interface BatchConfig {
  maxBatchSize: number;
  flushIntervalMs: number;
  maxWaitTimeMs: number;
}

export const DEFAULT_BATCH_CONFIG: BatchConfig = {
  maxBatchSize: 10,
  flushIntervalMs: 100,
  maxWaitTimeMs: 1000
};

export interface BatchedRequest {
  payload: CreateCompletionRequest;
  config: ReveniumConfig;
  timestamp: number;
  resolve: (value: CreateCompletionResponse) => void;
  reject: (reason: Error) => void;
}

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

const reveniumCircuitBreaker: CircuitBreakerState = {
  failures: 0,
  lastFailureTime: 0,
  state: 'CLOSED'
};

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeoutMs: 60000,
  maxRetries: 3,
  retryDelayMs: 1000
};

let batchQueue: BatchedRequest[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let isProcessingBatch = false;

export function shouldAllowRequest(config: CircuitBreakerConfig): boolean {
  const now = Date.now();

  switch (reveniumCircuitBreaker.state) {
    case 'CLOSED':
      return true;

    case 'OPEN':
      if (now - reveniumCircuitBreaker.lastFailureTime > config.recoveryTimeoutMs) {
        reveniumCircuitBreaker.state = 'HALF_OPEN';
        logger.info('Circuit breaker transitioning to HALF_OPEN state');
        return true;
      }
      return false;

    case 'HALF_OPEN':
      return true;

    default:
      return false;
  }
}

export function recordSuccess(): void {
  if (reveniumCircuitBreaker.state === 'HALF_OPEN') {
    reveniumCircuitBreaker.state = 'CLOSED';
    reveniumCircuitBreaker.failures = 0;
    logger.info('Circuit breaker reset to CLOSED state after successful request');
  }
}

export function recordFailure(config: CircuitBreakerConfig): void {
  reveniumCircuitBreaker.failures++;
  reveniumCircuitBreaker.lastFailureTime = Date.now();

  if (reveniumCircuitBreaker.failures >= config.failureThreshold) {
    reveniumCircuitBreaker.state = 'OPEN';
    logger.warning('Circuit breaker opened after %d failures', reveniumCircuitBreaker.failures);
  }
}

export function addToBatch(
  payload: CreateCompletionRequest,
  config: ReveniumConfig
): Promise<CreateCompletionResponse> {
  return new Promise((resolve, reject) => {
    const batchedRequest: BatchedRequest = {
      payload,
      config,
      timestamp: Date.now(),
      resolve,
      reject
    };

    batchQueue.push(batchedRequest);
    logger.debug('Added request to batch queue, current size: %d', batchQueue.length);

    if (batchQueue.length >= DEFAULT_BATCH_CONFIG.maxBatchSize) {
      setImmediate(() => {
        processBatch().catch(error => {
          logger.error('Error processing full batch: %s', error instanceof Error ? error.message : String(error));
        });
      });
    } else {
      scheduleBatchProcessing();
    }

    const now = Date.now();
    const hasOldRequests = batchQueue.some(item =>
      now - item.timestamp > DEFAULT_BATCH_CONFIG.maxWaitTimeMs
    );

    if (hasOldRequests) {
      setImmediate(() => {
        processBatch().catch(error => {
          logger.error('Error processing aged batch: %s', error instanceof Error ? error.message : String(error));
        });
      });
    }
  });
}

export async function processBatch(): Promise<void> {
  if (isProcessingBatch || batchQueue.length === 0) {
    return;
  }

  isProcessingBatch = true;

  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }

  const currentBatch = [...batchQueue];
  batchQueue = [];

  logger.debug('Processing batch of %d requests', currentBatch.length);

  const requestGroups = new Map<string, BatchedRequest[]>();

  for (const request of currentBatch) {
    const key = `${request.config.apiKey}:${request.config.baseUrl}`;
    if (!requestGroups.has(key)) {
      requestGroups.set(key, []);
    }
    requestGroups.get(key)!.push(request);
  }

  for (const [, requests] of requestGroups) {
    await processBatchGroup(requests);
  }

  isProcessingBatch = false;
}

function scheduleBatchProcessing(): void {
  if (batchTimer) {
    return;
  }

  batchTimer = setTimeout(() => {
    processBatch().catch(error => {
      logger.error('Error processing batch: %s', error instanceof Error ? error.message : String(error));
    });
  }, DEFAULT_BATCH_CONFIG.flushIntervalMs);
}

async function processBatchGroup(requests: BatchedRequest[]): Promise<void> {
  if (requests.length === 0) {
    return;
  }
  const config = requests[0]!.config;
  const circuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG;

  if (!shouldAllowRequest(circuitBreakerConfig)) {
    logger.warning('Revenium API circuit breaker is open, rejecting batch of %d requests', requests.length);
    requests.forEach(item => {
      item.reject(new Error('Circuit breaker is open'));
    });
    return;
  }

  for (const request of requests) {
    try {
      const response = await makeApiCall(request.payload, config);
      recordSuccess();
      request.resolve(response);
    } catch (error) {
      recordFailure(circuitBreakerConfig);
      const reveniumError = createReveniumError(
        'Failed to log token usage to Revenium API',
        error,
        'API_CALL_FAILED'
      );
      request.reject(reveniumError);
    }
  }
}

async function makeApiCall(
  _payload: CreateCompletionRequest,
  _config: ReveniumConfig
): Promise<CreateCompletionResponse> {
  throw new Error('makeApiCall not implemented - should be imported from main utils');
}
