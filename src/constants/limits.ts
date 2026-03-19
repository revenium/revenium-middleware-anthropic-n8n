export const MAX_PAYLOAD_SIZE = 100000;
export const MAX_RESPONSE_SIZE = 1000000;
export const MAX_BATCH_SIZE = 10;
export const MAX_RETRY_ATTEMPTS = 3;
export const MAX_FUNCTION_COMPLEXITY = 10;
export const MAX_LINES_PER_FUNCTION = 50;
export const MAX_NESTING_DEPTH = 4;
export const MAX_FUNCTION_PARAMETERS = 8;
export const MAX_REQUESTS_PER_MINUTE = 60;
export const MAX_REQUESTS_PER_HOUR = 3600;
export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;

export const DEFAULT_LIMITS = {
  payloadSize: MAX_PAYLOAD_SIZE,
  responseSize: MAX_RESPONSE_SIZE,
  batchSize: MAX_BATCH_SIZE,
  retryAttempts: MAX_RETRY_ATTEMPTS,
  functionComplexity: MAX_FUNCTION_COMPLEXITY,
  linesPerFunction: MAX_LINES_PER_FUNCTION,
  nestingDepth: MAX_NESTING_DEPTH,
  functionParameters: MAX_FUNCTION_PARAMETERS,
  requestsPerMinute: MAX_REQUESTS_PER_MINUTE,
  requestsPerHour: MAX_REQUESTS_PER_HOUR,
  circuitBreakerFailures: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
} as const;

export function validateLimit(value: number, limit: number, name: string): boolean {
  if (value > limit) {
    throw new Error(`${name} exceeds maximum limit of ${limit}: ${value}`);
  }
  return true;
}

export function isWithinLimit(value: number, limit: number): boolean {
  return value <= limit;
}
