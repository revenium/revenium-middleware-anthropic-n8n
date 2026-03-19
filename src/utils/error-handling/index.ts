import type { ReveniumError } from '../../types/index.js';
import { hasValidMessage } from '../validation/index.js';

export interface ErrorContext {
  correlationId: string;
  operation: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export function createReveniumError(
  message: string,
  cause?: unknown,
  code?: string,
  statusCode?: number
): ReveniumError {
  const error = new Error(message) as ReveniumError;
  error.name = 'ReveniumError';
  if (code) error.code = code;
  if (statusCode) error.statusCode = statusCode;
  if(cause) error.cause = cause;
  if(cause && cause instanceof Error) error.stack = `${error.stack}\nCaused by: ${cause.stack}`;
  return error;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (hasValidMessage(error)) return error.message;
  return 'Unknown error occurred';
}

export function getErrorDetails(error: unknown): {
  message: string;
  name?: string;
  code?: string;
  statusCode?: number;
  stack?: string;
} {
  const details = {
    message: getErrorMessage(error)
  };

  if (error instanceof Error) {
    const reveniumError = error as ReveniumError;
    return {
      ...details,
      name: error.name,
      ...(reveniumError.code ? { code: reveniumError.code } : {}),
      ...(reveniumError.statusCode ? { statusCode: reveniumError.statusCode } : {}),
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  return details;
}

export function sanitizeForLogging(data: unknown): unknown {
  if (typeof data === 'string') {
    return data.replace(/sk-[a-zA-Z0-9]{48}/g, 'sk-***MASKED***')
               .replace(/[a-zA-Z0-9]{32,}/g, (match) => {
                 if (match.length > 20) {
                   return `${match.substring(0, 4)}***MASKED***${match.substring(match.length - 4)}`;
                 }
                 return match;
               });
  }

  if (typeof data === 'object' && data !== null) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (['apiKey', 'api_key', 'token', 'password', 'secret', 'credential'].some(
        sensitiveKey => key.toLowerCase().includes(sensitiveKey)
      )) {
        if (typeof value === 'string' && value.length > 8) {
          sanitized[key] = `${value.substring(0, 4)}***MASKED***`;
        } else {
          sanitized[key] = '***MASKED***';
        }
      } else {
        sanitized[key] = sanitizeForLogging(value);
      }
    }
    return sanitized;
  }

  return data;
}

export function safeStringify(obj: unknown, space?: number): string {
  try {
    return JSON.stringify(sanitizeForLogging(obj), null, space);
  } catch (error) {
    return `[Stringify Error: ${getErrorMessage(error)}]`;
  }
}
