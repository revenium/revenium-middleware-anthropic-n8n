import { INodePropertyOptions } from "n8n-workflow";
import { BatchConfig, CircuitBreakerConfig, CircuitBreakerState, RateLimitConfig, RateLimitState } from "../types/index.js";
import { CIRCUIT_BREAKER_FAILURE_THRESHOLD, MAX_BATCH_SIZE, MAX_REQUESTS_PER_HOUR, MAX_REQUESTS_PER_MINUTE, MAX_RETRY_ATTEMPTS } from "./limits.js";
import { BATCH_PROCESSING_TIMEOUT, RETRY_DELAY_TIMEOUT, CIRCUIT_BREAKER_TIMEOUT } from "./timeouts.js";

export const MIN_TIMEOUT: number = 1000;
export const MAX_TIMEOUT: number = 600000;

export const ALLOWED_REVENIUM_BASE_URLS: string[] = [
  'https://api.revenium.ai',
  'https://api.dev.hcapp.io',
  'https://api.prod.hcapp.io',
  'https://api.qa.hcapp.io',
];

export const ALLOWED_ANTHROPIC_BASE_URLS: string[] = [
  'https://api.anthropic.com',
];

export const DEFAULT_BATCH_CONFIG: BatchConfig = {
  maxBatchSize: MAX_BATCH_SIZE,
  flushIntervalMs: BATCH_PROCESSING_TIMEOUT,
  maxWaitTimeMs: 30000
};

export const reveniumCircuitBreaker: CircuitBreakerState = {
  failures: 0,
  lastFailureTime: 0,
  state: 'CLOSED'
};

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  recoveryTimeoutMs: CIRCUIT_BREAKER_TIMEOUT,
  maxRetries: MAX_RETRY_ATTEMPTS,
  retryDelayMs: RETRY_DELAY_TIMEOUT
};

export const rateLimitState: RateLimitState = {
  requestsThisMinute: 0,
  requestsThisHour: 0,
  minuteWindowStart: Date.now(),
  hourWindowStart: Date.now()
};

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxRequestsPerMinute: MAX_REQUESTS_PER_MINUTE,
  maxRequestsPerHour: MAX_REQUESTS_PER_HOUR
};

export const MODEL_PRIORITIES: Record<string, number> = {
  'claude-opus-4': 1,
  'claude-sonnet-4': 2,
  'claude-haiku-4': 3,
  'claude-3.5-sonnet': 4,
  'claude-3.5-haiku': 5,
  'claude-3-opus': 6,
  'claude-3-sonnet': 7,
  'claude-3-haiku': 8,
};

export const FALLBACK_MODELS: INodePropertyOptions[] = [
  { name: 'Claude Opus 4', value: 'claude-opus-4-20250514' },
  { name: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514' },
  { name: 'Claude Haiku 4', value: 'claude-haiku-4-20250514' },
  { name: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
  { name: 'Claude 3.5 Haiku', value: 'claude-3-5-haiku-20241022' },
];

export const ANTHROPIC_STOP_REASON_MAP: Record<string, 'END' | 'TOKEN_LIMIT' | 'END_SEQUENCE'> = {
  end_turn: 'END',
  max_tokens: 'TOKEN_LIMIT',
  stop_sequence: 'END_SEQUENCE',
  tool_use: 'END',
};
