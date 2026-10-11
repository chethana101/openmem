import * as path from "node:path";
import {
  MemoryManager,
  OpenmemStore,
  importMarkdown,
  loadConfig,
  writeMarkdownFile,
} from "openmem-core";
import type { MemoryKind } from "openmem-core";

export function runAdd(
  text: string,
  opts: {
    kind?: MemoryKind | undefined;
    importance?: number | undefined;
    pin?: boolean | undefined;
    tags?: string[] | undefined;
    replaces?: string | undefined;
    cwd?: string | undefined;
  } = {},
): { id: string } {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  const store = new OpenmemStore(config.dbPath);
  try {
    const mgr = new MemoryManager(store, config);
    const id = mgr.add({
      text,
      kind: opts.kind ?? "semantic",
      importance: opts.importance,
      pin: opts.pin,
      tags: opts.tags,
      replaces: opts.replaces,
      sourceRef: "cli",
    });
    return { id };
  } finally {
    store.close();
  }
}

export function runRecall(
  query: string,
  opts: { k?: number | undefined; charBudget?: number | undefined; cwd?: string | undefined } = {},
): { text: string; count: number } {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  const store = new OpenmemStore(config.dbPath);
  try {
    const mgr = new MemoryManager(store, config);
    const result = mgr.recall({
      query,
      k: opts.k ?? 8,
      charBudget: opts.charBudget ?? 2000,
      namespace: config.namespace,
    });
    return {
      text: result.formattedBlock,
      count: result.memories.length,
    };
  } finally {
    store.close();
  }
}

export function runList(
  opts: {
    kind?: MemoryKind | undefined;
    history?: boolean | undefined;
    limit?: number | undefined;
    cwd?: string | undefined;
  } = {},
): Array<{
  id: string;
  kind: string;
  importance: number;
  text: string;
  pinned: boolean;
  validTo: number | null;
  supersededBy: string | null;
}> {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  const store = new OpenmemStore(config.dbPath);
  try {
    const mgr = new MemoryManager(store, config);
    const memories = mgr.list({
      namespace: config.namespace,
      kind: opts.kind,
      includeHistory: opts.history,
      limit: opts.limit ?? 100,
    });
    return memories.map((m) => ({
      id: m.id,
      kind: m.kind,
      importance: m.importance,
      text: m.text,
      pinned: m.pinned,
      validTo: m.validTo,
      supersededBy: m.supersededBy,
    }));
  } finally {
    store.close();
  }
}

export function runForget(
  opts: {
    id?: string | undefined;
    all?: boolean | undefined;
    query?: string | undefined;
    cwd?: string | undefined;
  } = {},
): { forgotten: number } {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  const store = new OpenmemStore(config.dbPath);
  try {
    const mgr = new MemoryManager(store, config);
    if (opts.all) {
      const count = mgr.forgetAll(config.namespace);
      return { forgotten: count };
    }
    if (opts.id) {
      const success = mgr.forget(opts.id, config.namespace);
      return { forgotten: success ? 1 : 0 };
    }
    return { forgotten: 0 };
  } finally {
    store.close();
  }
}

export function runExport(opts: { out?: string | undefined; cwd?: string | undefined } = {}): {
  filePath: string;
  count: number;
} {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  const store = new OpenmemStore(config.dbPath);
  try {
    const mgr = new MemoryManager(store, config);
    const memories = mgr.list({ namespace: config.namespace, limit: 5000 });
    const outPath = opts.out ?? path.join(cwd, ".openmem", "memories.md");
    writeMarkdownFile(memories, outPath);
    return { filePath: outPath, count: memories.length };
  } finally {
    store.close();
  }
}

export function runImport(
  filePath: string,
  opts: { cwd?: string | undefined } = {},
): { added: number; updated: number; forgotten: number } {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  const store = new OpenmemStore(config.dbPath);
  try {
    const result = importMarkdown(filePath, store, config.namespace);
    return {
      added: result.added,
      updated: result.updated,
      forgotten: result.forgotten,
    };
  } finally {
    store.close();
  }
}

export function runStats(opts: { cwd?: string | undefined } = {}): {
  namespace: string;
  activeMemories: number;
  totalRefs: number;
  totalSavedBytes: number;
} {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  const store = new OpenmemStore(config.dbPath);
  try {
    const activeMemories = store.countActive(config.namespace);
    // Gather ref metrics
    const db = (
      store as unknown as { db: { prepare: (q: string) => { get: (p?: unknown) => unknown } } }
    ).db;
    let totalRefs = 0;
    let totalSavedBytes = 0;
    try {
      const refRow = db
        .prepare("SELECT count(*) as c, coalesce(sum(bytes), 0) as b FROM refs WHERE namespace = ?")
        .get(config.namespace) as { c: number; b: number };
      totalRefs = refRow?.c ?? 0;
      totalSavedBytes = refRow?.b ?? 0;
    } catch {
      /* ignore */
    }

    return {
      namespace: config.namespace,
      activeMemories,
      totalRefs,
      totalSavedBytes,
    };
  } finally {
    store.close();
  }
}

export function runExplain(
  opts: { sessionId?: string | undefined; cwd?: string | undefined } = {},
): Array<{
  id: string;
  toolName: string | null;
  bytes: number;
  createdAt: number;
  snippet: string;
}> {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  const store = new OpenmemStore(config.dbPath);
  try {
    const db = (
      store as unknown as {
        db: { prepare: (q: string) => { all: (...args: unknown[]) => unknown[] } };
      }
    ).db;
    const query = opts.sessionId
      ? "SELECT id, tool_name, bytes, created_at, substr(content, 1, 120) as snippet FROM refs WHERE namespace = ? AND session_id = ? ORDER BY created_at DESC LIMIT 50"
      : "SELECT id, tool_name, bytes, created_at, substr(content, 1, 120) as snippet FROM refs WHERE namespace = ? ORDER BY created_at DESC LIMIT 50";
    const args = opts.sessionId ? [config.namespace, opts.sessionId] : [config.namespace];
    const rows = db.prepare(query).all(...args) as Array<{
      id: string;
      tool_name: string | null;
      bytes: number;
      created_at: number;
      snippet: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      toolName: r.tool_name,
      bytes: r.bytes,
      createdAt: r.created_at,
      snippet: r.snippet,
    }));
  } finally {
    store.close();
  }
}
