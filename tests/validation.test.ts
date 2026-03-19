import { describe, it, expect } from 'vitest';
import {
  validateCredentials,
  validateApiKey,
  validateModelName,
  validateNumericParameter,
  validateTimeout,
  validateSecureUrl,
  hasValidMessage,
  hasValidId,
  hasValidSchema,
  hasToolSchemaStructure,
  isHistoryMessage,
  isLangChainMessage,
  isN8nMemoryConnection,
  hasLoadMemoryVariables,
  hasGetMessages,
  hasSaveContext,
  hasUsageMetadata,
  hasTokenUsage,
} from '../src/utils/index.js';

describe('Validation Functions', () => {
  describe('validateCredentials', () => {
    const validCredentials = {
      anthropicApiKey: 'sk-ant-1234567890abcdef1234567890abcdef',
      reveniumApiKey: 'rev_1234567890abcdef1234567890abcdef',
    };

    it('should return valid credentials with all required fields', () => {
      const result = validateCredentials(validCredentials);
      expect(result.anthropicApiKey).toBe(validCredentials.anthropicApiKey);
      expect(result.reveniumApiKey).toBe(validCredentials.reveniumApiKey);
    });

    it('should throw if anthropicApiKey is missing', () => {
      expect(() => validateCredentials({ reveniumApiKey: 'rev_1234567890abcdef1234567890abcdef' }))
        .toThrow('Anthropic API key is required');
    });

    it('should throw if reveniumApiKey is missing', () => {
      expect(() => validateCredentials({ anthropicApiKey: 'sk-ant-1234567890abcdef1234567890abcdef' }))
        .toThrow('Revenium API key is required');
    });

    it('should default reveniumBaseUrl to https://api.revenium.ai', () => {
      const result = validateCredentials(validCredentials);
      expect(result.reveniumBaseUrl).toBe('https://api.revenium.ai');
    });

    it('should include optional fields when provided', () => {
      const result = validateCredentials({
        ...validCredentials,
        anthropicBaseUrl: 'https://custom.anthropic.com',
        printSummary: 'json',
        teamId: 'team-123',
      });
      expect(result.anthropicBaseUrl).toBe('https://custom.anthropic.com');
      expect(result.printSummary).toBe('json');
      expect(result.teamId).toBe('team-123');
    });
  });

  describe('validateApiKey', () => {
    it('should accept a valid API key', () => {
      expect(() => validateApiKey('rev_1234567890abcdef1234567890abcdef', 'Revenium API key')).not.toThrow();
    });

    it('should throw for non-string input', () => {
      expect(() => validateApiKey(null as any, 'API key')).toThrow('API key must be a non-empty string');
      expect(() => validateApiKey(123 as any, 'API key')).toThrow('API key must be a non-empty string');
    });

    it('should throw for empty string', () => {
      expect(() => validateApiKey('', 'API key')).toThrow('API key must be a non-empty string');
    });

    it('should throw for too short key', () => {
      expect(() => validateApiKey('short-key', 'API key')).toThrow('API key appears too short');
    });

    it('should throw for placeholder values', () => {
      expect(() => validateApiKey('your-api-key-here-replace-me', 'API key')).toThrow('API key appears to be a placeholder value');
      expect(() => validateApiKey('this-is-a-test-key-placeholder-value', 'API key')).toThrow('API key appears to be a placeholder value');
      expect(() => validateApiKey('demo-key-placeholder-1234567890', 'API key')).toThrow('API key appears to be a placeholder value');
      expect(() => validateApiKey('example-key-placeholder-1234567', 'API key')).toThrow('API key appears to be a placeholder value');
    });

    it('should throw for Anthropic key without sk-ant- prefix', () => {
      expect(() => validateApiKey('1234567890abcdef1234567890abcdef', 'Anthropic API key'))
        .toThrow("Anthropic API keys must start with 'sk-ant-'");
    });

    it('should accept sk-ant- prefixed key for Anthropic keyType', () => {
      expect(() => validateApiKey('sk-ant-1234567890abcdef1234567890abcdef', 'Anthropic API key')).not.toThrow();
    });
  });

  describe('validateModelName', () => {
    it('should accept valid model names', () => {
      expect(() => validateModelName('claude-sonnet-4-20250514')).not.toThrow();
      expect(() => validateModelName('claude-3-opus')).not.toThrow();
      expect(() => validateModelName('model_name_123')).not.toThrow();
    });

    it('should throw for non-string input', () => {
      expect(() => validateModelName(null as any)).toThrow('model name: must be a non-empty string');
      expect(() => validateModelName(123 as any)).toThrow('model name: must be a non-empty string');
    });

    it('should throw for empty string', () => {
      expect(() => validateModelName('')).toThrow('model name: must be a non-empty string');
    });

    it('should throw for invalid characters', () => {
      expect(() => validateModelName('model name')).toThrow('can only contain letters, numbers, dots, hyphens, and underscores');
      expect(() => validateModelName('model@name')).toThrow('can only contain letters, numbers, dots, hyphens, and underscores');
      expect(() => validateModelName('model/name')).toThrow('can only contain letters, numbers, dots, hyphens, and underscores');
    });

    it('should throw for too long names', () => {
      expect(() => validateModelName('a'.repeat(101))).toThrow('model name: maximum length is 100 characters');
    });
  });

  describe('validateNumericParameter', () => {
    it('should accept value within range', () => {
      expect(() => validateNumericParameter(0.5, 'temperature', 0, 2)).not.toThrow();
      expect(() => validateNumericParameter(0, 'min', 0, 10)).not.toThrow();
      expect(() => validateNumericParameter(10, 'max', 0, 10)).not.toThrow();
    });

    it('should throw for non-number input', () => {
      expect(() => validateNumericParameter('5', 'param', 0, 10)).toThrow('param: must be a number');
      expect(() => validateNumericParameter({}, 'param', 0, 10)).toThrow('param: must be a number');
    });

    it('should throw for NaN', () => {
      expect(() => validateNumericParameter(NaN, 'param', 0, 10)).toThrow('param: must be a finite number');
    });

    it('should throw for Infinity', () => {
      expect(() => validateNumericParameter(Infinity, 'param', 0, 10)).toThrow('param: must be a finite number');
      expect(() => validateNumericParameter(-Infinity, 'param', 0, 10)).toThrow('param: must be a finite number');
    });

    it('should throw for out of range values', () => {
      expect(() => validateNumericParameter(-1, 'param', 0, 10)).toThrow('param: must be between 0 and 10');
      expect(() => validateNumericParameter(11, 'param', 0, 10)).toThrow('param: must be between 0 and 10');
    });

    it('should accept undefined when allowUndefined is true', () => {
      expect(() => validateNumericParameter(undefined, 'optional', 0, 10, true)).not.toThrow();
    });

    it('should throw for undefined when allowUndefined is false', () => {
      expect(() => validateNumericParameter(undefined, 'required', 0, 10, false)).toThrow('required: parameter is required');
    });
  });

  describe('validateTimeout', () => {
    it('should accept valid timeout values', () => {
      expect(() => validateTimeout(1000)).not.toThrow();
      expect(() => validateTimeout(60000)).not.toThrow();
      expect(() => validateTimeout(0)).not.toThrow();
    });

    it('should accept undefined when allowUndefined is true', () => {
      expect(() => validateTimeout(undefined, true)).not.toThrow();
    });

    it('should throw for negative value', () => {
      expect(() => validateTimeout(-1)).toThrow('timeout: cannot be negative');
    });

    it('should throw for exceeding 24 hours', () => {
      expect(() => validateTimeout(86400001)).toThrow('timeout: cannot exceed 24 hours');
    });

    it('should throw for non-number input', () => {
      expect(() => validateTimeout('5000')).toThrow('timeout: must be a number');
    });

    it('should throw for NaN', () => {
      expect(() => validateTimeout(NaN)).toThrow('timeout: must be a finite number');
    });
  });

  describe('validateSecureUrl', () => {
    const allowedUrls = ['https://api.anthropic.com', 'https://api.revenium.ai'];

    it('should accept valid HTTPS URL in allowlist', () => {
      expect(() => validateSecureUrl('https://api.anthropic.com', allowedUrls, 'Anthropic URL')).not.toThrow();
      expect(() => validateSecureUrl('https://api.revenium.ai', allowedUrls, 'Revenium URL')).not.toThrow();
    });

    it('should throw for non-HTTPS URL', () => {
      expect(() => validateSecureUrl('http://api.anthropic.com', allowedUrls, 'URL')).toThrow('Only HTTPS URLs are allowed');
    });

    it('should throw for URL not in allowlist', () => {
      expect(() => validateSecureUrl('https://malicious.com', allowedUrls, 'URL')).toThrow('URL not in allowlist');
    });

    it('should throw for invalid URL format', () => {
      expect(() => validateSecureUrl('not-a-url', allowedUrls, 'URL')).toThrow('URL format is invalid');
    });

    it('should throw for empty string', () => {
      expect(() => validateSecureUrl('', allowedUrls, 'URL')).toThrow('URL must be a non-empty string');
    });
  });

  describe('Type Guards', () => {
    it('hasValidMessage returns true for object with string message', () => {
      expect(hasValidMessage({ message: 'hello' })).toBe(true);
    });

    it('hasValidMessage returns false for invalid objects', () => {
      expect(hasValidMessage(null)).toBe(false);
      expect(hasValidMessage({})).toBe(false);
      expect(hasValidMessage({ message: 123 })).toBe(false);
    });

    it('hasValidId returns true for object with string id', () => {
      expect(hasValidId({ id: 'abc-123' })).toBe(true);
    });

    it('hasValidId returns false for invalid objects', () => {
      expect(hasValidId(null)).toBe(false);
      expect(hasValidId({})).toBe(false);
      expect(hasValidId({ id: 42 })).toBe(false);
    });

    it('hasValidSchema returns true for object with schema object', () => {
      expect(hasValidSchema({ schema: { type: 'string' } })).toBe(true);
    });

    it('hasValidSchema returns false for invalid objects', () => {
      expect(hasValidSchema(null)).toBe(false);
      expect(hasValidSchema({ schema: null })).toBe(false);
    });

    it('hasToolSchemaStructure returns true for valid tool schema', () => {
      expect(hasToolSchemaStructure({ properties: { name: { type: 'string', description: 'Name' } }, required: ['name'] })).toBe(true);
    });

    it('hasToolSchemaStructure returns false for invalid objects', () => {
      expect(hasToolSchemaStructure(null)).toBe(false);
      expect(hasToolSchemaStructure({ required: 'not-an-array' })).toBe(false);
    });

    it('isHistoryMessage returns true for object with role and content strings', () => {
      expect(isHistoryMessage({ role: 'user', content: 'hello' })).toBe(true);
    });

    it('isHistoryMessage returns false for invalid objects', () => {
      expect(isHistoryMessage(null)).toBe(false);
      expect(isHistoryMessage({ role: 'user' })).toBe(false);
      expect(isHistoryMessage({ content: 'hello' })).toBe(false);
    });

    it('isLangChainMessage returns true for object with _getType and content', () => {
      expect(isLangChainMessage({ _getType: () => 'human', content: 'hello' })).toBe(true);
    });

    it('isLangChainMessage returns false for invalid objects', () => {
      expect(isLangChainMessage(null)).toBe(false);
      expect(isLangChainMessage({ content: 'hello' })).toBe(false);
    });

    it('hasUsageMetadata returns true for object with usage_metadata object', () => {
      expect(hasUsageMetadata({ usage_metadata: { input_tokens: 10 } })).toBe(true);
    });

    it('hasUsageMetadata returns false for invalid objects', () => {
      expect(hasUsageMetadata(null)).toBe(false);
      expect(hasUsageMetadata({})).toBe(false);
    });

    it('hasTokenUsage returns true for any non-null object', () => {
      expect(hasTokenUsage({ prompt_tokens: 10 })).toBe(true);
    });

    it('hasTokenUsage returns false for null', () => {
      expect(hasTokenUsage(null)).toBe(false);
    });
  });
});
