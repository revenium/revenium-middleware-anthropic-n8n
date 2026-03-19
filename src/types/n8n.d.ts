declare module '@anthropic-ai/sdk' {
  interface Message {
    id: string;
    model: string;
    content: Array<{
      type: string;
      text?: string;
    }>;
    stop_reason: string | null;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  }
}
