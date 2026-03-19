export type AnthropicFinishReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | null;

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface AnthropicTextContent {
  type: 'text';
  text: string;
}

export interface AnthropicToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AnthropicResponseContent =
  | AnthropicTextContent
  | AnthropicToolUseContent;

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicResponseContent[];
  model: string;
  stop_reason: AnthropicFinishReason;
  stop_sequence?: string;
  usage: AnthropicUsage;
}

export interface AnthropicStreamDelta {
  type?: string;
  text?: string;
  stop_reason?: AnthropicFinishReason;
  usage?: Partial<AnthropicUsage>;
}

export interface AnthropicStreamChunk {
  type:
    | 'message_start'
    | 'content_block_start'
    | 'content_block_delta'
    | 'content_block_stop'
    | 'message_delta'
    | 'message_stop';
  message?: Partial<AnthropicResponse>;
  content_block?: AnthropicResponseContent;
  delta?: AnthropicStreamDelta;
  usage?: Partial<AnthropicUsage>;
}

export interface LangChainMessage {
  content: string;
  role?: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  response_metadata?: {
    usage?: AnthropicUsage;
    [key: string]: unknown;
  };
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description: string;
      }>;
      required: string[];
    };
  };
}
