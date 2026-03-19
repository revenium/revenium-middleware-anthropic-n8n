import { AsyncLocalStorage } from "async_hooks";
import { ToolContext } from "./types/tool-metering.js";

const contextStorage = new AsyncLocalStorage<ToolContext>();

export function setToolContext(ctx: ToolContext): void {
  const current = contextStorage.getStore() ?? {};
  contextStorage.enterWith({ ...current, ...ctx });
}

export function getToolContext(): ToolContext {
  return contextStorage.getStore() ?? {};
}

export function clearToolContext(): void {
  contextStorage.enterWith({});
}

export function runWithToolContext<T>(
  ctx: ToolContext,
  fn: () => T | Promise<T>
): T | Promise<T> {
  const merged = { ...getToolContext(), ...ctx };
  return contextStorage.run(merged, fn);
}
