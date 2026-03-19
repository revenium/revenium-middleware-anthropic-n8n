# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-19

### Added

- ReveniumAnthropicChatModel node for n8n
- ReveniumAIAgent node for n8n
- Automatic usage metering to Revenium
- LangChain integration with @langchain/anthropic
- Support for Claude Opus 4, Sonnet 4, Haiku 4, and Claude 3.x models
- Token usage tracking (input, output, cache creation, cache read)
- Cost and performance metrics monitoring
- Fire-and-forget async tracking (non-blocking)
- Circuit breaker for Revenium API resilience
- Tool metering support (meterTool, reportToolCall, setToolContext)
- Streaming support with per-chunk token tracking
- Comprehensive test suite (281 tests across 15 test files)
