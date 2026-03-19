import { describe, it, expect } from 'vitest';
import {
  createReveniumError,
  getErrorMessage,
  getErrorDetails,
  sanitizeForLogging,
  safeStringify,
} from '../src/utils/index.js';

describe('Error Handling', () => {
  describe('createReveniumError', () => {
    it('should create error with message only', () => {
      const error = createReveniumError('Test error message');

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Test error message');
      expect(error.code).toBeUndefined();
      expect(error.statusCode).toBeUndefined();
      expect(error.cause).toBeUndefined();
    });

    it('should set name to ReveniumError', () => {
      const error = createReveniumError('Test');

      expect(error.name).toBe('ReveniumError');
    });

    it('should include code when provided', () => {
      const error = createReveniumError('API error', undefined, 'API_ERROR');

      expect(error.code).toBe('API_ERROR');
    });

    it('should include statusCode when provided', () => {
      const error = createReveniumError('API error', undefined, undefined, 500);

      expect(error.statusCode).toBe(500);
    });

    it('should include cause when provided', () => {
      const originalError = new Error('Original');
      const error = createReveniumError('Wrapped', originalError);

      expect(error.cause).toBe(originalError);
    });

    it('should chain stack trace when cause is Error', () => {
      const originalError = new Error('Original');
      const error = createReveniumError('Wrapped', originalError);

      expect(error.stack).toContain('Caused by:');
      expect(error.stack).toContain('Original');
    });

    it('should not chain stack when cause is not Error', () => {
      const error = createReveniumError('Wrapped', 'string cause');

      expect(error.cause).toBe('string cause');
      expect(error.stack).not.toContain('Caused by:');
    });
  });

  describe('getErrorMessage', () => {
    it('should extract message from Error instance', () => {
      expect(getErrorMessage(new Error('Test error'))).toBe('Test error');
    });

    it('should return string error directly', () => {
      expect(getErrorMessage('String error')).toBe('String error');
    });

    it('should extract message from object with message property', () => {
      expect(getErrorMessage({ message: 'Object error' })).toBe('Object error');
    });

    it('should return unknown error for null', () => {
      expect(getErrorMessage(null)).toBe('Unknown error occurred');
    });

    it('should return unknown error for undefined', () => {
      expect(getErrorMessage(undefined)).toBe('Unknown error occurred');
    });

    it('should return unknown error for number', () => {
      expect(getErrorMessage(42)).toBe('Unknown error occurred');
    });

    it('should return unknown error for object without message', () => {
      expect(getErrorMessage({ code: 'ERR' })).toBe('Unknown error occurred');
    });
  });

  describe('getErrorDetails', () => {
    it('should return full details for ReveniumError', () => {
      const error = createReveniumError('Revenium error', undefined, 'REV_ERR', 400);
      const details = getErrorDetails(error);

      expect(details.message).toBe('Revenium error');
      expect(details.name).toBe('ReveniumError');
      expect(details.code).toBe('REV_ERR');
      expect(details.statusCode).toBe(400);
      expect(details.stack).toBeDefined();
    });

    it('should return details for standard Error without code', () => {
      const error = new Error('Standard error');
      const details = getErrorDetails(error);

      expect(details.message).toBe('Standard error');
      expect(details.name).toBe('Error');
      expect(details.stack).toBeDefined();
      expect(details.code).toBeUndefined();
      expect(details.statusCode).toBeUndefined();
    });

    it('should return only message for string error', () => {
      const details = getErrorDetails('String error');

      expect(details.message).toBe('String error');
      expect(details.name).toBeUndefined();
      expect(details.code).toBeUndefined();
      expect(details.statusCode).toBeUndefined();
      expect(details.stack).toBeUndefined();
    });

    it('should return only message for null', () => {
      const details = getErrorDetails(null);

      expect(details.message).toBe('Unknown error occurred');
      expect(details.name).toBeUndefined();
    });
  });

  describe('sanitizeForLogging', () => {
    it('should mask API keys in strings', () => {
      const input = 'key is sk-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV';
      const result = sanitizeForLogging(input) as string;

      expect(result).toContain('sk-***MASKED***');
      expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz');
    });

    it('should mask long alphanumeric strings', () => {
      const longToken = 'abcdefghijklmnopqrstuvwxyz12345678';
      const result = sanitizeForLogging(longToken) as string;

      expect(result).toContain('***MASKED***');
      expect(result).toContain(longToken.substring(0, 4));
      expect(result).toContain(longToken.substring(longToken.length - 4));
    });

    it('should mask sensitive object keys', () => {
      const data = {
        api_key: 'supersecretapikey123',
        token: 'mytokenvalue1234',
        password: 'mypassword123456',
        secret: 'secretvalue12345',
        credential: 'credvalue123456',
      };
      const result = sanitizeForLogging(data) as Record<string, unknown>;

      expect(result.api_key).toContain('***MASKED***');
      expect(result.token).toContain('***MASKED***');
      expect(result.password).toContain('***MASKED***');
      expect(result.secret).toContain('***MASKED***');
      expect(result.credential).toContain('***MASKED***');
    });

    it('should fully mask short sensitive values', () => {
      const data = { token: 'short' };
      const result = sanitizeForLogging(data) as Record<string, unknown>;

      expect(result.token).toBe('***MASKED***');
    });

    it('should pass through non-sensitive keys unchanged', () => {
      const data = { name: 'test', count: 5 };
      const result = sanitizeForLogging(data) as Record<string, unknown>;

      expect(result.name).toBe('test');
      expect(result.count).toBe(5);
    });

    it('should return primitives unchanged', () => {
      expect(sanitizeForLogging(42)).toBe(42);
      expect(sanitizeForLogging(true)).toBe(true);
      expect(sanitizeForLogging(null)).toBe(null);
    });
  });

  describe('safeStringify', () => {
    it('should stringify and sanitize objects', () => {
      const data = { api_key: 'supersecretapikey123', name: 'test' };
      const result = safeStringify(data);

      expect(result).toContain('***MASKED***');
      expect(result).toContain('test');
    });

    it('should handle circular references gracefully', () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj;
      const result = safeStringify(obj);

      expect(result).toContain('[Stringify Error:');
    });

    it('should support space parameter for formatting', () => {
      const data = { name: 'test' };
      const result = safeStringify(data, 2);

      expect(result).toContain('\n');
      expect(result).toContain('  ');
    });
  });
});
