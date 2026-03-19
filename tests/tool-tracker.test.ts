import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearToolContext, setToolContext } from "../src/tool-context.js";

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    critical: vi.fn(),
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

let originalEnv: NodeJS.ProcessEnv;

import { meterTool, reportToolCall } from "../src/tool-tracker.js";

describe("Tool Tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearToolContext();
    originalEnv = { ...process.env };
    process.env.REVENIUM_METERING_API_KEY = "test-api-key-for-metering";
    process.env.REVENIUM_METERING_BASE_URL = "https://api.revenium.ai";
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(""),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  describe("meterTool - sync function", () => {
    it("returns the function result", async () => {
      const result = await meterTool("sync-tool", () => "sync-result");
      expect(result).toBe("sync-result");
    });

    it("dispatches tool event via fetch", async () => {
      await meterTool("sync-tool", () => "result");
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("payload has correct toolId, success, and middlewareSource", async () => {
      await meterTool("my-tool", () => "result");
      await new Promise((resolve) => setImmediate(resolve));

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.toolId).toBe("my-tool");
      expect(payload.success).toBe(true);
      expect(payload.middlewareSource).toBe("revenium-anthropic-n8n");
    });

    it("payload has durationMs >= 0", async () => {
      await meterTool("timed-tool", () => "done");
      await new Promise((resolve) => setImmediate(resolve));

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("meterTool - async function", () => {
    it("returns the async result", async () => {
      const result = await meterTool("async-tool", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "async-result";
      });

      expect(result).toBe("async-result");
    });

    it("dispatches event after resolution", async () => {
      await meterTool("async-tool", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "done";
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.toolId).toBe("async-tool");
      expect(payload.success).toBe(true);
    });
  });

  describe("meterTool - error handling", () => {
    it("re-throws sync errors", async () => {
      const error = new Error("sync failure");

      await expect(
        meterTool("failing-tool", () => {
          throw error;
        })
      ).rejects.toBe(error);
    });

    it("re-throws async errors", async () => {
      const error = new Error("async failure");

      await expect(
        meterTool("async-failing", async () => {
          throw error;
        })
      ).rejects.toBe(error);
    });

    it("dispatches event with success false and errorMessage", async () => {
      try {
        await meterTool("error-tool", () => {
          throw new Error("tracked failure");
        });
      } catch {}

      await new Promise((resolve) => setImmediate(resolve));

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.success).toBe(false);
      expect(payload.errorMessage).toBe("tracked failure");
    });
  });

  describe("meterTool - metadata", () => {
    it("includes operation in payload", async () => {
      await meterTool("op-tool", () => "result", {
        operation: "custom-operation",
      });
      await new Promise((resolve) => setImmediate(resolve));

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.operation).toBe("custom-operation");
    });

    it("includes transactionId from metadata", async () => {
      await meterTool("tx-tool", () => "result", {
        transactionId: "meta-tx-123",
      });
      await new Promise((resolve) => setImmediate(resolve));

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.transactionId).toBe("meta-tx-123");
    });

    it("includes usageMetadata", async () => {
      await meterTool("usage-tool", () => "result", {
        usageMetadata: { tokens: 100, model: "claude-3" },
      });
      await new Promise((resolve) => setImmediate(resolve));

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.usageMetadata).toEqual({ tokens: 100, model: "claude-3" });
    });

    it("uses context transactionId when metadata does not provide one", async () => {
      setToolContext({ transactionId: "ctx-tx-456" });

      await meterTool("ctx-tx-tool", () => "result");
      await new Promise((resolve) => setImmediate(resolve));

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.transactionId).toBe("ctx-tx-456");
    });
  });

  describe("meterTool - outputFields", () => {
    it("extracts specified fields from result into usageMetadata", async () => {
      await meterTool(
        "output-tool",
        () => ({ total: 42, name: "test", extra: "ignored" }),
        { outputFields: ["total", "name"] }
      );
      await new Promise((resolve) => setImmediate(resolve));

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.usageMetadata).toEqual({ total: 42, name: "test" });
    });

    it("ignores missing fields", async () => {
      await meterTool(
        "partial-output-tool",
        () => ({ present: "yes" }),
        { outputFields: ["present", "absent"] }
      );
      await new Promise((resolve) => setImmediate(resolve));

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.usageMetadata).toEqual({ present: "yes" });
    });
  });

  describe("meterTool - context integration", () => {
    it("uses tool context values", async () => {
      setToolContext({
        agent: "context-agent",
        organizationName: "context-org",
        productName: "context-product",
        traceId: "context-trace",
      });

      await meterTool("ctx-tool", () => "result");
      await new Promise((resolve) => setImmediate(resolve));

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.agent).toBe("context-agent");
      expect(payload.organizationName).toBe("context-org");
      expect(payload.productName).toBe("context-product");
      expect(payload.traceId).toBe("context-trace");
    });

    it("metadata overrides context values", async () => {
      setToolContext({ agent: "context-agent", organizationName: "context-org" });

      await meterTool("override-tool", () => "result", {
        agent: "metadata-agent",
      });
      await new Promise((resolve) => setImmediate(resolve));

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.agent).toBe("metadata-agent");
      expect(payload.organizationName).toBe("context-org");
    });
  });

  describe("meterTool - no config", () => {
    it("does not call fetch when REVENIUM_METERING_API_KEY is not set", async () => {
      delete process.env.REVENIUM_METERING_API_KEY;

      await meterTool("no-key-tool", () => "result");
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("reportToolCall", () => {
    it("dispatches event with report data", async () => {
      reportToolCall("reported-tool", {
        durationMs: 150,
        success: true,
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.toolId).toBe("reported-tool");
      expect(payload.middlewareSource).toBe("revenium-anthropic-n8n");
    });

    it("includes custom timestamp when provided", async () => {
      const customTimestamp = "2025-06-15T12:00:00.000Z";

      reportToolCall("ts-reported", {
        durationMs: 200,
        success: true,
        timestamp: customTimestamp,
      });
      await new Promise((resolve) => setImmediate(resolve));

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.timestamp).toBe(customTimestamp);
    });

    it("payload has correct toolId, success, and durationMs from report", async () => {
      reportToolCall("detail-tool", {
        durationMs: 300,
        success: false,
        errorMessage: "report error",
      });
      await new Promise((resolve) => setImmediate(resolve));

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.toolId).toBe("detail-tool");
      expect(payload.success).toBe(false);
      expect(payload.durationMs).toBe(300);
      expect(payload.errorMessage).toBe("report error");
    });
  });

  describe("Payload structure", () => {
    it("URL is correct", async () => {
      await meterTool("url-tool", () => "result");
      await new Promise((resolve) => setImmediate(resolve));

      const url = mockFetch.mock.calls[0][0];
      expect(url).toBe("https://api.revenium.ai/meter/v2/tool/events");
    });

    it("headers include x-api-key and Content-Type", async () => {
      await meterTool("header-tool", () => "result");
      await new Promise((resolve) => setImmediate(resolve));

      const options = mockFetch.mock.calls[0][1];
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.headers["x-api-key"]).toBe("test-api-key-for-metering");
    });
  });
});
