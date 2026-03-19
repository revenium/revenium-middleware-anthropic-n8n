export interface UsageMetadata {
  trace_id?: string;
  task_id?: string;
  task_type?: string;
  subscriber_email?: string;
  subscriber_credential_name?: string;
  subscriber_credential?: string;
  subscriber_id?: string;
  organization_id?: string;
  subscription_id?: string;
  product_id?: string;
  agent?: string;
  response_quality_score?: number;

  traceId?: string;
  taskId?: string;
  taskType?: string;
  subscriberEmail?: string;
  subscriberCredentialName?: string;
  subscriberCredential?: string;
  subscriberId?: string;
  organizationName?: string;
  /** @deprecated Use organizationName instead. */
  organizationId?: string;
  subscriptionId?: string;
  productName?: string;
  /** @deprecated Use productName instead. */
  productId?: string;
  responseQualityScore?: number;

  capturePrompts?: boolean;
  maxPromptSize?: number;
}

export interface SubscriberCredential {
  name: string;
  value: string;
}

export interface SubscriberInfo {
  id?: string;
  email?: string;
  credential?: SubscriberCredential;
}

export type SubscriberMetadata = Pick<
  UsageMetadata,
  | 'subscriberEmail'
  | 'subscriber_email'
  | 'subscriberId'
  | 'subscriber_id'
  | 'subscriberCredentialName'
  | 'subscriber_credential_name'
  | 'subscriberCredential'
  | 'subscriber_credential'
>;

export interface CreateCompletionRequest {
  stopReason: ReveniumStopReason;
  costType: 'AI';
  isStreamed: boolean;
  taskType?: string;
  agent?: string;
  operationType: 'CHAT';
  inputTokenCount: number;
  outputTokenCount: number;
  reasoningTokenCount: number;
  cacheCreationTokenCount: number;
  cacheReadTokenCount: number;
  totalTokenCount: number;
  organizationName?: string;
  productName?: string;
  subscriber?: SubscriberInfo;
  middlewareSource: string;
  subscriptionId?: string;
  model: string;
  transactionId: string;
  responseTime: string;
  requestDuration: number;
  provider: 'ANTHROPIC';
  requestTime: string;
  completionStartTime: string;
  timeToFirstToken: number;
  traceId?: string;
  responseQualityScore?: number;
  attributes?: Record<string, unknown>;
  systemPrompt?: string;
  inputMessages?: string;
  outputResponse?: string;
  promptsTruncated?: boolean;
}

export interface CreateCompletionResponse {
  id: string;
  [key: string]: unknown;
}

export interface ReveniumConfig {
  apiKey: string;
  baseUrl: string;
}

export interface ReveniumAnthropicCredentials {
  anthropicApiKey: string;
  anthropicBaseUrl?: string;
  reveniumApiKey: string;
  reveniumBaseUrl: string;
  usageMetadata?: UsageMetadata;
  printSummary?: boolean | 'human' | 'json';
  teamId?: string;
}

export type ReveniumStopReason =
  | 'END'
  | 'END_SEQUENCE'
  | 'TIMEOUT'
  | 'TOKEN_LIMIT'
  | 'COST_LIMIT'
  | 'COMPLETION_LIMIT'
  | 'ERROR'
  | 'CANCELLED';

export interface ReveniumError extends Error {
  code?: string;
  statusCode?: number;
  details?: Record<string, unknown>;
  cause?: unknown;
}
