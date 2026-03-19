export function validateApiKey(apiKey: unknown, keyType: string = 'API key'): boolean {
  if (typeof apiKey !== 'string') {
    throw new Error(`Invalid ${keyType}: must be a string`);
  }

  const trimmedKey = apiKey.trim();
  if (trimmedKey.length === 0) {
    throw new Error(`Invalid ${keyType}: cannot be empty`);
  }

  if (trimmedKey.length < 20) {
    throw new Error(`Invalid ${keyType}: API key appears too short (minimum 20 characters)`);
  }

  const placeholders = ['your-api-key', 'api-key-here', 'replace-me', 'test', 'demo', 'example'];
  if (placeholders.some(placeholder => trimmedKey.toLowerCase().includes(placeholder))) {
    throw new Error(`Invalid ${keyType}: API key appears to be a placeholder value`);
  }

  return true;
}

export function validateSecureUrl(url: unknown, allowHttp: boolean = false): boolean {
  if (typeof url !== 'string') {
    throw new Error('Invalid URL: must be a string');
  }

  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    throw new Error('Invalid URL: cannot be empty');
  }

  try {
    const parsedUrl = new URL(trimmedUrl);

    if (!allowHttp && parsedUrl.protocol !== 'https:') {
      throw new Error('Invalid URL: must use HTTPS protocol for security');
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Invalid URL: must use HTTP or HTTPS protocol');
    }

    return true;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Invalid URL format: ${error.message}`);
    }
    throw error;
  }
}

export function validateModelName(modelName: unknown): boolean {
  if (typeof modelName !== 'string') {
    throw new Error('Invalid model name: must be a string');
  }

  const trimmed = modelName.trim();
  if (trimmed.length === 0) {
    throw new Error('Invalid model name: cannot be empty');
  }

  if (trimmed.length > 100) {
    throw new Error('Invalid model name: too long (maximum 100 characters)');
  }

  return true;
}

export function validateNumericParameter(
  value: unknown,
  paramName: string,
  min: number,
  max: number,
  allowUndefined: boolean = false
): boolean {
  if (value === undefined || value === null) {
    if (allowUndefined) return true;
    throw new Error(`Invalid ${paramName}: parameter is required`);
  }

  if (typeof value !== 'number') {
    throw new Error(`Invalid ${paramName}: must be a number`);
  }

  if (isNaN(value) || !isFinite(value)) {
    throw new Error(`Invalid ${paramName}: must be a finite number`);
  }

  if (value < min || value > max) {
    throw new Error(`Invalid ${paramName}: must be between ${min} and ${max}`);
  }

  return true;
}

export function validateTimeout(timeout: unknown, allowUndefined: boolean = true): boolean {
  if (timeout === undefined || timeout === null) {
    if (allowUndefined) return true;
    throw new Error('Invalid timeout: parameter is required');
  }

  if (typeof timeout !== 'number') {
    throw new Error('Invalid timeout: must be a number (milliseconds)');
  }

  if (isNaN(timeout) || !isFinite(timeout)) {
    throw new Error('Invalid timeout: must be a finite number');
  }

  if (timeout < 0) {
    throw new Error('Invalid timeout: cannot be negative');
  }

  if (timeout > 24 * 60 * 60 * 1000) {
    throw new Error('Invalid timeout: cannot exceed 24 hours');
  }

  return true;
}

export function hasValidSchema(obj: unknown): obj is { schema: Record<string, unknown> } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'schema' in obj &&
    typeof (obj as { schema: Record<string, unknown> }).schema === 'object' &&
    (obj as { schema: Record<string, unknown> }).schema !== null
  );
}

export function hasToolSchemaStructure(obj: unknown): obj is {
  properties?: Record<string, { type: string; description: string }>;
  required?: string[];
} {
  if (typeof obj !== 'object' || obj === null) return false;

  const typedObj = obj as { properties?: Record<string, { type: string; description: string }>; required?: string[] };

  if("properties" in typedObj && typeof typedObj.properties !== 'object' || typedObj.properties === null) return false;
  if ('required' in typedObj && !Array.isArray(typedObj.required)) return false;

  return true;
}

export function hasValidId(obj: unknown): obj is { id: string } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    typeof (obj as { id: string }).id === 'string'
  );
}

export function hasValidMessage(obj: unknown): obj is { message: string } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'message' in obj &&
    typeof (obj as { message: string }).message === 'string'
  );
}

export function isN8nMemoryConnection(obj: unknown): obj is { response?: unknown } {
  return (
    typeof obj === 'object' &&
    obj !== null
  );
}

export function hasLoadMemoryVariables(obj: unknown): obj is { loadMemoryVariables: (input: Record<string, unknown>) => Promise<Record<string, unknown>> } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'loadMemoryVariables' in obj &&
    typeof (obj as { loadMemoryVariables: (input: Record<string, unknown>) => Promise<Record<string, unknown>> }).loadMemoryVariables === 'function'
  );
}

export function hasGetMessages(obj: unknown): obj is { getMessages: () => Promise<unknown[]> } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'getMessages' in obj &&
    typeof (obj as { getMessages: () => Promise<unknown[]> }).getMessages === 'function'
  );
}

export function hasSaveContext(obj: unknown): obj is { saveContext: (input: Record<string, unknown>, output: Record<string, unknown>) => Promise<void> } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'saveContext' in obj &&
    typeof (obj as { saveContext: (input: Record<string, unknown>, output: Record<string, unknown>) => Promise<void> }).saveContext === 'function'
  );
}

export function isHistoryMessage(obj: unknown): obj is { role: string; content: string } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'role' in obj &&
    'content' in obj &&
    typeof (obj as { role: string }).role === 'string' &&
    typeof (obj as { content: string }).content === 'string'
  );
}

export function isLangChainMessage(obj: unknown): obj is { _getType: () => string; content: string } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    '_getType' in obj &&
    'content' in obj &&
    typeof (obj as any).content === 'string'
  );
}

export function hasUsageMetadata(obj: unknown): obj is { usage_metadata: Record<string, unknown> } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'usage_metadata' in obj &&
    typeof (obj as { usage_metadata: Record<string, unknown> }).usage_metadata === 'object'
  );
}

export function hasTokenUsage(obj: unknown): obj is {
  prompt_tokens?: number;
  promptTokens?: number;
  input_tokens?: number;
  completion_tokens?: number;
  completionTokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  totalTokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
  output_token_details?: {
    reasoning?: number;
  };
} {
  return (
    typeof obj === 'object' &&
    obj !== null
  );
}
