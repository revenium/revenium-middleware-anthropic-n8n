export function buildReveniumUrl(baseUrl: string, endpoint: string): string {
  let normalizedBase = baseUrl.replace(/\/+$/, '');

  const hasMeterV2AtEnd = /\/meter\/v2$/i.test(normalizedBase);
  if (hasMeterV2AtEnd) {
    return `${normalizedBase}${endpoint}`;
  }

  const hasMeterAtEnd = /\/meter$/i.test(normalizedBase);
  if (hasMeterAtEnd) {
    return `${normalizedBase}/v2${endpoint}`;
  }

  const hasV2AtEnd = /\/v2$/i.test(normalizedBase);
  if (hasV2AtEnd) {
    return `${normalizedBase}${endpoint}`;
  }

  return `${normalizedBase}/meter/v2${endpoint}`;
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
