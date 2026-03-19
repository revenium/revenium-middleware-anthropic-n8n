# Revenium Anthropic AI Agent for n8n

[![npm version](https://img.shields.io/npm/v/n8n-nodes-revenium-anthropic.svg)](https://www.npmjs.com/package/n8n-nodes-revenium-anthropic)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![n8n](https://img.shields.io/badge/n8n-community%20node-orange)](https://n8n.io)
[![Documentation](https://img.shields.io/badge/docs-revenium.io-blue)](https://docs.revenium.io)
[![Website](https://img.shields.io/badge/website-revenium.ai-blue)](https://www.revenium.ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Drop-in replacement for n8n AI Agent with automatic Revenium usage tracking for Anthropic Claude models**

A drop-in replacement for the standard n8n AI Agent with all the same capabilities, plus automatic AI cost tracking powered by [Revenium](https://www.revenium.ai). Track costs by customer, agent, or task. Enable usage-based billing and spending alerts to ensure you're never surprised by unexpected AI costs.

## Overview

This custom node provides seamless integration between Anthropic's Claude API and Revenium's AI cost tracking & alerting platform. Track AI costs in n8n by customer, agent, task, and more. Extend cost-tracking into usage-based billing with automatic Stripe integration.

## Features

- **Anthropic Claude Integration**: Full support for Claude Opus 4, Sonnet 4, Haiku 4, and Claude 3.x models
- **Automatic Revenium Tracking**: Fire-and-forget usage tracking with Revenium
- **Token Usage Monitoring**: Tracks input tokens, output tokens, cache creation tokens, and cache read tokens
- **Cost & Performance Metrics**: Monitors request duration, time to first token, and response times
- **Streaming Support**: Full streaming support with per-chunk token tracking
- **Transparent Workflow Integration**: Returns Anthropic responses immediately while tracking usage asynchronously

## Architecture

```
src/
  constants/          Timeouts, limits, stop reason mappings, circuit breaker config
  services/
    anthropic/        AnthropicService - model loading, validation, formatting
    revenium/         ReveniumService  - usage tracking, payload building, API calls
  types/              TypeScript interfaces for API, Anthropic, n8n, tool metering
  utils/
    batching/         Request batching with circuit breaker pattern
    error-handling/   ReveniumError, sanitization, safe stringify
    validation/       API key, URL, model, parameter, and type guard validators
    logger.ts         Leveled logger (debug/info/warning/error/critical)
    prompt-extraction.ts  Prompt capture and sanitization
    summary-printer.ts    Human-readable and JSON usage summaries
    url-builder.ts        Revenium API URL normalization
  tool-context.ts     AsyncLocalStorage-based context for tool execution
  tool-tracker.ts     Tool event metering and reporting

nodes/
  ReveniumAnthropicChatModel/   Chat model node (extends ChatAnthropic)
  ReveniumAIAgent/              AI Agent node with memory and tool support

credentials/
  ReveniumAnthropic.credentials.ts   n8n credential type definition

tests/
  error-handling.test.ts              Error utilities (27 tests)
  validation.test.ts                  Validators and type guards (51 tests)
  utils.test.ts                       Stop reasons, timestamps, headers (29 tests)
  tool-tracker.test.ts                Tool metering and reporting (23 tests)
  tool-context.test.ts                AsyncLocalStorage context (15 tests)
  circuit-breaker.test.ts             Batch retry and circuit breaker (10 tests)
  subscriber-metadata.test.ts         Subscriber object building (10 tests)
  summary-printer.test.ts             Usage summary formatting (17 tests)
  url-builder.test.ts                 URL normalization (12 tests)
  anthropic-service.test.ts           Model loading and formatting (20 tests)
  revenium-service.test.ts            Usage tracking service (28 tests)
  integration/
    setup.ts                          Shared mocks and test utilities
    revenium-anthropic-chat-model.integration.test.ts   (12 tests)
    revenium-ai-agent.integration.test.ts               (9 tests)
    revenium-api.integration.test.ts                    (13 tests)
    end-to-end-workflow.integration.test.ts             (5 tests)
```

## Quick Start

### Installation

For detailed instructions, see the [official n8n community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

#### Method 1: [GUI Installation](https://docs.n8n.io/integrations/community-nodes/installation/gui-install/) (Recommended)

1. Go to **Settings** > **Community Nodes**
2. Select **Install**
3. Enter the npm package name: `n8n-nodes-revenium-anthropic`
4. Agree to the risks of installing unverified community nodes
5. Select **Install**
6. Search for "Revenium" in the node panel

#### Method 2: Manual Installation

```bash
cd ~/.n8n/custom
npm install n8n-nodes-revenium-anthropic
# Restart n8n
```

See [manual installation guide](https://docs.n8n.io/integrations/community-nodes/installation/manual-install/) for details.

#### Method 3: Docker Deployment

```dockerfile
FROM n8nio/n8n:latest
USER root
RUN npm install -g n8n-nodes-revenium-anthropic
USER node
```

**Note**: Community node installation from npm is only available on self-hosted n8n instances.

### Verify Installation

After installation, verify the nodes are available:

1. **Restart n8n** (if not done automatically)
2. **Open n8n** in your browser
3. **Search for "Revenium"** in the node panel
4. **You should see**:
   - **Revenium AI Agent** (drop-in replacement for n8n AI Agent)
   - **Revenium Anthropic Chat Model** (with automatic usage tracking)

## Configuration

### Credentials Setup

#### Required Credentials

1. **Anthropic API Key**:
   - Get from [Anthropic Console](https://console.anthropic.com/)
   - Must start with `sk-ant-`
   - Ensure it has access to the models you want to use

2. **Revenium API Key**:
   - Sign up at [Revenium](https://www.revenium.ai) for AI cost tracking
   - Get your API key from the Revenium dashboard
   - Free tier available for getting started

#### Setting Up Credentials in n8n

1. **Go to**: n8n > Credentials > Add Credential
2. **Search for**: "Revenium Anthropic"
3. **Enter**:
   - **Anthropic API Key**: Your Anthropic key (starts with `sk-ant-`)
   - **Anthropic Base URL**: Leave default (`https://api.anthropic.com`) unless using a custom endpoint
   - **Revenium API Key**: Your Revenium key
   - **Revenium Metering Base URL**: Leave default (`https://api.revenium.ai`) unless using a custom instance
   - **Print Summary**: Optional - `human` for readable output, `json` for structured output
   - **Team ID**: Optional - enables cost retrieval in usage summaries

### Node Parameters

The Revenium Anthropic AI Agent is a drop-in replacement for the standard n8n AI Agent. It has the same parameters and functionality, with the addition of Revenium credentials to enable metadata tracking for all AI operations.

## Usage

### Quick Setup for Chat Conversations

1. **Add a Chat Trigger**: Search for "When chat message received" and add it to your workflow
2. **Add Revenium AI Agent**: Search for "Revenium AI Agent" and connect it to the Chat Trigger
3. **Add Revenium Anthropic Chat Model**: Connect it to the "Chat Model*" input on the AI Agent
4. **Configure credentials**: Set up your Anthropic and Revenium API keys in the Chat Model
5. **Activate workflow**: Your AI Agent is now ready for chat conversations

### What You Get

- **Automatic chat handling**: Users send messages, Claude responds intelligently
- **Transparent Revenium tracking**: All Anthropic usage automatically tracked in background
- **Memory support**: Add a Memory node to maintain conversation history
- **Tool integration**: Connect Tools for enhanced AI capabilities (Calculator, Wikipedia, etc.)
- **Cache token tracking**: Native Anthropic prompt caching metrics (creation and read tokens)

### Workflow Structure

```
When chat message received > Revenium AI Agent > [Response to user]
                                   |
                          Revenium Anthropic Chat Model
                                   |
                               [Memory] (optional)
                                   |
                                [Tools] (optional)
```

## Output

The Revenium AI Agent returns:

```json
{
  "response": "The AI response content",
  "message": "The AI response content",
  "full_response": {},
  "tool_calls": [],
  "revenium_tracking": "Chat model automatically tracked via Revenium Anthropic Chat Model",
  "conversation_saved": true,
  "tools_executed": 0
}
```

### Revenium Tracking Payload

Each API call sends the following to Revenium:

```json
{
  "provider": "ANTHROPIC",
  "middlewareSource": "n8n",
  "model": "claude-sonnet-4-20250514",
  "operationType": "CHAT",
  "costType": "AI",
  "stopReason": "END",
  "inputTokenCount": 25,
  "outputTokenCount": 15,
  "totalTokenCount": 40,
  "cacheCreationTokenCount": 0,
  "cacheReadTokenCount": 0,
  "reasoningTokenCount": 0,
  "requestDuration": 1500,
  "timeToFirstToken": 200,
  "isStreamed": false,
  "subscriber": {
    "id": "customer-123",
    "email": "customer@example.com"
  }
}
```

### Stop Reason Mapping

| Anthropic Stop Reason | Revenium Stop Reason |
|-----------------------|----------------------|
| `end_turn`            | `END`                |
| `max_tokens`          | `TOKEN_LIMIT`        |
| `stop_sequence`       | `END_SEQUENCE`       |
| `tool_use`            | `END`                |

## Tool Metering

Track execution of custom tools and external API calls with automatic timing, error handling, and metadata collection.

### Quick Example

```typescript
import { meterTool, setToolContext } from "n8n-nodes-revenium-anthropic";

setToolContext({
  agent: "my-agent",
  traceId: "session-123"
});

const result = await meterTool("weather-api", async () => {
  return await fetch("https://api.example.com/weather");
}, {
  operation: "get_forecast",
  outputFields: ["temperature", "humidity"]
});
```

### Functions

**meterTool(toolId, fn, metadata?)**
- Wraps a function with automatic metering
- Captures duration, success/failure, and errors
- Returns function result unchanged
- Sends events to Revenium with `middlewareSource: "revenium-anthropic-n8n"`

**reportToolCall(toolId, report)**
- Manually report a tool call that was already executed
- Useful when wrapping isn't possible

**Context Management**
- `setToolContext(ctx)` - Set context for all subsequent tool calls
- `getToolContext()` - Get current context
- `clearToolContext()` - Clear context
- `runWithToolContext(ctx, fn)` - Run function with scoped context

### Metadata Options

| Field | Description |
|-------|-------------|
| `operation` | Tool operation name (e.g., "search", "scrape") |
| `outputFields` | Array of field names to auto-extract from result |
| `usageMetadata` | Custom metrics (e.g., tokens, results count) |
| `agent` | Agent identifier |
| `traceId` | Trace/session identifier |
| `organizationName` | Organization for billing |
| `productName` | Product for billing |
| `subscriberCredential` | Subscriber credential value |
| `workflowId` | n8n workflow identifier |

## Testing

The project includes a comprehensive test suite with 281 tests across 15 test files.

### Running Tests

```bash
# All tests
npm run test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# All (unit + integration)
npm run test:all

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Test Structure

| Suite | Tests | Description |
|-------|-------|-------------|
| `error-handling` | 27 | Error creation, message extraction, sanitization |
| `validation` | 51 | API keys, URLs, models, parameters, type guards |
| `utils` | 29 | Stop reasons, timestamps, correlation IDs, headers, rate limiting |
| `tool-tracker` | 23 | Sync/async metering, error capture, metadata, output fields |
| `tool-context` | 15 | AsyncLocalStorage context management, scoping, nesting |
| `circuit-breaker` | 10 | Batch retry, circuit breaker states, payload structure |
| `subscriber-metadata` | 10 | camelCase/snake_case subscriber building |
| `summary-printer` | 17 | Human/JSON formatting, metrics fetching, cost display |
| `url-builder` | 12 | URL normalization for /meter/v2 endpoints |
| `anthropic-service` | 20 | Model loading, filtering, priority sorting, formatting |
| `revenium-service` | 28 | Usage tracking, token extraction, stop reason mapping |
| **Integration** | **39** | **End-to-end workflows, API payloads, error codes, credential validation** |

## Development

### Prerequisites

- Node.js >= 18
- npm

### Setup

```bash
npm install
npm run build
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript and build icons |
| `npm run dev` | Watch mode for development |
| `npm run lint` | Run ESLint |
| `npm run lintfix` | Auto-fix ESLint issues |
| `npm run format` | Format with Prettier |
| `npm run test` | Run all tests |
| `npm run test:all` | Run unit + integration tests |

## Troubleshooting

### Node Not Appearing in n8n

1. **Restart n8n** after installation
2. **Hard refresh your browser** (Ctrl+Shift+R / Cmd+Shift+R)
3. **Check installation**: In n8n > Settings > Community Nodes
4. **Verify package**: `npm list n8n-nodes-revenium-anthropic` in your n8n directory

### Anthropic API Errors

- Verify your Anthropic API key is valid and starts with `sk-ant-`
- Check the model name matches Anthropic's available models
- Ensure your API key has access to the selected model
- Check your Anthropic account has sufficient credits

### Revenium Tracking Issues

- **Verify credentials**: Check your Revenium API key is correct
- **Check connectivity**: Ensure n8n can reach `https://api.revenium.ai`
- **Review logs**: Check n8n logs for Revenium API error messages
- **Test separately**: Verify your Revenium API key works outside n8n
- **Note**: Tracking failures are non-blocking and will not affect your AI responses

### Getting Help

- **Documentation**: [Revenium Documentation](https://docs.revenium.io)
- **Support**: Contact Revenium support for API key or tracking issues
- **Community**: [n8n Community Forum](https://community.n8n.io) for general n8n questions

## Documentation

For detailed documentation, visit [docs.revenium.io](https://docs.revenium.io)

## Security

Report security vulnerabilities to **support@revenium.io** (do not create public issues).

## License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/revenium/revenium-middleware-anthropic-n8n/blob/HEAD/LICENSE) file for details.

## Support

For issues, feature requests, or contributions:

- **Website**: [www.revenium.ai](https://www.revenium.ai)
- **GitHub Repository**: [revenium/revenium-middleware-anthropic-n8n](https://github.com/revenium/revenium-middleware-anthropic-n8n)
- **Issues**: [Report bugs or request features](https://github.com/revenium/revenium-middleware-anthropic-n8n/issues)
- **Documentation**: [docs.revenium.io](https://docs.revenium.io)
- **Email**: support@revenium.io

---

**Built by Revenium**
