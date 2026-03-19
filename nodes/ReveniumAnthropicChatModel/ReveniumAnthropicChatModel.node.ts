import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult, ChatGenerationChunk } from '@langchain/core/outputs';
import { ChatAnthropic, type ChatAnthropicCallOptions } from '@langchain/anthropic';
import {
  type INodeType,
  type INodeTypeDescription,
  type ISupplyDataFunctions,
  type ILoadOptionsFunctions,
  type INodePropertyOptions,
  type SupplyData,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ReveniumAnthropicCredentials,
  AnthropicUsage,
  N8nNodeOptions,
  UsageMetadata,
  SubscriberInfo,
} from '../../src/types/index.js';
import {
  validateCredentials,
  createReveniumError,
  getErrorDetails,
  getTimeoutConfig,
  validateSecureUrl,
  validateModelName,
  validateTimeout,
  validateNumericParameter,
  hasValidId,
  hasUsageMetadata,
  hasTokenUsage,
  extractPrompts,
  shouldCapturePrompts,
  getMaxPromptSize,
} from '../../src/utils/index.js';
import { logger } from '../../src/utils/logger.js';
import { buildReveniumUrl } from '../../src/utils/url-builder.js';

class ReveniumTrackedChatAnthropic extends ChatAnthropic {
  private reveniumCredentials: ReveniumAnthropicCredentials;

  constructor(
    config: Record<string, unknown>,
    reveniumCredentials: ReveniumAnthropicCredentials
  ) {
    super(config);
    this.reveniumCredentials = reveniumCredentials;
  }

  private extractGenerationData(result: ChatResult): {
    generation: unknown;
    message: unknown;
    responseMetadata: Record<string, unknown> | undefined;
  } {
    const generation = result?.generations?.[0];
    const message = generation?.message;
    const responseMetadata = generation?.message?.response_metadata;

    return { generation, message, responseMetadata };
  }

  private logResultStructure(
    result: ChatResult,
    generation: unknown,
    message: unknown,
    responseMetadata: Record<string, unknown> | undefined
  ): void {
    logger.debug('Revenium tracking - full result structure: %O', {
      hasResult: !!result,
      hasGenerations: !!result?.generations,
      generationsLength: result?.generations?.length,
      hasGeneration: !!generation,
      hasMessage: !!message,
      hasResponseMetadata: !!responseMetadata,
      responseMetadataKeys: responseMetadata
        ? Object.keys(responseMetadata)
        : [],
      hasUsageInResponseMetadata: !!responseMetadata?.usage,
      hasUsageMetadataInMessage: hasUsageMetadata(message),
      messageKeys: message ? Object.keys(message) : [],
      messageId: (message as { id?: string })?.id,
    });

    if (responseMetadata) {
      logger.debug('Response metadata structure: %O', responseMetadata);
    }
  }

  private findUsageData(
    responseMetadata: Record<string, unknown> | undefined,
    message: unknown,
    generation: unknown
  ): unknown {
    const usageFromResponseMetadata = responseMetadata?.usage;
    const usageFromMessage = hasUsageMetadata(message)
      ? (message as { usage_metadata: unknown }).usage_metadata
      : undefined;
    const usageFromGeneration = hasUsageMetadata(generation)
      ? (generation as { usage_metadata: unknown }).usage_metadata
      : undefined;

    logger.debug('Usage data locations: %O', {
      usageFromResponseMetadata: !!usageFromResponseMetadata,
      usageFromMessage: !!usageFromMessage,
      usageFromGeneration: !!usageFromGeneration,
      usageFromResponseMetadataStructure: usageFromResponseMetadata
        ? Object.keys(usageFromResponseMetadata)
        : null,
      usageFromMessageStructure: usageFromMessage
        ? Object.keys(usageFromMessage)
        : null,
      usageFromGenerationStructure: usageFromGeneration
        ? Object.keys(usageFromGeneration)
        : null,
    });

    return usageFromResponseMetadata || usageFromMessage || usageFromGeneration;
  }

  private async trackUsageWithErrorHandling(
    messages: BaseMessage[],
    result: ChatResult,
    responseMetadata: Record<string, unknown>,
    usageMetadata: unknown,
    duration: number,
    options?: ChatAnthropicCallOptions
  ): Promise<void> {
    try {
      await this.trackUsageWithRevenium(
        messages,
        result,
        responseMetadata,
        usageMetadata as Record<string, unknown> | undefined,
        duration,
        false,
        undefined,
        options
      );
    } catch (error: unknown) {
      const errorDetails = getErrorDetails(error);
      logger.warning('Revenium tracking failed: %s', errorDetails.message);
    }
  }

  async _generate(
    messages: BaseMessage[],
    options: ChatAnthropicCallOptions,
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const startTime = Date.now();

    const result = await super._generate(messages, options, runManager);

    const endTime = Date.now();
    const duration = endTime - startTime;

    logger.info('Revenium Chat Model - intercepting _generate call');

    try {
      const { generation, message, responseMetadata } =
        this.extractGenerationData(result);

      logger.info(
        'Anthropic API call successful, extracting metadata for Revenium...'
      );

      this.logResultStructure(result, generation, message, responseMetadata);

      if (responseMetadata) {
        const usageMetadata = this.findUsageData(
          responseMetadata,
          message,
          generation
        );

        this.trackUsageWithErrorHandling(
          messages,
          result,
          responseMetadata,
          usageMetadata,
          duration,
          options
        );
      } else {
        logger.warning('No response metadata found for Revenium tracking');
      }
    } catch (error: unknown) {
      const errorDetails = getErrorDetails(error);
      logger.warning(
        'Error extracting metadata for Revenium tracking: %s',
        errorDetails.message
      );
    }

    return result;
  }

  private setupStreamTimeout(options: ChatAnthropicCallOptions): {
    abortController: AbortController;
    timeoutId: NodeJS.Timeout;
    streamTimeout: number;
  } {
    const abortController = new AbortController();
    const timeouts = getTimeoutConfig();
    const streamTimeout = (options.timeout as number) || timeouts.streamTimeout;
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, streamTimeout);

    return { abortController, timeoutId, streamTimeout };
  }

  private isFirstTokenChunk(chunk: unknown): boolean {
    return !!(
      chunk &&
      typeof chunk === 'object' &&
      'text' in chunk &&
      typeof (chunk as { text?: unknown }).text === 'string' &&
      (chunk as { text: string }).text
    );
  }

  private extractResponseMetadata(
    chunk: unknown
  ): Record<string, unknown> | null {
    if (
      chunk &&
      typeof chunk === 'object' &&
      'generationInfo' in chunk &&
      chunk.generationInfo &&
      typeof chunk.generationInfo === 'object' &&
      'response_metadata' in chunk.generationInfo
    ) {
      return chunk.generationInfo.response_metadata as Record<string, unknown>;
    }
    return null;
  }

  private extractUsageMetadata(chunk: unknown): AnthropicUsage | null {
    if (
      chunk &&
      typeof chunk === 'object' &&
      'generationInfo' in chunk &&
      chunk.generationInfo &&
      typeof chunk.generationInfo === 'object' &&
      'usage_metadata' in chunk.generationInfo
    ) {
      return chunk.generationInfo.usage_metadata as AnthropicUsage;
    }
    return null;
  }

  private processStreamingChunk(
    chunk: ChatGenerationChunk,
    startTime: number,
    firstTokenTime: number | null,
    lastResponseMetadata: Record<string, unknown> | null,
    accumulatedUsage: AnthropicUsage | null
  ): {
    updatedFirstTokenTime: number | null;
    updatedResponseMetadata: Record<string, unknown> | null;
    updatedUsage: AnthropicUsage | null;
  } {
    let updatedFirstTokenTime = firstTokenTime;
    let updatedResponseMetadata = lastResponseMetadata;
    let updatedUsage = accumulatedUsage;

    if (!updatedFirstTokenTime && this.isFirstTokenChunk(chunk)) {
      updatedFirstTokenTime = Date.now();
      logger.debug(
        'First token received in streaming at: %d ms',
        updatedFirstTokenTime - startTime
      );
    }

    const responseMetadata = this.extractResponseMetadata(chunk);
    if (responseMetadata) {
      updatedResponseMetadata = responseMetadata;
    }

    const usageMetadata = this.extractUsageMetadata(chunk);
    if (usageMetadata) {
      updatedUsage = usageMetadata;
    }

    return {
      updatedFirstTokenTime,
      updatedResponseMetadata,
      updatedUsage,
    };
  }

  private async trackStreamingUsage(
    messages: BaseMessage[],
    lastResponseMetadata: Record<string, unknown> | null,
    accumulatedUsage: AnthropicUsage | null,
    startTime: number,
    firstTokenTime: number | null,
    chunkCount: number,
    accumulatedContent: string,
    options?: ChatAnthropicCallOptions
  ): Promise<void> {
    if (!lastResponseMetadata || !this.reveniumCredentials) {
      logger.warning('Streaming Revenium tracking skipped - no metadata found');
      return;
    }

    const endTime = Date.now();
    const duration = endTime - startTime;
    const timeToFirstToken = firstTokenTime
      ? firstTokenTime - startTime
      : duration;

    logger.debug(
      'Streaming Revenium tracking - final metadata extraction: hasResponseMetadata=%s, hasUsageMetadata=%s, duration=%d, timeToFirstToken=%d, chunkCount=%d',
      !!lastResponseMetadata,
      !!accumulatedUsage,
      duration,
      timeToFirstToken,
      chunkCount
    );

    const fakeResult: ChatResult = {
      generations: [
        {
          text: accumulatedContent,
          message: {
            content: accumulatedContent,
            response_metadata: lastResponseMetadata,
            usage_metadata: accumulatedUsage,
          } as unknown as BaseMessage,
        },
      ],
    };

    try {
      await this.trackUsageWithRevenium(
        messages,
        fakeResult,
        lastResponseMetadata,
        accumulatedUsage || {},
        duration,
        true,
        timeToFirstToken,
        options
      );
    } catch (error) {
      const errorDetails = getErrorDetails(error);
      logger.warning(
        'Streaming Revenium tracking failed (non-blocking): %s',
        errorDetails.message
      );
      if (process.env.NODE_ENV === 'development') {
        logger.debug(
          'Streaming tracking error context: chunkCount=%d, duration=%d, hasMetadata=%s',
          chunkCount,
          duration,
          !!lastResponseMetadata
        );
      }
    }
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: ChatAnthropicCallOptions,
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk, void, unknown> {
    logger.info(
      'Revenium Chat Model - intercepting streaming _streamResponseChunks call'
    );

    const startTime = Date.now();
    let firstTokenTime: number | null = null;
    let accumulatedUsage: AnthropicUsage | null = null;
    let lastResponseMetadata: Record<string, unknown> | null = null;
    let accumulatedContent = '';

    const captureEnabled = shouldCapturePrompts(
      this.reveniumCredentials.usageMetadata
    );
    const maxPromptSize = captureEnabled
      ? getMaxPromptSize(this.reveniumCredentials.usageMetadata)
      : 0;

    const { abortController, timeoutId, streamTimeout } =
      this.setupStreamTimeout(options);
    const { signal } = abortController;

    try {
      const streamGenerator = super._streamResponseChunks(
        messages,
        options,
        runManager
      );

      let chunkCount = 0;
      let lastChunkTime = Date.now();

      for await (const chunk of streamGenerator) {
        if (signal.aborted) {
          throw createReveniumError(
            'Stream aborted',
            undefined,
            'STREAM_ABORTED'
          );
        }

        const currentTime = Date.now();
        if (currentTime - lastChunkTime > streamTimeout) {
          abortController.abort();
          throw createReveniumError(
            'Stream timeout exceeded',
            undefined,
            'STREAM_TIMEOUT'
          );
        }
        lastChunkTime = currentTime;

        chunkCount++;

        const { updatedFirstTokenTime, updatedResponseMetadata, updatedUsage } =
          this.processStreamingChunk(
            chunk,
            startTime,
            firstTokenTime,
            lastResponseMetadata,
            accumulatedUsage
          );

        firstTokenTime = updatedFirstTokenTime;
        lastResponseMetadata = updatedResponseMetadata;
        accumulatedUsage = updatedUsage;

        if (chunk.text && captureEnabled) {
          const remaining = maxPromptSize - accumulatedContent.length;
          if (remaining > 0) {
            accumulatedContent += chunk.text.slice(0, remaining);
          }
        }

        yield chunk;
      }

      logger.info(`Streaming completed: ${chunkCount} chunks processed`);

      await this.trackStreamingUsage(
        messages,
        lastResponseMetadata,
        accumulatedUsage,
        startTime,
        firstTokenTime,
        chunkCount,
        accumulatedContent,
        options
      );
    } catch (error) {
      const errorDetails = getErrorDetails(error);
      logger.error(
        'Revenium Chat Model - streaming error: %s',
        errorDetails.message
      );
      if (error instanceof Error && error.name === 'ReveniumError') {
        throw error;
      }
      throw createReveniumError(
        `Streaming failed: ${errorDetails.message}`,
        error,
        'STREAMING_ERROR'
      );
    } finally {
      clearTimeout(timeoutId);
      if (!signal.aborted) {
        abortController.abort();
      }
    }
  }

  private getFieldValue(
    camelCase: string | undefined,
    snakeCase: string | undefined
  ): string | undefined {
    return camelCase || snakeCase;
  }

  private extractSubscriberFields(usageMetadata: UsageMetadata): {
    id: string | undefined;
    email: string | undefined;
    credentialName: string | undefined;
    credentialValue: string | undefined;
  } {
    return {
      id: this.getFieldValue(
        usageMetadata.subscriberId,
        usageMetadata.subscriber_id
      ),
      email: this.getFieldValue(
        usageMetadata.subscriberEmail,
        usageMetadata.subscriber_email
      ),
      credentialName: this.getFieldValue(
        usageMetadata.subscriberCredentialName,
        usageMetadata.subscriber_credential_name
      ),
      credentialValue: this.getFieldValue(
        usageMetadata.subscriberCredential,
        usageMetadata.subscriber_credential
      ),
    };
  }

  private hasSubscriberData(
    id: string | undefined,
    email: string | undefined,
    credentialName: string | undefined,
    credentialValue: string | undefined
  ): boolean {
    const fields = [id, email, credentialName, credentialValue];
    return fields.some(field => !!field);
  }

  private buildCredentialObject(
    credentialName: string | undefined,
    credentialValue: string | undefined
  ): { name: string; value: string } | undefined {
    if (credentialName && credentialValue) {
      return {
        name: credentialName,
        value: credentialValue,
      };
    }
    return undefined;
  }

  private buildSubscriberInfo(
    id: string | undefined,
    email: string | undefined,
    credentialName: string | undefined,
    credentialValue: string | undefined
  ): SubscriberInfo {
    const subscriber: SubscriberInfo = {};

    if (id) subscriber.id = id;
    if (email) subscriber.email = email;

    const credential = this.buildCredentialObject(
      credentialName,
      credentialValue
    );
    if (credential) {
      subscriber.credential = credential;
    }

    return subscriber;
  }

  private buildSubscriberObject(
    usageMetadata?: UsageMetadata
  ): SubscriberInfo | undefined {
    if (!usageMetadata) {
      return undefined;
    }

    const { id, email, credentialName, credentialValue } =
      this.extractSubscriberFields(usageMetadata);

    if (!this.hasSubscriberData(id, email, credentialName, credentialValue)) {
      return undefined;
    }

    return this.buildSubscriberInfo(id, email, credentialName, credentialValue);
  }

  private extractBasicTokenCounts(usage: unknown): {
    inputTokenCount: number;
    outputTokenCount: number;
    totalTokenCount: number;
  } {
    if (!hasTokenUsage(usage)) {
      return { inputTokenCount: 0, outputTokenCount: 0, totalTokenCount: 0 };
    }

    const inputTokenCount =
      usage.input_tokens || usage.prompt_tokens || usage.promptTokens || 0;
    const outputTokenCount =
      usage.output_tokens || usage.completion_tokens || usage.completionTokens || 0;
    const totalTokenCount =
      usage.total_tokens ||
      usage.totalTokens ||
      inputTokenCount + outputTokenCount ||
      0;

    return { inputTokenCount, outputTokenCount, totalTokenCount };
  }

  private extractCacheTokenCounts(usage: unknown): {
    cacheCreationTokenCount: number;
    cacheReadTokenCount: number;
  } {
    if (!hasTokenUsage(usage)) {
      return { cacheCreationTokenCount: 0, cacheReadTokenCount: 0 };
    }

    const cacheCreationTokenCount =
      usage.cache_creation_input_tokens || 0;
    const cacheReadTokenCount =
      usage.cache_read_input_tokens || 0;

    return { cacheCreationTokenCount, cacheReadTokenCount };
  }

  private extractReasoningTokenCount(usage: unknown): {
    reasoningTokenCount: number;
  } {
    if (!hasTokenUsage(usage)) {
      return { reasoningTokenCount: 0 };
    }

    const reasoningTokenCount =
      usage.completion_tokens_details?.reasoning_tokens ||
      usage.output_token_details?.reasoning ||
      0;

    return { reasoningTokenCount };
  }

  private extractTokenCounts(usage: unknown): {
    inputTokenCount: number;
    outputTokenCount: number;
    totalTokenCount: number;
    cacheCreationTokenCount: number;
    cacheReadTokenCount: number;
    reasoningTokenCount: number;
  } {
    const basicCounts = this.extractBasicTokenCounts(usage);
    const cacheCounts = this.extractCacheTokenCounts(usage);
    const reasoningCounts = this.extractReasoningTokenCount(usage);

    logger.debug(
      'Extracted token counts: input=%d, output=%d, total=%d, cacheCreation=%d, cacheRead=%d, reasoning=%d',
      basicCounts.inputTokenCount,
      basicCounts.outputTokenCount,
      basicCounts.totalTokenCount,
      cacheCounts.cacheCreationTokenCount,
      cacheCounts.cacheReadTokenCount,
      reasoningCounts.reasoningTokenCount
    );

    return {
      ...basicCounts,
      ...cacheCounts,
      ...reasoningCounts,
    };
  }

  private extractTrackingData(
    result: ChatResult,
    responseMetadata: Record<string, unknown>,
    usageMetadata: AnthropicUsage | Record<string, unknown> | undefined
  ): {
    usage: unknown;
    requestId: string;
    modelName: string;
    finishReason: string;
  } | null {
    const generation = result.generations?.[0];
    const message = generation?.message;

    const usage =
      responseMetadata.usage || responseMetadata.tokenUsage || usageMetadata;

    const requestId = hasValidId(message)
      ? message.id
      : `generated-${Date.now()}`;
    const modelName = (responseMetadata.model as string) || this.model;
    const finishReason = (responseMetadata.stop_reason as string) || 'end_turn';

    logger.debug('Usage data extraction in trackUsageWithRevenium: %O', {
      hasResponseMetadataUsage: !!responseMetadata.usage,
      hasResponseMetadataTokenUsage: !!responseMetadata.tokenUsage,
      hasUsageMetadata: !!usageMetadata,
      finalUsage: !!usage,
      usageStructure: usage ? Object.keys(usage) : null,
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
      return null;
    }

    return { usage, requestId, modelName, finishReason };
  }

  private mapFinishReasonToStopReason(finishReason: string): string {
    switch (finishReason) {
      case 'end_turn':
        return 'END';
      case 'max_tokens':
        return 'TOKEN_LIMIT';
      case 'stop_sequence':
        return 'END_SEQUENCE';
      case 'tool_use':
        return 'END';
      default:
        return 'END';
    }
  }

  private buildUserMetadata(): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};

    if (this.reveniumCredentials.usageMetadata?.traceId) {
      metadata.traceId = this.reveniumCredentials.usageMetadata.traceId;
    }
    if (this.reveniumCredentials.usageMetadata?.taskType) {
      metadata.taskType = this.reveniumCredentials.usageMetadata.taskType;
    }
    if (
      this.reveniumCredentials.usageMetadata?.organizationName ||
      this.reveniumCredentials.usageMetadata?.organizationId ||
      this.reveniumCredentials.usageMetadata?.organization_id
    ) {
      metadata.organizationName =
        this.reveniumCredentials.usageMetadata.organizationName ||
        this.reveniumCredentials.usageMetadata.organizationId ||
        this.reveniumCredentials.usageMetadata.organization_id;
    }
    if (this.reveniumCredentials.usageMetadata?.subscriptionId) {
      metadata.subscriptionId =
        this.reveniumCredentials.usageMetadata.subscriptionId;
    }
    if (
      this.reveniumCredentials.usageMetadata?.productName ||
      this.reveniumCredentials.usageMetadata?.productId ||
      this.reveniumCredentials.usageMetadata?.product_id
    ) {
      metadata.productName =
        this.reveniumCredentials.usageMetadata.productName ||
        this.reveniumCredentials.usageMetadata.productId ||
        this.reveniumCredentials.usageMetadata.product_id;
    }
    if (this.reveniumCredentials.usageMetadata?.agent) {
      metadata.agent = this.reveniumCredentials.usageMetadata.agent;
    }
    if (this.reveniumCredentials.usageMetadata?.responseQualityScore) {
      metadata.responseQualityScore =
        this.reveniumCredentials.usageMetadata.responseQualityScore;
    }

    return metadata;
  }

  private async sendToReveniumAPI(
    payload: Record<string, unknown>
  ): Promise<void> {
    const reveniumUrl = buildReveniumUrl(
      this.reveniumCredentials.reveniumBaseUrl,
      '/ai/completions'
    );
    logger.debug(
      'Revenium API call details: url=%s, apiKeyPrefix=%s, baseUrl=%s',
      reveniumUrl,
      this.reveniumCredentials.reveniumApiKey
        ? this.reveniumCredentials.reveniumApiKey.substring(0, 8) + '...'
        : 'MISSING',
      this.reveniumCredentials.reveniumBaseUrl
    );

    const response = await fetch(reveniumUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-api-key': this.reveniumCredentials.reveniumApiKey,
        'User-Agent': 'n8n-revenium-anthropic-middleware/1.0.0',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const responseText = await response.text();
      logger.error(
        'Revenium API error: status=%d, statusText=%s, body=%s',
        response.status,
        response.statusText,
        responseText
      );
      throw new Error(
        `Revenium API error: ${response.status} ${response.statusText} - ${responseText}`
      );
    }

    const responseBody = await response.text();
    logger.info(
      'Revenium tracking successful: requestId=%s, tokens=%d, response=%s',
      payload.transactionId,
      payload.totalTokenCount,
      responseBody
    );
  }

  private async trackUsageWithRevenium(
    _messages: BaseMessage[],
    result: ChatResult,
    responseMetadata: Record<string, unknown>,
    usageMetadata: AnthropicUsage | Record<string, unknown> | undefined,
    duration: number,
    isStreamed: boolean = false,
    timeToFirstToken?: number,
    _options?: ChatAnthropicCallOptions
  ): Promise<void> {
    try {
      const trackingData = this.extractTrackingData(
        result,
        responseMetadata,
        usageMetadata
      );
      if (!trackingData) {
        return;
      }

      const { usage, requestId, modelName, finishReason } = trackingData;

      const stopReason = this.mapFinishReasonToStopReason(finishReason);

      const tokenCounts = this.extractTokenCounts(usage);

      const subscriber = this.buildSubscriberObject(
        this.reveniumCredentials.usageMetadata
      );
      if (subscriber) {
        logger.debug('Built subscriber object: %O', subscriber);
      } else {
        logger.debug('No subscriber metadata provided');
      }

      const now = new Date().toISOString();
      const requestTime = new Date(Date.now() - duration).toISOString();

      const userMetadata = this.buildUserMetadata();

      const promptData = extractPrompts(
        _messages,
        result,
        this.reveniumCredentials.usageMetadata
      );

      const reveniumPayload = {
        stopReason,
        costType: 'AI',
        isStreamed: isStreamed,
        operationType: 'CHAT',
        ...tokenCounts,
        model: modelName,
        transactionId: requestId,
        responseTime: now,
        requestDuration: Math.round(duration),
        provider: 'ANTHROPIC',
        requestTime: requestTime,
        completionStartTime: now,
        timeToFirstToken: timeToFirstToken || Math.round(duration),
        ...(subscriber && { subscriber }),
        middlewareSource: 'n8n',
        ...userMetadata,
        ...(promptData && {
          systemPrompt: promptData.systemPrompt,
          inputMessages: promptData.inputMessages,
          outputResponse: promptData.outputResponse,
          promptsTruncated: promptData.promptsTruncated,
        }),
      };

      logger.debug(
        'Sending Revenium tracking payload: requestId=%s, model=%s, tokens=%d, duration=%d, stopReason=%s, isStreamed=%s',
        requestId,
        modelName,
        reveniumPayload.totalTokenCount,
        reveniumPayload.requestDuration,
        reveniumPayload.stopReason,
        reveniumPayload.isStreamed
      );

      await this.sendToReveniumAPI(reveniumPayload);
    } catch (error) {
      const errorDetails = getErrorDetails(error);
      logger.warning('Revenium tracking failed: %s', errorDetails.message);
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Full Revenium tracking error details: %O', errorDetails);
      }
    }
  }
}

export class ReveniumAnthropicChatModel implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Revenium Anthropic Chat Model',
    name: 'reveniumAnthropicChatModel',
    icon: 'file:ReveniumAnthropic.png',
    group: ['transform'],
    version: 1,
    description: 'Chat Model with automatic Revenium usage tracking',
    defaults: {
      name: 'Revenium Anthropic Chat Model',
    },
    codex: {
      categories: ['Langchain'],
      subcategories: {
        Langchain: ['Chat Models'],
      },
      resources: {
        primaryDocumentation: [
          {
            url: 'https://docs.revenium.io',
          },
        ],
      },
    },
    inputs: [],
    outputs: [NodeConnectionTypes.AiLanguageModel],
    outputNames: ['Model'],
    credentials: [
      {
        name: 'reveniumAnthropic',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Model',
        name: 'model',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'From List',
            value: 'fromList',
          },
          {
            name: 'By ID',
            value: 'byId',
          },
        ],
        default: 'fromList',
        description: 'Select how to specify the model',
      },
      {
        displayName: 'Model',
        name: 'modelId',
        type: 'options',
        noDataExpression: true,
        description:
          'The model which will generate the completion. Models are loaded dynamically from Anthropic.',
        typeOptions: {
          loadOptionsMethod: 'getModels',
        },
        default: 'claude-sonnet-4-20250514',
        displayOptions: {
          show: {
            model: ['fromList'],
          },
        },
      },
      {
        displayName: 'Model ID',
        name: 'modelId',
        type: 'string',
        default: 'claude-sonnet-4-20250514',
        placeholder: 'claude-sonnet-4-20250514',
        description: 'Custom model ID to use',
        displayOptions: {
          show: {
            model: ['byId'],
          },
        },
      },
      {
        displayName: 'Options',
        name: 'options',
        placeholder: 'Add Option',
        description: 'Additional options to configure',
        type: 'collection',
        default: {},
        options: [
          {
            displayName: 'Base URL',
            name: 'baseURL',
            default: '',
            description: 'Override the default base URL for the API',
            type: 'string',
          },
          {
            displayName: 'Maximum Number of Tokens',
            name: 'maxTokens',
            default: -1,
            description:
              'The maximum number of tokens to generate in the completion',
            type: 'number',
            typeOptions: {
              minValue: -1,
            },
          },
          {
            displayName: 'Sampling Temperature',
            name: 'temperature',
            default: 0.7,
            typeOptions: { maxValue: 1, minValue: 0, numberPrecision: 1 },
            description:
              'Controls randomness: Lowering results in less random completions',
            type: 'number',
          },
          {
            displayName: 'Top P',
            name: 'topP',
            default: 1,
            typeOptions: { maxValue: 1, minValue: 0, numberPrecision: 1 },
            description:
              'Total probability mass of tokens to consider at each step',
            type: 'number',
          },
          {
            displayName: 'Top K',
            name: 'topK',
            default: -1,
            typeOptions: { minValue: -1 },
            description:
              'Only sample from top K options (-1 for default)',
            type: 'number',
          },
          {
            displayName: 'Timeout',
            name: 'timeout',
            default: 60000,
            description:
              'Maximum amount of time a request is allowed to take in milliseconds',
            type: 'number',
          },
          {
            displayName: 'Max Retries',
            name: 'maxRetries',
            default: 2,
            description: 'Maximum number of retries for a request',
            type: 'number',
          },
        ],
      },
      {
        displayName: 'Usage Metadata',
        name: 'usageMetadata',
        type: 'collection',
        placeholder: 'Add Metadata',
        default: {},
        description:
          'Optional metadata for enhanced Revenium tracking and analytics',
        options: [
          {
            displayName: 'Trace ID',
            name: 'traceId',
            type: 'string',
            default: '',
            description: 'Unique identifier for a conversation or session',
          },
          {
            displayName: 'Task Type',
            name: 'taskType',
            type: 'string',
            default: '',
            description: 'Classification of the AI operation by type of work',
          },
          {
            displayName: 'Subscriber Email',
            name: 'subscriberEmail',
            type: 'string',
            default: '',
            description: 'The email address of the subscriber',
          },
          {
            displayName: 'Subscriber ID',
            name: 'subscriberId',
            type: 'string',
            default: '',
            description: 'The ID of the subscriber from non-Revenium systems',
          },
          {
            displayName: 'Subscriber Credential Name',
            name: 'subscriberCredentialName',
            type: 'string',
            default: '',
            description: 'Name of the credential used by the subscriber',
          },
          {
            displayName: 'Subscriber Credential',
            name: 'subscriberCredential',
            type: 'string',
            default: '',
            description: 'The credential value used by the subscriber',
          },
          {
            displayName: 'Organization ID',
            name: 'organizationId',
            type: 'string',
            default: '',
            description: 'Customer or department ID from non-Revenium systems',
          },
          {
            displayName: 'Subscription ID',
            name: 'subscriptionId',
            type: 'string',
            default: '',
            description: 'Reference to a billing plan in non-Revenium systems',
          },
          {
            displayName: 'Product ID',
            name: 'productId',
            type: 'string',
            default: '',
            description: 'Your product or feature making the AI call',
          },
          {
            displayName: 'Agent',
            name: 'agent',
            type: 'string',
            default: '',
            description: 'Identifier for the specific AI agent',
          },
          {
            displayName: 'Response Quality Score',
            name: 'responseQualityScore',
            type: 'number',
            default: undefined,
            typeOptions: { minValue: 0, maxValue: 10, numberPrecision: 2 },
            description: 'Quality rating for the AI response (0-10)',
          },
        ],
      },
    ],
  };

  methods = {
    loadOptions: {
      async getModels(
        this: ILoadOptionsFunctions
      ): Promise<INodePropertyOptions[]> {
        const fallbackModels: INodePropertyOptions[] = [
          { name: 'Claude Opus 4', value: 'claude-opus-4-20250514' },
          { name: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514' },
          { name: 'Claude Haiku 4', value: 'claude-haiku-4-20250514' },
          { name: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
          { name: 'Claude 3.5 Haiku', value: 'claude-3-5-haiku-20241022' },
        ];

        try {
          const rawCredentials =
            await this.getCredentials('reveniumAnthropic');
          const credentials = validateCredentials(rawCredentials);

          if (!credentials.anthropicApiKey) {
            logger.warning(
              'No Anthropic API key found, using fallback models'
            );
            return fallbackModels;
          }

          const baseURL =
            credentials.anthropicBaseUrl || 'https://api.anthropic.com';
          try {
            const allowedUrls = [
              'https://api.anthropic.com',
            ];
            validateSecureUrl(baseURL, allowedUrls, 'Anthropic base URL');
          } catch (error) {
            const errorDetails = getErrorDetails(error);
            logger.warning(
              'Invalid Anthropic base URL (%s), using default',
              errorDetails.message
            );
          }

          const timeouts = getTimeoutConfig();

          const client = new Anthropic({
            apiKey: credentials.anthropicApiKey,
            baseURL,
            timeout: timeouts.apiTimeout,
            maxRetries: 1,
          });

          logger.debug('Fetching models from Anthropic API...');

          const modelsResponse = await Promise.race([
            client.models.list({ limit: 100 }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    createReveniumError(
                      'Anthropic API timeout',
                      undefined,
                      'API_TIMEOUT'
                    )
                  ),
                timeouts.apiTimeout
              )
            ),
          ]);

          if (!modelsResponse || !modelsResponse.data) {
            logger.warning(
              'Invalid response from Anthropic API, using fallback models'
            );
            return fallbackModels;
          }

          const models = modelsResponse.data;
          logger.debug(
            'Retrieved %d models from Anthropic API',
            models.length
          );

          const chatModelPatterns = [
            /^claude-opus/,
            /^claude-sonnet/,
            /^claude-haiku/,
            /^claude-3/,
            /^claude-2/,
          ];

          const chatModels = models.filter((model: unknown) => {
            if (!hasValidId(model)) {
              return false;
            }
            const modelId = model.id.toLowerCase();
            return chatModelPatterns.some(pattern => pattern.test(modelId));
          });

          const nameMap: Record<string, string> = {
            'claude-opus-4': 'Claude Opus 4',
            'claude-sonnet-4': 'Claude Sonnet 4',
            'claude-haiku-4': 'Claude Haiku 4',
            'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
            'claude-3-5-haiku': 'Claude 3.5 Haiku',
            'claude-3-opus': 'Claude 3 Opus',
            'claude-3-sonnet': 'Claude 3 Sonnet',
            'claude-3-haiku': 'Claude 3 Haiku',
            'claude-2': 'Claude 2',
          };

          const getPriority = (id: string): number => {
            if (id.startsWith('claude-opus-4')) return 1000;
            if (id.startsWith('claude-sonnet-4')) return 950;
            if (id.startsWith('claude-haiku-4')) return 900;
            if (id.startsWith('claude-3-5-sonnet')) return 850;
            if (id.startsWith('claude-3-5-haiku')) return 800;
            if (id.startsWith('claude-3-opus')) return 750;
            if (id.startsWith('claude-3-sonnet')) return 700;
            if (id.startsWith('claude-3-haiku')) return 650;
            if (id.startsWith('claude-2')) return 500;
            return 100;
          };

          const sortedModels = chatModels.sort((a: unknown, b: unknown) => {
            if (!hasValidId(a) || !hasValidId(b)) {
              return 0;
            }

            const aId = a.id.toLowerCase();
            const bId = b.id.toLowerCase();

            const priorityDiff = getPriority(bId) - getPriority(aId);
            if (priorityDiff !== 0) return priorityDiff;

            return aId.localeCompare(bId);
          });

          const modelOptions: INodePropertyOptions[] = sortedModels.map(
            (model: unknown) => {
              if (!hasValidId(model)) {
                return { name: 'Unknown Model', value: 'unknown' };
              }

              const modelId = model.id;
              let displayName = modelId;

              for (const [prefix, name] of Object.entries(nameMap)) {
                if (modelId.startsWith(prefix)) {
                  const suffix = modelId.slice(prefix.length);
                  if (suffix && suffix.startsWith('-')) {
                    displayName = `${name} (${suffix.slice(1)})`;
                  } else {
                    displayName = name;
                  }
                  break;
                }
              }

              return {
                name: displayName,
                value: modelId,
              };
            }
          );

          if (modelOptions.length === 0) {
            logger.warning(
              'No suitable chat models found in API response, using fallback'
            );
            return fallbackModels;
          }

          logger.info(
            'Successfully loaded %d Anthropic chat models',
            modelOptions.length
          );
          return modelOptions;
        } catch (error) {
          const errorDetails = getErrorDetails(error);
          logger.warning(
            'Failed to load models from Anthropic API: %s',
            errorDetails.message
          );

          if (process.env.NODE_ENV === 'development') {
            logger.debug('Model loading error details: %O', errorDetails);
          }

          logger.info('Using fallback model list');
          return fallbackModels;
        }
      },
    },
  };

  async supplyData(
    this: ISupplyDataFunctions,
    itemIndex: number
  ): Promise<SupplyData> {
    logger.debug('Revenium Chat Model - supplyData called');

    const rawCredentials = await this.getCredentials('reveniumAnthropic');
    const credentials = validateCredentials(rawCredentials);

    const modelMode = this.getNodeParameter('model', itemIndex) as string;
    const modelId = this.getNodeParameter('modelId', itemIndex) as string;

    if (
      !modelId ||
      typeof modelId !== 'string' ||
      modelId.trim().length === 0
    ) {
      throw new NodeOperationError(
        this.getNode(),
        'Model ID is required and must be a non-empty string'
      );
    }

    if (!modelMode || !['fromList', 'byId'].includes(modelMode)) {
      throw new NodeOperationError(
        this.getNode(),
        'Invalid model selection mode'
      );
    }

    const modelName = modelId.trim();

    try {
      validateModelName(modelName);
    } catch (error) {
      const errorDetails = getErrorDetails(error);
      throw new NodeOperationError(
        this.getNode(),
        `Model name validation failed: ${errorDetails.message}`
      );
    }

    const options = this.getNodeParameter(
      'options',
      itemIndex,
      {}
    ) as N8nNodeOptions;
    const usageMetadata = this.getNodeParameter(
      'usageMetadata',
      itemIndex,
      {}
    ) as UsageMetadata;

    try {
      validateNumericParameter(options.temperature, 'temperature', 0, 1, true);
    } catch (error) {
      const errorDetails = getErrorDetails(error);
      throw new NodeOperationError(
        this.getNode(),
        `Temperature validation failed: ${errorDetails.message}`
      );
    }

    try {
      if (
        options.maxTokens !== undefined &&
        options.maxTokens !== null &&
        options.maxTokens !== -1
      ) {
        validateNumericParameter(
          options.maxTokens,
          'maxTokens',
          1,
          100000,
          false
        );
      }
    } catch (error) {
      const errorDetails = getErrorDetails(error);
      throw new NodeOperationError(
        this.getNode(),
        `Max tokens validation failed: ${errorDetails.message}`
      );
    }

    try {
      validateTimeout(options.timeout, true);
    } catch (error) {
      const errorDetails = getErrorDetails(error);
      throw new NodeOperationError(
        this.getNode(),
        `Timeout validation failed: ${errorDetails.message}`
      );
    }

    logger.debug('Model selection: %s = %s', modelMode, modelName);
    logger.debug(
      'Configuration options: temperature=%s, maxTokens=%s, timeout=%s, hasUsageMetadata=%s',
      options.temperature,
      options.maxTokens,
      options.timeout,
      !!usageMetadata && Object.keys(usageMetadata).length > 0
    );

    const effectiveMaxTokens = (options.maxTokens && options.maxTokens > 0) ? options.maxTokens : undefined;

    const chatModelConfig: Record<string, unknown> = {
      anthropicApiKey: credentials.anthropicApiKey,
      model: modelName,
      temperature: options.temperature || 0.7,
      topP: options.topP || 1,
      topK:
        options.topK && options.topK > 0 ? options.topK : undefined,
      timeout: options.timeout || 60000,
      maxRetries: options.maxRetries || 2,
    };

    if (effectiveMaxTokens) {
      chatModelConfig.maxTokens = effectiveMaxTokens;
    }

    const effectiveBaseUrl = options.baseURL || credentials.anthropicBaseUrl;
    if (effectiveBaseUrl) {
      chatModelConfig.clientOptions = {
        baseURL: effectiveBaseUrl,
      };
    }

    const chatModel = new ReveniumTrackedChatAnthropic(chatModelConfig, {
      ...credentials,
      usageMetadata,
    });

    logger.debug(
      'Revenium Chat Model - returning LangChain ChatAnthropic with tracking'
    );

    return {
      response: chatModel,
    };
  }
}
