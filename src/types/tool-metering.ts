export interface ToolContext {
  agent?: string | undefined;
  organizationName?: string | undefined;
  productName?: string | undefined;
  subscriberCredential?: string | undefined;
  workflowId?: string | undefined;
  traceId?: string | undefined;
  transactionId?: string | undefined;
}

export interface ToolMetadata extends ToolContext {
  operation?: string | undefined;
  outputFields?: string[] | undefined;
  usageMetadata?: Record<string, unknown> | undefined;
}

export interface ToolEventPayload {
  transactionId: string;
  toolId: string;
  operation?: string | undefined;
  durationMs: number;
  success: boolean;
  timestamp: string;
  errorMessage?: string | undefined;
  usageMetadata?: Record<string, unknown> | undefined;
  agent?: string | undefined;
  organizationName?: string | undefined;
  productName?: string | undefined;
  subscriberCredential?: string | undefined;
  workflowId?: string | undefined;
  traceId?: string | undefined;
  middlewareSource: string;
}

export interface ToolCallReport {
  operation?: string | undefined;
  durationMs: number;
  success: boolean;
  errorMessage?: string | undefined;
  usageMetadata?: Record<string, unknown> | undefined;
  agent?: string | undefined;
  organizationName?: string | undefined;
  productName?: string | undefined;
  subscriberCredential?: string | undefined;
  workflowId?: string | undefined;
  traceId?: string | undefined;
  transactionId?: string | undefined;
  timestamp?: string | undefined;
}
