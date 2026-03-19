export interface N8nNodeOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  timeout?: number;
  maxRetries?: number;
  baseURL?: string;
}

export interface N8nMemoryOptions {
  saveToMemory?: boolean;
  includePrevious?: boolean;
  maxMessages?: number;
}

export interface N8nToolOptions {
  toolChoice?: 'auto' | 'none' | 'required';
  maxIterations?: number;
  saveToolCalls?: boolean;
}

export interface N8nMemoryConnection {
  response?: unknown;
}

export interface N8nMemoryWithLoadVariables {
  loadMemoryVariables(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface N8nMemoryWithGetMessages {
  getMessages(): Promise<unknown[]>;
}

export interface N8nMemoryWithSaveContext {
  saveContext(input: Record<string, unknown>, output: Record<string, unknown>): Promise<void>;
}

