import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(), critical: vi.fn() },
}));

import { buildSubscriberObject } from '../src/utils/index.js';
import type { UsageMetadata } from '../src/types/index.js';

describe('buildSubscriberObject - camelCase', () => {
  it('returns id from subscriberId', () => {
    const result = buildSubscriberObject({ subscriberId: 'user-1' } as UsageMetadata);
    expect(result).toEqual({ id: 'user-1' });
  });

  it('returns email from subscriberEmail', () => {
    const result = buildSubscriberObject({ subscriberEmail: 'test@test.com' } as UsageMetadata);
    expect(result).toEqual({ email: 'test@test.com' });
  });

  it('returns both id and email from camelCase fields', () => {
    const result = buildSubscriberObject({
      subscriberId: 'user-1',
      subscriberEmail: 'test@test.com',
    } as UsageMetadata);
    expect(result).toEqual({ id: 'user-1', email: 'test@test.com' });
  });
});

describe('buildSubscriberObject - snake_case', () => {
  it('returns id from subscriber_id', () => {
    const result = buildSubscriberObject({ subscriber_id: 'user-2' } as UsageMetadata);
    expect(result).toEqual({ id: 'user-2' });
  });

  it('returns email from subscriber_email', () => {
    const result = buildSubscriberObject({ subscriber_email: 'test2@test.com' } as UsageMetadata);
    expect(result).toEqual({ email: 'test2@test.com' });
  });
});

describe('buildSubscriberObject - credential', () => {
  it('includes credential when both name and value are provided via camelCase', () => {
    const result = buildSubscriberObject({
      subscriberCredentialName: 'api-key',
      subscriberCredential: 'key-val',
    } as UsageMetadata);
    expect(result).toEqual({ credential: { name: 'api-key', value: 'key-val' } });
  });

  it('omits credential when only name is provided without value', () => {
    const result = buildSubscriberObject({
      subscriberCredentialName: 'api-key',
    } as UsageMetadata);
    expect(result).toBeDefined();
    expect(result?.credential).toBeUndefined();
  });

  it('includes credential when both name and value are provided via snake_case', () => {
    const result = buildSubscriberObject({
      subscriber_credential_name: 'key',
      subscriber_credential: 'val',
    } as UsageMetadata);
    expect(result).toEqual({ credential: { name: 'key', value: 'val' } });
  });
});

describe('buildSubscriberObject - empty and whitespace', () => {
  it('returns undefined for empty metadata', () => {
    expect(buildSubscriberObject({} as UsageMetadata)).toBeUndefined();
  });

  it('returns undefined for whitespace-only subscriberId', () => {
    const result = buildSubscriberObject({ subscriberId: '  ' } as UsageMetadata);
    expect(result).toBeUndefined();
  });
});
