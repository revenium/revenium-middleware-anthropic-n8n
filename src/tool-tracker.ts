import { randomUUID } from "crypto";
import { ToolMetadata, ToolCallReport, ToolEventPayload } from "./types/tool-metering.js";
import { getToolContext } from "./tool-context.js";
import { logger } from "./utils/logger.js";
import { buildReveniumUrl } from "./utils/url-builder.js";

const MIDDLEWARE_SOURCE = "revenium-anthropic-n8n";
const TOOL_EVENTS_ENDPOINT = "/tool/events";

function isPromise<T>(value: unknown): value is Promise<T> {
  return value !== null && typeof value === "object" && typeof (value as Promise<T>).then === "function";
}

function extractOutputFields(result: unknown, fields: string[]): Record<string, unknown> {
  if (typeof result !== "object" || result === null) {
    return {};
  }

  const extracted: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in result) {
      extracted[field] = (result as Record<string, unknown>)[field];
    }
  }
  return extracted;
}

function getReveniumConfig(): { apiKey: string; baseUrl: string } | null {
  const apiKey = process.env.REVENIUM_METERING_API_KEY;
  const baseUrl = process.env.REVENIUM_METERING_BASE_URL || "https://api.revenium.ai";

  if (!apiKey) {
    return null;
  }

  return { apiKey, baseUrl };
}

function buildToolEventPayload(
  toolId: string,
  durationMs: number,
  success: boolean,
  metadata?: ToolMetadata,
  errorMessage?: string
): ToolEventPayload {
  const context = getToolContext();
  const transactionId = metadata?.transactionId ?? context.transactionId ?? randomUUID();

  return {
    transactionId,
    toolId,
    operation: metadata?.operation,
    durationMs,
    success,
    timestamp: new Date().toISOString(),
    errorMessage,
    usageMetadata: metadata?.usageMetadata,
    agent: metadata?.agent ?? context.agent,
    organizationName: metadata?.organizationName ?? context.organizationName,
    productName: metadata?.productName ?? context.productName,
    subscriberCredential: metadata?.subscriberCredential ?? context.subscriberCredential,
    workflowId: metadata?.workflowId ?? context.workflowId,
    traceId: metadata?.traceId ?? context.traceId,
    middlewareSource: MIDDLEWARE_SOURCE,
  };
}

async function sendToolEvent(payload: ToolEventPayload): Promise<void> {
  const config = getReveniumConfig();

  if (!config) {
    logger.warning("Revenium configuration not found, skipping tool event tracking");
    return;
  }

  const url = buildReveniumUrl(config.baseUrl, TOOL_EVENTS_ENDPOINT);

  logger.debug("Sending tool event to Revenium: %s", url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "x-api-key": config.apiKey,
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));

  logger.debug("Tool event response: status=%d, statusText=%s, transactionId=%s, toolId=%s",
    response.status,
    response.statusText,
    payload.transactionId,
    payload.toolId
  );

  if (!response.ok) {
    const responseText = await response.text().catch(() => 'Unknown error');
    logger.error("Tool event API error: status=%d, statusText=%s, body=%s, transactionId=%s, toolId=%s",
      response.status,
      response.statusText,
      responseText,
      payload.transactionId,
      payload.toolId
    );
    throw new Error(`Revenium tool event API error: ${response.status} ${response.statusText}`);
  }
}

function dispatchToolEvent(payload: ToolEventPayload): void {
  sendToolEvent(payload)
    .then(() => {
      logger.debug("Tool event dispatched successfully: transactionId=%s, toolId=%s",
        payload.transactionId,
        payload.toolId
      );
    })
    .catch((error) => {
      logger.warning("Failed to send tool event: transactionId=%s, toolId=%s, error=%s",
        payload.transactionId,
        payload.toolId,
        error instanceof Error ? error.message : String(error)
      );
    });
}

export function meterTool<T>(
  toolId: string,
  fn: () => T | Promise<T>,
  metadata?: ToolMetadata
): Promise<T> {
  const startTime = performance.now();

  const handleSuccess = (result: T): T => {
    const durationMs = Math.round(performance.now() - startTime);

    let finalMetadata = metadata;
    if (metadata?.outputFields && metadata.outputFields.length > 0) {
      const extracted = extractOutputFields(result, metadata.outputFields);
      finalMetadata = {
        ...metadata,
        usageMetadata: {
          ...metadata.usageMetadata,
          ...extracted,
        },
      };
    }

    const payload = buildToolEventPayload(toolId, durationMs, true, finalMetadata);
    dispatchToolEvent(payload);
    return result;
  };

  const handleError = (error: unknown): never => {
    const durationMs = Math.round(performance.now() - startTime);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const payload = buildToolEventPayload(toolId, durationMs, false, metadata, errorMessage);
    dispatchToolEvent(payload);
    throw error;
  };

  try {
    const result = fn();

    if (isPromise<T>(result)) {
      return result.then(handleSuccess, handleError);
    }

    return Promise.resolve(handleSuccess(result));
  } catch (error) {
    const durationMs = Math.round(performance.now() - startTime);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const payload = buildToolEventPayload(toolId, durationMs, false, metadata, errorMessage);
    dispatchToolEvent(payload);
    return Promise.reject(error);
  }
}

export function reportToolCall(toolId: string, report: ToolCallReport): void {
  const metadata: ToolMetadata = {
    transactionId: report.transactionId,
    operation: report.operation,
    usageMetadata: report.usageMetadata,
    agent: report.agent,
    organizationName: report.organizationName,
    productName: report.productName,
    subscriberCredential: report.subscriberCredential,
    workflowId: report.workflowId,
    traceId: report.traceId,
  };

  const payload = buildToolEventPayload(toolId, report.durationMs, report.success, metadata, report.errorMessage);

  if (report.timestamp) {
    payload.timestamp = report.timestamp;
  }

  dispatchToolEvent(payload);
}
