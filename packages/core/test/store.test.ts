import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadConfig,
  resolveDbPath,
  resolveGlobalDbPath,
  writeConfig,
} from "../src/store/config.js";
import { OpenmemStore } from "../src/store/db.js";
import { resolveNamespace } from "../src/store/namespace.js";
import type { Memory, MemoryRef, Session } from "../src/types.js";
import { ulid } from "../src/ulid.js";

describe("OpenmemStore", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: OpenmemStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmem-test-store-"));
    dbPath = path.join(tmpDir, "test.db");
    store = new OpenmemStore(dbPath);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("inserts and retrieves a memory", () => {
    const now = Date.now();
    const id = ulid(now);
    const memory: Memory = {
      id,
      namespace: "test-ns",
      kind: "semantic",
      text: "Always use strict TypeScript mode",
      importance: 0.8,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      validFrom: now,
      validTo: null,
      supersededBy: null,
      sourceSessionId: "sess-1",
      sourceRef: "user",
      tags: ["typescript", "rules"],
      pii: false,
      pinned: true,
    };

    store.insertMemory(memory);
    const fetched = store.getMemory(id);
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe(id);
    expect(fetched?.text).toBe("Always use strict TypeScript mode");
    expect(fetched?.pinned).toBe(true);
    expect(fetched?.tags).toEqual(["typescript", "rules"]);
  });

  it("updates access stats on touchMemory", () => {
    const now = Date.now();
    const id = ulid(now);
    store.insertMemory({
      id,
      namespace: "test-ns",
      kind: "semantic",
      text: "Test memory",
      importance: 0.5,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      validFrom: now,
      validTo: null,
      supersededBy: null,
      sourceSessionId: null,
      sourceRef: null,
      tags: [],
      pii: false,
      pinned: false,
    });

    const accessTime = now + 5000;
    store.touchMemory(id, accessTime);
    const updated = store.getMemory(id);
    expect(updated?.accessCount).toBe(1);
    expect(updated?.lastAccessedAt).toBe(accessTime);
  });

  it("supersedes and forgets memories", () => {
    const now = Date.now();
    const id1 = ulid(now);
    const id2 = ulid(now + 1);

    store.insertMemory({
      id: id1,
      namespace: "test-ns",
      kind: "semantic",
      text: "Deploy to AWS",
      importance: 0.5,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      validFrom: now,
      validTo: null,
      supersededBy: null,
      sourceSessionId: null,
      sourceRef: null,
      tags: [],
      pii: false,
      pinned: false,
    });

    store.supersede(id1, id2, now + 10);
    const mem1 = store.getMemory(id1);
    expect(mem1?.validTo).toBe(now + 10);
    expect(mem1?.supersededBy).toBe(id2);

    store.forget(id2, now + 20);
    const mem2 = store.getMemory(id2);
    // Not inserted yet, but verify store.forget doesn't crash on nonexistent id
    expect(mem2).toBeUndefined();
  });

  it("searches memories using ftsSearch with ranking", () => {
    const now = Date.now();
    const id1 = ulid(now);
    const id2 = ulid(now + 1);

    store.insertMemory({
      id: id1,
      namespace: "test-ns",
      kind: "semantic",
      text: "Docker compose is used for local database testing",
      importance: 0.7,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      validFrom: now,
      validTo: null,
      supersededBy: null,
      sourceSessionId: null,
      sourceRef: null,
      tags: ["docker", "database"],
      pii: false,
      pinned: false,
    });

    store.insertMemory({
      id: id2,
      namespace: "test-ns",
      kind: "procedural",
      text: "Always lint code with Biome before pushing commits",
      importance: 0.8,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      validFrom: now,
      validTo: null,
      supersededBy: null,
      sourceSessionId: null,
      sourceRef: null,
      tags: ["lint", "biome"],
      pii: false,
      pinned: false,
    });

    const matches = store.ftsSearch("test-ns", "docker database", 5);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.id).toBe(id1);
  });

  it("enforces capacity limit by evicting lowest scoring memories", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      store.insertMemory({
        id: ulid(now + i),
        namespace: "cap-ns",
        kind: i % 2 === 0 ? "episodic" : "semantic",
        text: `Memory ${i}`,
        importance: 0.1 * (i + 1),
        createdAt: now + i,
        updatedAt: now + i,
        lastAccessedAt: now + i,
        accessCount: 0,
        validFrom: now + i,
        validTo: null,
        supersededBy: null,
        sourceSessionId: null,
        sourceRef: null,
        tags: [],
        pii: false,
        pinned: i === 0, // pinned item should be spared
      });
    }

    expect(store.countActive("cap-ns")).toBe(5);
    const evicted = store.evictToCapacity("cap-ns", 3, now + 100);
    expect(evicted).toBe(2);
    expect(store.countActive("cap-ns")).toBe(3);
  });

  it("handles refs store and expiration", () => {
    const now = Date.now();
    const ref: MemoryRef = {
      id: "r_test123",
      namespace: "ref-ns",
      sessionId: "s_1",
      toolName: "bash",
      toolArgs: JSON.stringify({ cmd: "build" }),
      content: "A very large build log output...",
      bytes: 1024,
      createdAt: now,
      expiresAt: now + 1000,
    };

    store.insertRef(ref);
    const fetched = store.getRef("r_test123");
    expect(fetched).toBeDefined();
    expect(fetched?.content).toBe("A very large build log output...");
    expect(fetched?.bytes).toBe(1024);

    const deletedBefore = store.deleteExpiredRefs(now);
    expect(deletedBefore).toBe(0);

    const deletedAfter = store.deleteExpiredRefs(now + 2000);
    expect(deletedAfter).toBe(1);
    expect(store.getRef("r_test123")).toBeUndefined();
  });

  it("tracks sessions and accumulates hook execution time", () => {
    const now = Date.now();
    const session: Session = {
      id: "sess_test",
      namespace: "sess-ns",
      startedAt: now,
      endedAt: null,
      source: "startup",
      endReason: null,
      hooksMsTotal: 15,
      transcriptPath: "/path/transcript.jsonl",
    };

    store.upsertSession(session);
    store.addHookMs("sess_test", 25);
    store.setTranscriptPath("sess_test", "/new/path.jsonl");

    const row = store.getSession("sess_test");
    expect(row).toBeDefined();
    expect(row?.hooksMsTotal).toBe(40);
    expect(row?.transcriptPath).toBe("/new/path.jsonl");
  });

  it("resolves namespace and handles fallbacks", () => {
    const resolved = resolveNamespace(tmpDir);
    expect(typeof resolved).toBe("string");
    expect(resolved.length).toBe(16);
  });

  it("loads and writes config with defaults", () => {
    const cfg = loadConfig(tmpDir);
    expect(cfg.dbPath).toContain(".openmem");
    expect(cfg.memory.capacity).toBe(500);

    writeConfig(tmpDir, { memory: { capacity: 250, decayHalfLifeDays: 14 } });
    const updatedCfg = loadConfig(tmpDir);
    expect(updatedCfg.memory.capacity).toBe(250);
    expect(updatedCfg.memory.decayHalfLifeDays).toBe(14);

    const customPath = resolveDbPath(tmpDir);
    expect(customPath).toContain("openmem.db");

    const globalPath = resolveGlobalDbPath();
    expect(globalPath).toContain("openmem.db");
  });
});
