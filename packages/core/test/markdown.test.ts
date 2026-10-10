import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportMarkdown, importMarkdown, writeMarkdownFile } from "../src/export/markdown.js";
import { OpenmemStore } from "../src/store/db.js";
import type { Memory } from "../src/types.js";
import { ulid } from "../src/ulid.js";

describe("Markdown export and import", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: OpenmemStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmem-test-md-"));
    dbPath = path.join(tmpDir, "test.db");
    store = new OpenmemStore(dbPath);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exports and imports round-trip preserving memory IDs", () => {
    const now = Date.now();
    const id1 = ulid(now);
    const id2 = ulid(now + 1);

    const mem1: Memory = {
      id: id1,
      namespace: "ns-md",
      kind: "semantic",
      text: "Primary database is Postgres 16",
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
      tags: [],
      pii: false,
      pinned: true,
    };

    const mem2: Memory = {
      id: id2,
      namespace: "ns-md",
      kind: "procedural",
      text: "Run migration scripts before starting backend",
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
      tags: [],
      pii: false,
      pinned: false,
    };

    store.insertMemory(mem1);
    store.insertMemory(mem2);

    const exportedMd = exportMarkdown([mem1, mem2]);
    expect(exportedMd).toContain("## Semantic");
    expect(exportedMd).toContain("## Procedural");
    expect(exportedMd).toContain(`[id:${id1}] (imp 0.8) 📌 Primary database is Postgres 16`);
    expect(exportedMd).toContain(
      `[id:${id2}] (imp 0.7) Run migration scripts before starting backend`,
    );

    const mdFile = path.join(tmpDir, "memories.md");
    writeMarkdownFile([mem1, mem2], mdFile);

    // New store in clean DB to test import
    const newDbPath = path.join(tmpDir, "new.db");
    const newStore = new OpenmemStore(newDbPath);
    try {
      const result = importMarkdown(mdFile, newStore, "ns-md");
      expect(result.added).toBe(2);

      const importedMem1 = newStore.getMemory(id1);
      expect(importedMem1).toBeDefined();
      expect(importedMem1?.text).toBe("Primary database is Postgres 16");
      expect(importedMem1?.pinned).toBe(true);
      expect(importedMem1?.importance).toBeCloseTo(0.8, 1);
    } finally {
      newStore.close();
    }
  });

  it("supersedes memory when text is modified in markdown", () => {
    const now = Date.now();
    const id = ulid(now);
    const mem: Memory = {
      id,
      namespace: "ns-md",
      kind: "semantic",
      text: "Port is 3000",
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
    };
    store.insertMemory(mem);

    const editedMd = `## Semantic\n- [id:${id}] (imp 0.5) Port is 8080\n`;
    const mdFile = path.join(tmpDir, "edited.md");
    fs.writeFileSync(mdFile, editedMd, "utf8");

    const result = importMarkdown(mdFile, store, "ns-md");
    expect(result.updated).toBe(1);

    const oldMem = store.getMemory(id);
    expect(oldMem?.validTo).not.toBeNull();
    expect(oldMem?.supersededBy).toBeDefined();

    const newMem = store.getMemory(oldMem!.supersededBy!);
    expect(newMem?.text).toBe("Port is 8080");
  });

  it("marks memories as forgotten when removed from markdown file", () => {
    const now = Date.now();
    const id1 = ulid(now);
    const id2 = ulid(now + 1);

    store.insertMemory({
      id: id1,
      namespace: "ns-md",
      kind: "semantic",
      text: "Keep this fact",
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

    store.insertMemory({
      id: id2,
      namespace: "ns-md",
      kind: "semantic",
      text: "Delete this fact",
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

    // Markdown file only has id1
    const mdContent = `## Semantic\n- [id:${id1}] (imp 0.5) Keep this fact\n`;
    const mdFile = path.join(tmpDir, "subset.md");
    fs.writeFileSync(mdFile, mdContent, "utf8");

    const result = importMarkdown(mdFile, store, "ns-md");
    expect(result.forgotten).toBe(1);

    const active = store.listActive("ns-md");
    expect(active.length).toBe(1);
    expect(active[0]?.id).toBe(id1);

    const forgottenMem = store.getMemory(id2);
    expect(forgottenMem?.validTo).not.toBeNull();
  });
});
