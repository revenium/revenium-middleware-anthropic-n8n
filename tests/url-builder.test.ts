import { describe, it, expect } from 'vitest';
import { buildReveniumUrl, isValidUrl } from '../src/utils/url-builder.js';

describe('buildReveniumUrl', () => {
  it('appends /meter/v2 + endpoint when base URL has no path', () => {
    expect(buildReveniumUrl('https://api.revenium.ai', '/ai/completions'))
      .toBe('https://api.revenium.ai/meter/v2/ai/completions');
  });

  it('appends endpoint directly when base URL ends with /meter/v2', () => {
    expect(buildReveniumUrl('https://api.revenium.ai/meter/v2', '/ai/completions'))
      .toBe('https://api.revenium.ai/meter/v2/ai/completions');
  });

  it('appends /v2 + endpoint when base URL ends with /meter', () => {
    expect(buildReveniumUrl('https://api.revenium.ai/meter', '/ai/completions'))
      .toBe('https://api.revenium.ai/meter/v2/ai/completions');
  });

  it('appends endpoint directly when base URL ends with /v2', () => {
    expect(buildReveniumUrl('https://api.revenium.ai/v2', '/ai/completions'))
      .toBe('https://api.revenium.ai/v2/ai/completions');
  });

  it('strips trailing slashes from base URL', () => {
    expect(buildReveniumUrl('https://api.revenium.ai/', '/ai/completions'))
      .toBe('https://api.revenium.ai/meter/v2/ai/completions');
  });

  it('handles tool events endpoint', () => {
    expect(buildReveniumUrl('https://api.revenium.ai', '/tool/events'))
      .toBe('https://api.revenium.ai/meter/v2/tool/events');
  });

  it('matches /meter/v2 suffix case insensitively', () => {
    expect(buildReveniumUrl('https://api.revenium.ai/Meter/V2', '/ai/completions'))
      .toBe('https://api.revenium.ai/Meter/V2/ai/completions');
  });

  it('strips multiple trailing slashes from base URL', () => {
    expect(buildReveniumUrl('https://api.revenium.ai///', '/ai/completions'))
      .toBe('https://api.revenium.ai/meter/v2/ai/completions');
  });
});

describe('isValidUrl', () => {
  it('returns true for valid HTTPS URL', () => {
    expect(isValidUrl('https://api.revenium.ai')).toBe(true);
  });

  it('returns true for valid HTTP URL', () => {
    expect(isValidUrl('http://api.revenium.ai')).toBe(true);
  });

  it('returns false for invalid URL', () => {
    expect(isValidUrl('not-a-url')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidUrl('')).toBe(false);
  });
});
