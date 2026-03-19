import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';

import type {
  CreateCompletionRequest,
  CreateCompletionResponse,
  ReveniumAnthropicCredentials,
  AnthropicUsage,
  AnthropicFinishReason,
} from '../../types/index.js';
import {
  hasValidId,
  hasTokenUsage,
  createReveniumError,
  getErrorDetails,
  buildSubscriberObject,
  getStopReason,
} from '../../utils/index.js';
import { logger } from '../../utils/logger.js';
import { buildReveniumUrl } from '../../utils/url-builder.js';
import {
  setConfig as setSummaryPrinterConfig,
  printUsageSummary,
} from '../../utils/summary-printer.js';

export interface ReveniumServiceConfig {
  apiKey: string;
  baseUrl: string;
  usageMetadata?: Record<string, unknown>;
  printSummary?: boolean | 'human' | 'json';
  teamId?: string;
}

export interface UsageTrackingOptions {
  isStreamed?: boolean;
  timeToFirstToken?: number;
  modelVersion?: string;
}

export class ReveniumService {
  private config: ReveniumServiceConfig;

  constructor(config: ReveniumServiceConfig) {
    this.config = config;

    setSummaryPrinterConfig({
      reveniumApiKey: config.apiKey,
      reveniumBaseUrl: config.baseUrl,
      teamId: config.teamId,
      printSummary: config.printSummary,
    });
  }

  async trackUsage(
    messages: BaseMessage[],
    result: ChatResult,
    responseMetadata: Record<string, unknown>,
    usageMetadata: AnthropicUsage | Record<string, unknown> | undefined,
    duration: number,
    modelName: string,
    options: UsageTrackingOptions = {}
  ): Promise<CreateCompletionResponse> {
    try {
      const generation = result.generations?.[0];
      const message = generation?.message;

      const usage =
        responseMetadata.usage || responseMetadata.tokenUsage || usageMetadata;
      const requestId = hasValidId(message)
        ? message.id
        : `generated-${Date.now()}`;
      const finishReason = (responseMetadata.stop_reason || 'end_turn') as AnthropicFinishReason;

      logger.debug('Usage data extraction in trackUsage: %O', {
        hasResponseMetadataUsage: !!responseMetadata.usage,
        hasResponseMetadataTokenUsage: !!responseMetadata.tokenUsage,
        hasUsageMetadata: !!usageMetadata,
        finalUsage: !!usage,
        usageStructure: usage ? Object.keys(usage as object) : null,
        responseMetadataKeys: Object.keys(responseMetadata),
      });

      if (!usage) {
        logger.warning(
          'No usage data found in any location - skipping Revenium tracking'
        );
        logger.debug(
          'Available data for debugging: responseMetadata=%O, usageMetadata=%O',
          responseMetadata,
          usageMetadata
        );
        throw new Error('No usage data available for tracking');
      }

      const payload = this.createTrackingPayload(
        usage,
        requestId,
        modelName,
        finishReason,
        duration,
        options
      );

      const trackingResult = await this.sendTrackingData(payload);

      try {
        printUsageSummary(payload);
      } catch (summaryError) {
        logger.debug(
          'Failed to print usage summary (non-blocking): %s',
          summaryError instanceof Error
            ? summaryError.message
            : String(summaryError)
        );
      }

      return trackingResult;
    } catch (error) {
      const errorDetails = getErrorDetails(error);
      logger.error(
        'Failed to track usage with Revenium: %s',
        errorDetails.message
      );
      throw createReveniumError(
        'Usage tracking failed',
        error,
        'TRACKING_FAILED'
      );
    }
  }

  private createTrackingPayload(
    usage: unknown,
    requestId: string,
    modelName: string,
    finishReason: AnthropicFinishReason,
    duration: number,
    options: UsageTrackingOptions
  ): CreateCompletionRequest {
    const now = new Date().toISOString();
    const requestTime = new Date(Date.now() - duration).toISOString();

    const stopReason = getStopReason(finishReason);

    const subscriber = this.config.usageMetadata
      ? buildSubscriberObject(this.config.usageMetadata as Record<string, string>)
      : undefined;

    const inputTokenCount = hasTokenUsage(usage)
      ? usage.input_tokens || usage.prompt_tokens || usage.promptTokens || 0
      : 0;
    const outputTokenCount = hasTokenUsage(usage)
      ? usage.output_tokens || usage.completion_tokens || usage.completionTokens || 0
      : 0;
    const totalTokenCount = hasTokenUsage(usage)
      ? usage.total_tokens || usage.totalTokens || inputTokenCount + outputTokenCount || 0
      : 0;
    const cacheCreationTokenCount = hasTokenUsage(usage)
      ? usage.cache_creation_input_tokens || 0
      : 0;
    const cacheReadTokenCount = hasTokenUsage(usage)
      ? usage.cache_read_input_tokens || 0
      : 0;
    const reasoningTokenCount = hasTokenUsage(usage)
      ? usage.completion_tokens_details?.reasoning_tokens ||
        usage.output_token_details?.reasoning ||
        0
      : 0;

    return {
      stopReason,
      costType: 'AI',
      isStreamed: options.isStreamed || false,
      operationType: 'CHAT',
      inputTokenCount,
      outputTokenCount,
      reasoningTokenCount,
      cacheCreationTokenCount,
      cacheReadTokenCount,
      totalTokenCount,
      model: modelName,
      transactionId: requestId,
      responseTime: now,
      requestDuration: Math.round(duration),
      provider: 'ANTHROPIC',
      requestTime,
      completionStartTime: now,
      timeToFirstToken: options.timeToFirstToken || Math.round(duration),
      ...(subscriber && { subscriber }),
      middlewareSource: 'n8n',
      ...(this.config.usageMetadata?.traceId && {
        traceId: this.config.usageMetadata.traceId,
      }),
      ...(this.config.usageMetadata?.taskType && {
        taskType: this.config.usageMetadata.taskType,
      }),
      ...(this.config.usageMetadata?.agent && {
        agent: this.config.usageMetadata.agent,
      }),
      ...((this.config.usageMetadata?.organizationName ||
        this.config.usageMetadata?.organizationId ||
        this.config.usageMetadata?.organization_id) && {
        organizationName:
          this.config.usageMetadata.organizationName ||
          this.config.usageMetadata.organizationId ||
          this.config.usageMetadata.organization_id,
      }),
      ...((this.config.usageMetadata?.productName ||
        this.config.usageMetadata?.productId ||
        this.config.usageMetadata?.product_id) && {
        productName:
          this.config.usageMetadata.productName ||
          this.config.usageMetadata.productId ||
          this.config.usageMetadata.product_id,
      }),
      ...(this.config.usageMetadata?.subscriptionId && {
        subscriptionId: this.config.usageMetadata.subscriptionId,
      }),
      ...(this.config.usageMetadata?.responseQualityScore && {
        responseQualityScore: this.config.usageMetadata.responseQualityScore,
      }),
    };
  }

  private async sendTrackingData(
    payload: CreateCompletionRequest
  ): Promise<CreateCompletionResponse> {
    const url = buildReveniumUrl(this.config.baseUrl, '/ai/completions');

    logger.debug(
      'Sending Revenium tracking payload: requestId=%s, model=%s, tokens=%d, duration=%d, stopReason=%s, isStreamed=%s',
      payload.transactionId,
      payload.model,
      payload.totalTokenCount,
      payload.requestDuration,
      payload.stopReason,
      payload.isStreamed
    );

    logger.debug(
      'Revenium API call details: url=%s, apiKeyPrefix=%s, baseUrl=%s',
      url,
      this.config.apiKey
        ? this.config.apiKey.substring(0, 8) + '...'
        : 'MISSING',
      this.config.baseUrl
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-api-key': this.config.apiKey,
        'User-Agent': 'n8n-revenium-anthropic-middleware/1.0.0',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw createReveniumError(
        `Revenium API error: ${response.status} ${response.statusText} - ${errorText}`,
        undefined,
        'API_ERROR',
        response.status
      );
    }

    const result = (await response.json()) as CreateCompletionResponse;
    logger.debug('Revenium tracking successful: responseId=%s', result.id);

    return result;
  }

  static fromCredentials(
    credentials: ReveniumAnthropicCredentials
  ): ReveniumService {
    return new ReveniumService({
      apiKey: credentials.reveniumApiKey,
      baseUrl: credentials.reveniumBaseUrl,
      usageMetadata: credentials.usageMetadata as Record<string, unknown>,
      printSummary: credentials.printSummary,
      teamId: credentials.teamId,
    });
  }
}
