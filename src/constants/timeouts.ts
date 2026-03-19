export const MODEL_INVOCATION_TIMEOUT = 150000;
export const TOOL_EXECUTION_TIMEOUT = 15000;
export const STREAM_TIMEOUT = 60000;
export const API_TIMEOUT = 10000;
export const BATCH_PROCESSING_TIMEOUT = 5000;
export const CIRCUIT_BREAKER_TIMEOUT = 30000;
export const RETRY_DELAY_TIMEOUT = 1000;

export const DEFAULT_TIMEOUTS = {
  modelInvocation: MODEL_INVOCATION_TIMEOUT,
  toolExecution: TOOL_EXECUTION_TIMEOUT,
  streamTimeout: STREAM_TIMEOUT,
  apiTimeout: API_TIMEOUT,
  batchProcessing: BATCH_PROCESSING_TIMEOUT,
  circuitBreaker: CIRCUIT_BREAKER_TIMEOUT,
  retryDelay: RETRY_DELAY_TIMEOUT,
} as const;

export function getTimeoutFromEnv(envVar: string, defaultValue: number): number {
  const value = process.env[envVar];
  if (!value) return defaultValue;

  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    console.warn(`Invalid timeout value for ${envVar}: ${value}, using default: ${defaultValue}`);
    return defaultValue;
  }

  return parsed;
}
