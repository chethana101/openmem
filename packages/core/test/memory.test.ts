import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryManager } from "../src/memory/manager.js";
import { OpenmemStore } from "../src/store/db.js";
import { DEFAULT_CONFIG } from "../src/types.js";
import type { OpenmemConfig } from "../src/types.js";

describe("MemoryManager", () => {
  let tmpDir: string;
  let store: OpenmemStore;
  let config: OpenmemConfig;
  let mgr: MemoryManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmem-test-mgr-"));
    const dbPath = path.join(tmpDir, "test.db");
    store = new OpenmemStore(dbPath);
    config = {
      ...DEFAULT_CONFIG,
      dbPath,
      namespace: "test-ns",
    };
    mgr = new MemoryManager(store, config);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("adds and recalls memory within budget", () => {
    const id = mgr.add({
      text: "Always use Vitest instead of Jest for new test suites.",
      kind: "procedural",
      importance: 0.9,
      pin: true,
    });

    expect(id).toBeDefined();

    const result = mgr.recall({
      query: "Vitest test suite",
      namespace: "test-ns",
      k: 5,
    });

    expect(result.memories.length).toBe(1);
    expect(result.memories[0]?.id).toBe(id);
    expect(result.formattedBlock).toContain("<openmem>");
    expect(result.formattedBlock).toContain("Always use Vitest instead of Jest");
    expect(result.formattedBlock).toContain("</openmem>");
  });

  it("handles explicit supersession via replaces", () => {
    const id1 = mgr.add({
      text: "We use npm workspaces.",
      kind: "semantic",
      importance: 0.8,
    });

    const id2 = mgr.add({
      text: "We migrated to pnpm workspaces; do not use npm.",
      kind: "semantic",
      importance: 0.9,
      replaces: id1,
    });

    const active = mgr.list({ namespace: "test-ns" });
    expect(active.length).toBe(1);
    expect(active[0]?.id).toBe(id2);

    const history = mgr.list({ namespace: "test-ns", includeHistory: true });
    expect(history.length).toBe(2);
    const old = history.find((m) => m.id === id1);
    expect(old?.validTo).not.toBeNull();
    expect(old?.supersededBy).toBe(id2);
  });

  it("redacts credentials automatically during add", () => {
    const id = mgr.add({
      text: "Connect to api using sk-123456789012345678901234567890 and port 8080",
    });

    const mem = store.getMemory(id);
    expect(mem?.text).toBe("Connect to api using [REDACTED] and port 8080");
  });

  it("respects character budget in recall", () => {
    // Add 10 memories
    for (let i = 0; i < 10; i++) {
      mgr.add({
        text: `Long detailed guideline number ${i}: ${"a".repeat(100)}`,
        importance: 0.5,
      });
    }

    const budget = 250;
    const result = mgr.recall({
      query: "guideline",
      namespace: "test-ns",
      charBudget: budget,
      k: 10,
    });

    let totalChars = 0;
    for (const m of result.memories) totalChars += m.text.length;
    expect(totalChars).toBeLessThanOrEqual(budget);
  });

  it("forgets individual memory and forgetAll", () => {
    const id1 = mgr.add({ text: "Fact 1" });
    const id2 = mgr.add({ text: "Fact 2" });

    expect(mgr.list({ namespace: "test-ns" }).length).toBe(2);

    const forgot1 = mgr.forget(id1, "test-ns");
    expect(forgot1).toBe(true);
    expect(mgr.list({ namespace: "test-ns" }).length).toBe(1);

    const forgotCount = mgr.forgetAll("test-ns");
    expect(forgotCount).toBe(1);
    expect(mgr.list({ namespace: "test-ns" }).length).toBe(0);
  });

  it("measures recall latency under 20ms", () => {
    for (let i = 0; i < 50; i++) {
      mgr.add({
        text: `Repository convention #${i}: ensure coverage exceeds threshold.`,
        importance: 0.6,
      });
    }

    const t0 = performance.now();
    mgr.recall({
      query: "convention coverage",
      namespace: "test-ns",
      k: 8,
    });
    const durationMs = performance.now() - t0;
    expect(durationMs).toBeLessThan(20);
  });
});
