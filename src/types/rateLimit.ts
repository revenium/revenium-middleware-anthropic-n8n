export interface RateLimitConfig {
    maxRequestsPerMinute: number;
    maxRequestsPerHour: number;
  }

export interface RateLimitState {
    requestsThisMinute: number;
    requestsThisHour: number;
    minuteWindowStart: number;
    hourWindowStart: number;
  }
