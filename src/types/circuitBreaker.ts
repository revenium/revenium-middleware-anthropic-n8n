export interface CircuitBreakerState {
    failures: number;
    lastFailureTime: number;
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  }

export interface CircuitBreakerConfig {
    failureThreshold: number;
    recoveryTimeoutMs: number;
    maxRetries: number;
    retryDelayMs: number;
}
