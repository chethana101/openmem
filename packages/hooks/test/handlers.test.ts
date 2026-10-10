import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MemoryManager, OpenmemStore, loadConfig, writeConfig } from "@openmem/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  handleAgentStop,
  handlePostToolUse,
  handlePreCompact,
  handleSessionEnd,
  handleSessionStart,
} from "../src/handlers.js";
import type { NormalizedEvent } from "../src/normalizer.js";

describe("Hook handlers", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmem-test-handlers-"));
    dbPath = path.join(tmpDir, ".openmem", "openmem.db");
    writeConfig(tmpDir, {
      capture: { onStop: true },
      context: {
        compress: true,
        threshold: 200,
        denyList: [],
        refTtlDays: 7,
      },
      memory: {
        capacity: 500,
        decayHalfLifeDays: 30,
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("handleSessionStart injects recalled memories as additionalContext", async () => {
    // Seed a memory in the test DB
    const config = loadConfig(tmpDir);
    const store = new OpenmemStore(config.dbPath);
    const mgr = new MemoryManager(store, config);
    mgr.add({
      text: "Always format code before committing.",
      kind: "procedural",
      importance: 0.9,
    });
    store.close();

    const ev: NormalizedEvent = {
      event: "sessionStart",
      sessionId: "sess_start_1",
      cwd: tmpDir,
      timestamp: Date.now(),
      initialPrompt: "commit formatting",
      casing: "camel",
      raw: {},
    };

    const out = await handleSessionStart(ev);
    expect(out).toHaveProperty("additionalContext");
    expect(out.additionalContext).toContain("<openmem>");
    expect(out.additionalContext).toContain("Always format code before committing.");
  });

  it("handlePostToolUse compresses large outputs and returns success result", async () => {
    const bigOutput = "INFO: log line\n".repeat(50);
    const ev: NormalizedEvent = {
      event: "postToolUse",
      sessionId: "sess_tool_1",
      cwd: tmpDir,
      timestamp: Date.now(),
      toolName: "bash",
      toolArgs: { cmd: "run" },
      toolResultText: bigOutput,
      casing: "camel",
      raw: {},
    };

    const out = await handlePostToolUse(ev);
    expect(out).toHaveProperty("modifiedResult");
    const mod = out.modifiedResult as { resultType: string; textResultForLlm: string };
    expect(mod.resultType).toBe("success");
    expect(mod.textResultForLlm).toContain("[openmem: output truncated from");
  });

  it("handleAgentStop respects stop_hook_active to prevent loops", async () => {
    // First turn: stop_hook_active = false, should block to prompt capture
    const ev1: NormalizedEvent = {
      event: "agentStop",
      sessionId: "sess_stop_1",
      cwd: tmpDir,
      timestamp: Date.now(),
      stopHookActive: false,
      transcriptPath: "/tmp/transcript.jsonl",
      casing: "camel",
      raw: {},
    };

    const out1 = await handleAgentStop(ev1);
    expect(out1.decision).toBe("block");
    expect(out1.reason).toContain("memory_remember");

    // Second turn: stop_hook_active = true, MUST return {}
    const ev2: NormalizedEvent = {
      ...ev1,
      stopHookActive: true,
    };

    const out2 = await handleAgentStop(ev2);
    expect(out2).toEqual({});
  });

  it("handlePreCompact and handleSessionEnd always return plain object", async () => {
    const ev: NormalizedEvent = {
      event: "preCompact",
      sessionId: "sess_comp_1",
      cwd: tmpDir,
      timestamp: Date.now(),
      trigger: "auto",
      casing: "camel",
      raw: {},
    };

    const compOut = await handlePreCompact(ev);
    expect(compOut).toEqual({});

    const endOut = await handleSessionEnd({
      ...ev,
      event: "sessionEnd",
      reason: "user_exit",
    });
    expect(endOut).toEqual({});
  });

  it("fail-safe: handlers never throw on corrupted database or invalid cwd", async () => {
    const corruptEv: NormalizedEvent = {
      event: "sessionStart",
      sessionId: "corrupt_1",
      cwd: "/nonexistent/invalid/directory/path/here",
      timestamp: Date.now(),
      casing: "camel",
      raw: {},
    };

    const res = await handleSessionStart(corruptEv);
    expect(typeof res).toBe("object");
    expect(res).not.toBeNull();
  });
});
