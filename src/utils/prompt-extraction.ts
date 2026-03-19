import type { BaseMessage } from '@langchain/core/messages';
import type { UsageMetadata } from '../types/index.js';

const DEFAULT_MAX_PROMPT_SIZE = 50000;
const CAPTURE_PROMPTS_DEFAULT = false;

export function getMaxPromptSize(metadata?: UsageMetadata): number {
  if (metadata?.maxPromptSize && metadata.maxPromptSize > 0) {
    return metadata.maxPromptSize;
  }

  const envValue = process.env.REVENIUM_MAX_PROMPT_SIZE;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return DEFAULT_MAX_PROMPT_SIZE;
}

export function shouldCapturePrompts(metadata?: UsageMetadata): boolean {
  if (metadata?.capturePrompts !== undefined) {
    return metadata.capturePrompts;
  }

  const envValue = process.env.REVENIUM_CAPTURE_PROMPTS;
  if (envValue !== undefined) {
    return envValue.toLowerCase() === 'true';
  }

  return CAPTURE_PROMPTS_DEFAULT;
}

export function sanitizeCredentials(text: string): string {
  const patterns = [
    { regex: /pplx-[a-zA-Z0-9_-]{20,}/g, replacement: 'pplx-***REDACTED***' },
    {
      regex: /sk-proj-[a-zA-Z0-9_-]{48,}/g,
      replacement: 'sk-proj-***REDACTED***',
    },
    {
      regex: /sk-ant-[a-zA-Z0-9_-]{20,}/g,
      replacement: 'sk-ant-***REDACTED***',
    },
    { regex: /sk-[a-zA-Z0-9_-]{20,}/g, replacement: 'sk-***REDACTED***' },
    { regex: /AKIA[A-Z0-9]{16}/g, replacement: 'AKIA***REDACTED***' },
    { regex: /ghp_[a-zA-Z0-9]{36,}/g, replacement: 'ghp_***REDACTED***' },
    { regex: /ghs_[a-zA-Z0-9]{36,}/g, replacement: 'ghs_***REDACTED***' },
    {
      regex: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
      replacement: '***REDACTED_JWT***',
    },
    {
      regex: /Bearer\s+[a-zA-Z0-9_\-\.]+/gi,
      replacement: 'Bearer ***REDACTED***',
    },
    {
      regex: /api[_-]?key["']?\s*[:=]\s*["']?[a-zA-Z0-9_\-\.]{20,}/gi,
      replacement: 'api_key: ***REDACTED***',
    },
    {
      regex: /token["']?\s*[:=]\s*["']?[a-zA-Z0-9_\-\.]{20,}/gi,
      replacement: 'token: ***REDACTED***',
    },
    {
      regex: /password["']?\s*[:=]\s*["']?[^\s"',}]{8,}/gi,
      replacement: 'password: ***REDACTED***',
    },
    {
      regex: /secret["']?\s*[:=]\s*["']?[^\s"',}]{8,}/gi,
      replacement: 'secret: ***REDACTED***',
    },
  ];

  let sanitized = text;
  for (const pattern of patterns) {
    sanitized = sanitized.replace(pattern.regex, pattern.replacement);
  }
  return sanitized;
}

function truncateString(
  str: string,
  maxLength: number
): { value: string; truncated: boolean } {
  const sanitized = sanitizeCredentials(str);
  if (sanitized.length <= maxLength) {
    return { value: sanitized, truncated: false };
  }

  let endIndex = maxLength;
  if (endIndex > 0 && endIndex < sanitized.length) {
    const charCode = sanitized.charCodeAt(endIndex - 1);
    if (charCode >= 0xd800 && charCode <= 0xdbff) {
      endIndex--;
    }
  }
  return { value: sanitized.slice(0, endIndex), truncated: true };
}

export interface PromptData {
  systemPrompt?: string;
  inputMessages?: string;
  outputResponse?: string;
  promptsTruncated: boolean;
}

function getMessageRole(message: BaseMessage): string {
  try {
    const type = message._getType();
    switch (type) {
      case 'system':
        return 'system';
      case 'human':
        return 'user';
      case 'ai':
        return 'assistant';
      case 'function':
        return 'function';
      case 'tool':
        return 'tool';
      default:
        return type;
    }
  } catch {
    return 'unknown';
  }
}

function getMessageContent(message: BaseMessage): string {
  const content = message.content;
  if (!content) {
    return '';
  }
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block: any) => {
        if (!block) {
          return '';
        }
        if (typeof block === 'string') {
          return block;
        }
        if (block.type === 'text' && block.text) {
          return block.text;
        }
        if (block.type === 'image_url' || block.type === 'image') {
          return '[IMAGE]';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function extractSystemPrompt(messages: BaseMessage[]): string {
  const systemMessages = messages
    .filter(msg => getMessageRole(msg) === 'system')
    .map(msg => getMessageContent(msg))
    .filter(Boolean);

  return systemMessages.join('\n\n');
}

function extractInputMessages(messages: BaseMessage[]): string {
  return messages
    .filter(msg => getMessageRole(msg) !== 'system')
    .map(
      message => `[${getMessageRole(message)}]\n${getMessageContent(message)}`
    )
    .join('\n\n');
}

function extractOutputResponse(result: any): string {
  const generation = result?.generations?.[0];
  const message = generation?.message;

  if (!message) {
    return '';
  }

  let output = '';

  const content = getMessageContent(message);
  if (content) {
    output += content;
  }

  const toolCalls = message.additional_kwargs?.tool_calls;
  if (toolCalls && Array.isArray(toolCalls)) {
    const toolCallsStr = toolCalls
      .map((tc: any) => `[TOOL_CALL: ${tc.function?.name || tc.name || 'unknown'}]`)
      .join('\n');
    output += output ? `\n${toolCallsStr}` : toolCallsStr;
  }

  return output;
}

export function extractPrompts(
  messages: BaseMessage[],
  chatResult: any,
  metadata?: UsageMetadata
): PromptData | null {
  if (!shouldCapturePrompts(metadata)) {
    return null;
  }

  const maxSize = getMaxPromptSize(metadata);

  const systemPrompt = extractSystemPrompt(messages);
  const inputMessages = extractInputMessages(messages);
  const outputResponse = extractOutputResponse(chatResult);

  const systemPromptResult = systemPrompt
    ? truncateString(systemPrompt, maxSize)
    : { value: '', truncated: false };
  const inputMessagesResult = inputMessages
    ? truncateString(inputMessages, maxSize)
    : { value: '', truncated: false };
  const outputResponseResult = outputResponse
    ? truncateString(outputResponse, maxSize)
    : { value: '', truncated: false };

  const hasAnyContent =
    systemPromptResult.value ||
    inputMessagesResult.value ||
    outputResponseResult.value;

  if (!hasAnyContent) {
    return null;
  }

  const truncated =
    systemPromptResult.truncated ||
    inputMessagesResult.truncated ||
    outputResponseResult.truncated;

  const promptData: PromptData = {
    promptsTruncated: truncated,
  };

  if (systemPromptResult.value) {
    promptData.systemPrompt = systemPromptResult.value;
  }
  if (inputMessagesResult.value) {
    promptData.inputMessages = inputMessagesResult.value;
  }
  if (outputResponseResult.value) {
    promptData.outputResponse = outputResponseResult.value;
  }

  return promptData;
}
