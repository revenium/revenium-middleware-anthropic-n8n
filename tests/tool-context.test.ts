import { describe, it, expect, beforeEach } from "vitest";
import {
  setToolContext,
  getToolContext,
  clearToolContext,
  runWithToolContext,
} from "../src/tool-context.js";

beforeEach(() => {
  clearToolContext();
});

describe("setToolContext", () => {
  it("sets context values", () => {
    setToolContext({ agent: "test-agent" });
    expect(getToolContext()).toEqual({ agent: "test-agent" });
  });

  it("merges with existing context", () => {
    setToolContext({ agent: "test-agent" });
    setToolContext({ traceId: "trace-123" });
    expect(getToolContext()).toEqual({
      agent: "test-agent",
      traceId: "trace-123",
    });
  });

  it("overwrites existing values for same key", () => {
    setToolContext({ agent: "original" });
    setToolContext({ agent: "updated" });
    expect(getToolContext()).toEqual({ agent: "updated" });
  });
});

describe("getToolContext", () => {
  it("returns empty object when no context set", () => {
    expect(getToolContext()).toEqual({});
  });

  it("returns current context values", () => {
    setToolContext({ organizationName: "org", productName: "product" });
    expect(getToolContext()).toEqual({
      organizationName: "org",
      productName: "product",
    });
  });
});

describe("clearToolContext", () => {
  it("clears all context values", () => {
    setToolContext({ agent: "test", traceId: "abc" });
    clearToolContext();
    expect(getToolContext()).toEqual({});
  });

  it("getToolContext returns empty after clear", () => {
    setToolContext({ workflowId: "wf-1", subscriberCredential: "cred" });
    clearToolContext();
    expect(getToolContext()).toEqual({});
  });
});

describe("runWithToolContext - sync", () => {
  it("runs function with context", () => {
    const result = runWithToolContext({ agent: "sync-agent" }, () => "done");
    expect(result).toBe("done");
  });

  it("context is available inside function", () => {
    runWithToolContext({ transactionId: "tx-1" }, () => {
      expect(getToolContext()).toEqual({ transactionId: "tx-1" });
    });
  });

  it("does not leak context outside", () => {
    setToolContext({ agent: "outer" });
    runWithToolContext({ traceId: "inner-trace" }, () => {
      expect(getToolContext()).toEqual({
        agent: "outer",
        traceId: "inner-trace",
      });
    });
    expect(getToolContext()).toEqual({ agent: "outer" });
  });
});

describe("runWithToolContext - async", () => {
  it("runs async function with context", async () => {
    const result = await runWithToolContext(
      { agent: "async-agent" },
      async () => "async-done"
    );
    expect(result).toBe("async-done");
  });

  it("context available inside async function", async () => {
    await runWithToolContext({ productName: "async-product" }, async () => {
      expect(getToolContext()).toEqual({ productName: "async-product" });
    });
  });
});

describe("runWithToolContext - error", () => {
  it("propagates sync errors", () => {
    expect(() =>
      runWithToolContext({}, () => {
        throw new Error("sync failure");
      })
    ).toThrow("sync failure");
  });

  it("propagates async errors", async () => {
    await expect(
      runWithToolContext({}, async () => {
        throw new Error("async failure");
      })
    ).rejects.toThrow("async failure");
  });
});

describe("Nested contexts", () => {
  it("inner runWithToolContext merges with outer context", () => {
    runWithToolContext({ agent: "outer-agent" }, () => {
      runWithToolContext({ traceId: "inner-trace" }, () => {
        expect(getToolContext()).toEqual({
          agent: "outer-agent",
          traceId: "inner-trace",
        });
      });
    });
  });
});
