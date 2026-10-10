import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { OpenmemStore, loadConfig, writeConfig } from "@openmem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TOOLS, handleMcpToolCall } from "../src/server.js";

describe("MCP Server Tools", () => {
  let tmpDir: string;
  let config: ReturnType<typeof loadConfig>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmem-test-mcp-"));
    const dbPath = path.join(tmpDir, ".openmem", "openmem.db");
    writeConfig(tmpDir, {
      capture: { onStop: false },
      context: { compress: true, threshold: 200, denyList: [], refTtlDays: 7 },
      memory: { capacity: 500, decayHalfLifeDays: 30 },
    });
    config = loadConfig(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exposes the 5 required MCP tools with strict schemas", () => {
    const toolNames = TOOLS.map((t) => t.name);
    expect(toolNames).toEqual([
      "memory_remember",
      "memory_recall",
      "memory_forget",
      "memory_list",
      "read_ref",
    ]);

    for (const tool of TOOLS) {
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("executes memory_remember and saves a fact", async () => {
    const res = await handleMcpToolCall(
      "memory_remember",
      {
        text: "Always run Biome linter before committing changes.",
        kind: "procedural",
        importance: 0.8,
      },
      config,
    );

    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.text).toContain("Memory saved with id:");

    // Verify it was saved to the store
    const store = new OpenmemStore(config.dbPath);
    expect(store.countActive(config.namespace)).toBe(1);
    store.close();
  });

  it("executes memory_recall and searches memories", async () => {
    // Seed
    await handleMcpToolCall(
      "memory_remember",
      { text: "We use Postgres 16 for all relational data.", importance: 0.9 },
      config,
    );

    const recallRes = await handleMcpToolCall(
      "memory_recall",
      { query: "Postgres database" },
      config,
    );

    expect(recallRes.isError).toBeFalsy();
    expect(recallRes.content[0]?.text).toContain("<openmem>");
    expect(recallRes.content[0]?.text).toContain("Postgres 16");
  });

  it("executes memory_list and returns stored memories", async () => {
    await handleMcpToolCall(
      "memory_remember",
      { text: "Rule 1: keep functions small", kind: "procedural" },
      config,
    );

    const listRes = await handleMcpToolCall("memory_list", {}, config);
    expect(listRes.isError).toBeFalsy();
    expect(listRes.content[0]?.text).toContain("Rule 1: keep functions small");
  });

  it("executes memory_forget and marks memory forgotten", async () => {
    const rememberRes = await handleMcpToolCall(
      "memory_remember",
      { text: "Outdated configuration option" },
      config,
    );

    const match = /id:\s*([A-Za-z0-9]+)/.exec(rememberRes.content[0]?.text ?? "");
    const id = match?.[1];
    expect(id).toBeDefined();

    const forgetRes = await handleMcpToolCall("memory_forget", { id }, config);
    expect(forgetRes.isError).toBeFalsy();
    expect(forgetRes.content[0]?.text).toBe("Memory forgotten.");

    const store = new OpenmemStore(config.dbPath);
    expect(store.countActive(config.namespace)).toBe(0);
    store.close();
  });

  it("executes read_ref to retrieve full truncated output", async () => {
    // Store a ref manually
    const store = new OpenmemStore(config.dbPath);
    store.insertRef({
      id: "r_test_ref",
      namespace: config.namespace,
      sessionId: "s_1",
      toolName: "bash",
      toolArgs: null,
      content: "line 1\nline 2\nline 3\nline 4\nline 5",
      bytes: 35,
      createdAt: Date.now(),
      expiresAt: null,
    });
    store.close();

    // Read full ref
    const fullRes = await handleMcpToolCall("read_ref", { id: "r_test_ref" }, config);
    expect(fullRes.content[0]?.text).toBe("line 1\nline 2\nline 3\nline 4\nline 5");

    // Read sliced range
    const sliceRes = await handleMcpToolCall(
      "read_ref",
      { id: "r_test_ref", start: 2, end: 4 },
      config,
    );
    expect(sliceRes.content[0]?.text).toBe("line 2\nline 3\nline 4");
  });

  it("handles unknown tool gracefully", async () => {
    const res = await handleMcpToolCall("nonexistent_tool", {}, config);
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Unknown tool");
  });
});
