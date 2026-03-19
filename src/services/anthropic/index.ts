import type { INodePropertyOptions } from 'n8n-workflow';
import Anthropic from '@anthropic-ai/sdk';

import type { ReveniumAnthropicCredentials } from '../../types/index.js';
import {
  validateSecureUrl,
  validateModelName,
  getTimeoutConfig,
  getErrorDetails,
} from '../../utils/index.js';
import { logger } from '../../utils/logger.js';
import { FALLBACK_MODELS, MODEL_PRIORITIES } from '../../constants/constants.js';

export interface AnthropicServiceConfig {
  apiKey: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

export class AnthropicService {
  private client: Anthropic;
  private config: AnthropicServiceConfig;

  constructor(config: AnthropicServiceConfig) {
    this.config = config;
    this.client = this.createClient();
  }

  private createClient(): Anthropic {
    const baseURL = this.config.baseURL || 'https://api.anthropic.com';
    const timeouts = getTimeoutConfig();

    try {
      const allowedUrls = ['https://api.anthropic.com'];
      validateSecureUrl(baseURL, allowedUrls, 'Anthropic base URL');
    } catch (error) {
      const errorDetails = getErrorDetails(error);
      logger.warning('Invalid Anthropic base URL (%s), using default', errorDetails.message);
    }

    return new Anthropic({
      apiKey: this.config.apiKey,
      baseURL,
      timeout: this.config.timeout || timeouts.apiTimeout,
      maxRetries: this.config.maxRetries || 1,
    });
  }

  async getModels(): Promise<INodePropertyOptions[]> {
    try {
      logger.debug('Fetching models from Anthropic API...');
      const timeouts = getTimeoutConfig();

      const modelsResponse = await Promise.race([
        this.client.models.list({ limit: 100 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Anthropic API timeout')), timeouts.apiTimeout)
        ),
      ]);

      if (!modelsResponse || !modelsResponse.data || !Array.isArray(modelsResponse.data)) {
        logger.warning('Invalid response from Anthropic API, using fallback models');
        return FALLBACK_MODELS;
      }

      const models = modelsResponse.data;
      logger.debug('Retrieved %d models from Anthropic API', models.length);

      const modelOptions = models
        .filter(model => this.isChatModel(model.id))
        .map(model => ({
          name: this.formatModelName(model.id),
          value: model.id,
          description: `Anthropic ${model.id} model`,
        }))
        .sort((a, b) => {
          const aPriority = this.getModelPriority(a.value);
          const bPriority = this.getModelPriority(b.value);

          if (aPriority !== bPriority) {
            return aPriority - bPriority;
          }

          return a.value.localeCompare(b.value);
        });

      if (modelOptions.length === 0) {
        logger.warning('No suitable chat models found in API response, using fallback');
        return FALLBACK_MODELS;
      }

      logger.info('Successfully loaded %d Anthropic chat models', modelOptions.length);
      return modelOptions;

    } catch (error) {
      const errorDetails = getErrorDetails(error);
      logger.warning('Failed to load models from Anthropic API: %s', errorDetails.message);

      if (process.env.NODE_ENV === 'development') {
        logger.debug('Model loading error details: %O', errorDetails);
      }

      logger.info('Using fallback model list');
      return FALLBACK_MODELS;
    }
  }

  private getModelPriority(modelId: string): number {
    if (MODEL_PRIORITIES[modelId]) {
      return MODEL_PRIORITIES[modelId]!;
    }

    for (const [pattern, priority] of Object.entries(MODEL_PRIORITIES)) {
      if (modelId.startsWith(pattern)) {
        return priority;
      }
    }

    return 999;
  }

  private isChatModel(modelId: string): boolean {
    const chatModelPatterns = [
      /^claude-opus/,
      /^claude-sonnet/,
      /^claude-haiku/,
      /^claude-3/,
      /^claude-2/,
    ];

    return chatModelPatterns.some(pattern => pattern.test(modelId));
  }

  private formatModelName(modelId: string): string {
    const nameMap: Record<string, string> = {
      'claude-opus-4-20250514': 'Claude Opus 4',
      'claude-sonnet-4-20250514': 'Claude Sonnet 4',
      'claude-haiku-4-20250514': 'Claude Haiku 4',
      'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
      'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku',
      'claude-3-opus-20240229': 'Claude 3 Opus',
      'claude-3-sonnet-20240229': 'Claude 3 Sonnet',
      'claude-3-haiku-20240307': 'Claude 3 Haiku',
    };

    return nameMap[modelId] || modelId;
  }

  validateModel(modelName: string): boolean {
    return validateModelName(modelName);
  }

  static fromCredentials(credentials: ReveniumAnthropicCredentials): AnthropicService {
    return new AnthropicService({
      apiKey: credentials.anthropicApiKey,
      baseURL: credentials.anthropicBaseUrl,
    });
  }
}
