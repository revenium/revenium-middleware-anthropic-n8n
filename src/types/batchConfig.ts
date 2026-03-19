import { CreateCompletionRequest, ReveniumConfig } from "./api";

export interface BatchConfig {
    maxBatchSize: number;
    flushIntervalMs: number;
    maxWaitTimeMs: number;
  }

export interface BatchedRequest {
  request: CreateCompletionRequest;
  config: ReveniumConfig;
  timestamp: number;
  resolve: (value: void) => void;
  reject: (error: unknown) => void;
}
