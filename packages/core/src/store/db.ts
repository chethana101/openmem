/**
 * SQLite store - schema, migrations, and typed query helpers.
 *
 * Uses Node's built-in `node:sqlite` (Node ≥22.5, currently experimental).
 * No external SQLite dependency required.
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { Memory, MemoryKind, MemoryRef, Session } from "../types.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

const SCHEMA_VERSION = 1;

const BASE_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('semantic','episodic','procedural')),
  text TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5 CHECK(importance BETWEEN 0 AND 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER,
  superseded_by TEXT,
  source_session_id TEXT,
  source_ref TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  pii INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace);
CREATE INDEX IF NOT EXISTS idx_memories_namespace_valid ON memories(namespace, valid_to);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);

CREATE TABLE IF NOT EXISTS refs (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  session_id TEXT,
  tool_name TEXT,
  tool_args TEXT,
  content TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_refs_namespace ON refs(namespace);
CREATE INDEX IF NOT EXISTS idx_refs_expires ON refs(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  source TEXT,
  end_reason TEXT,
  hooks_ms_total INTEGER NOT NULL DEFAULT 0,
  transcript_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_namespace ON sessions(namespace);
`;

const FTS_SCHEMA_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  id UNINDEXED,
  namespace UNINDEXED,
  text,
  tags,
  content=memories,
  content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, id, namespace, text, tags)
  VALUES (new.rowid, new.id, new.namespace, new.text, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
  UPDATE memories_fts SET text = new.text, tags = new.tags WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, id, namespace, text, tags)
  VALUES ('delete', old.rowid, old.id, old.namespace, old.text, old.tags);
END;
`;

export class OpenmemStore {
  private db: DatabaseSyncType;
  public hasFts5 = false;

  constructor(dbPath: string) {
    // Ensure parent directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init(): void {
    // Apply base schema
    this.db.exec(BASE_SCHEMA_SQL);

    // Attempt FTS5 virtual table
    try {
      this.db.exec(FTS_SCHEMA_SQL);
      this.hasFts5 = true;
    } catch {
      // FTS5 extension not available in current SQLite build (e.g. standard Node on Windows)
      // Fast in-process token-matching fallback is used instead
      this.hasFts5 = false;
    }

    // Check/set schema version
    const row = this.db
      .prepare("SELECT version FROM schema_version LIMIT 1")
      .get() as { version: number } | undefined;
    if (!row) {
      this.db
        .prepare("INSERT INTO schema_version(version) VALUES (?)")
        .run(SCHEMA_VERSION);
    }
  }

  close(): void {
    this.db.close();
  }

  // ── Memories ──────────────────────────────────────────────────────────────

  insertMemory(m: Memory): void {
    this.db
      .prepare(
        `INSERT INTO memories
          (id, namespace, kind, text, importance, created_at, updated_at,
           last_accessed_at, access_count, valid_from, valid_to,
           superseded_by, source_session_id, source_ref, tags, pii, pinned)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        m.id,
        m.namespace,
        m.kind,
        m.text,
        m.importance,
        m.createdAt,
        m.updatedAt,
        m.lastAccessedAt,
        m.accessCount,
        m.validFrom,
        m.validTo ?? null,
        m.supersededBy ?? null,
        m.sourceSessionId ?? null,
        m.sourceRef ?? null,
        JSON.stringify(m.tags),
        m.pii ? 1 : 0,
        m.pinned ? 1 : 0,
      );
  }

  getMemory(id: string): Memory | undefined {
    const row = this.db
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(id) as RawMemoryRow | undefined;
    return row ? rowToMemory(row) : undefined;
  }

  /** Update valid_to and superseded_by to supersede a memory */
  supersede(id: string, supersededBy: string, now: number): void {
    this.db
      .prepare(
        "UPDATE memories SET valid_to = ?, superseded_by = ?, updated_at = ? WHERE id = ?",
      )
      .run(now, supersededBy, now, id);
  }

  /** Mark as forgotten (set valid_to without a successor) */
  forget(id: string, now: number): void {
    this.db
      .prepare("UPDATE memories SET valid_to = ?, updated_at = ? WHERE id = ?")
      .run(now, now, id);
  }

  /** Reactivate a previously forgotten or modified memory */
  reactivateMemory(
    id: string,
    text: string,
    importance: number,
    pinned: boolean,
    now: number,
  ): void {
    this.db
      .prepare(
        "UPDATE memories SET valid_to = NULL, text = ?, importance = ?, pinned = ?, updated_at = ? WHERE id = ?",
      )
      .run(text, importance, pinned ? 1 : 0, now, id);
  }

  /** Update access stats after recall */
  touchMemory(id: string, now: number): void {
    this.db
      .prepare(
        "UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?",
      )
      .run(now, id);
  }

  /** Full-text search using FTS5 when available, falling back to keyword token matching */
  ftsSearch(
    namespace: string,
    query: string,
    limit: number,
  ): Array<{ id: string; rank: number }> {
    if (this.hasFts5) {
      try {
        const rows = this.db
          .prepare(
            `SELECT m.id, fts.rank
             FROM memories_fts fts
             JOIN memories m ON m.rowid = fts.rowid
             WHERE memories_fts MATCH ? AND m.namespace = ? AND m.valid_to IS NULL
             ORDER BY fts.rank
             LIMIT ?`,
          )
          .all(query, namespace, limit) as Array<{ id: string; rank: number }>;
        return rows;
      } catch {
        // FTS query may be invalid syntax - fall through to keyword fallback
      }
    }

    // Fast keyword token-matching fallback (runs in-memory over active memories)
    const terms = query
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);

    if (terms.length === 0) return [];

    const activeRows = this.db
      .prepare(
        `SELECT id, text, tags FROM memories
         WHERE namespace = ? AND valid_to IS NULL`,
      )
      .all(namespace) as unknown as Array<{
      id: string;
      text: string;
      tags: string;
    }>;

    const scored: Array<{ id: string; rank: number }> = [];
    for (const row of activeRows) {
      const textLower = `${row.text} ${row.tags}`.toLowerCase();
      let matchCount = 0;
      for (const term of terms) {
        if (textLower.includes(term)) {
          matchCount++;
        }
      }
      if (matchCount > 0) {
        // rank is negative for better match, consistent with FTS5 BM25
        const score = (matchCount / terms.length) * 10;
        scored.push({ id: row.id, rank: -score });
      }
    }

    scored.sort((a, b) => a.rank - b.rank);
    return scored.slice(0, limit);
  }

  /** List active memories in a namespace, sorted by importance desc */
  listActive(namespace: string, kind?: MemoryKind, limit = 500): Memory[] {
    const kindClause = kind ? "AND kind = ?" : "";
    const query = `SELECT * FROM memories
         WHERE namespace = ? AND valid_to IS NULL ${kindClause}
         ORDER BY pinned DESC, importance DESC
         LIMIT ?`;
    const rows = (kind
      ? this.db.prepare(query).all(namespace, kind, limit)
      : this.db
          .prepare(query)
          .all(namespace, limit)) as unknown as RawMemoryRow[];
    return rows.map(rowToMemory);
  }

  /** List including superseded memories */
  listAll(namespace: string, kind?: MemoryKind, limit = 1000): Memory[] {
    const kindClause = kind ? "AND kind = ?" : "";
    const query = `SELECT * FROM memories WHERE namespace = ? ${kindClause}
         ORDER BY created_at DESC LIMIT ?`;
    const rows = (kind
      ? this.db.prepare(query).all(namespace, kind, limit)
      : this.db
          .prepare(query)
          .all(namespace, limit)) as unknown as RawMemoryRow[];
    return rows.map(rowToMemory);
  }

  countActive(namespace: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) as n FROM memories WHERE namespace = ? AND valid_to IS NULL",
      )
      .get(namespace) as { n: number };
    return row.n;
  }

  /** Evict lowest-scoring non-pinned episodic memories until under capacity */
  evictToCapacity(namespace: string, capacity: number, now: number): number {
    const count = this.countActive(namespace);
    if (count <= capacity) return 0;
    const toEvict = count - capacity;
    // Evict episodic first, then lowest importance
    const ids = this.db
      .prepare(
        `SELECT id FROM memories
         WHERE namespace = ? AND valid_to IS NULL AND pinned = 0
         ORDER BY CASE kind WHEN 'episodic' THEN 0 ELSE 1 END, importance ASC
         LIMIT ?`,
      )
      .all(namespace, toEvict) as Array<{ id: string }>;
    for (const { id } of ids) {
      this.forget(id, now);
    }
    return ids.length;
  }

  // ── Refs ──────────────────────────────────────────────────────────────────

  insertRef(ref: MemoryRef): void {
    this.db
      .prepare(
        `INSERT INTO refs (id, namespace, session_id, tool_name, tool_args, content, bytes, created_at, expires_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        ref.id,
        ref.namespace,
        ref.sessionId ?? null,
        ref.toolName ?? null,
        ref.toolArgs ?? null,
        ref.content,
        ref.bytes,
        ref.createdAt,
        ref.expiresAt ?? null,
      );
  }

  getRef(id: string): MemoryRef | undefined {
    const row = this.db.prepare("SELECT * FROM refs WHERE id = ?").get(id) as
      | RawRefRow
      | undefined;
    return row ? rowToRef(row) : undefined;
  }

  deleteExpiredRefs(now: number): number {
    const result = this.db
      .prepare(
        "DELETE FROM refs WHERE expires_at IS NOT NULL AND expires_at < ?",
      )
      .run(now);
    return Number(result.changes);
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  upsertSession(s: Session): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, namespace, started_at, ended_at, source, end_reason, hooks_ms_total, transcript_path)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           ended_at = excluded.ended_at,
           end_reason = excluded.end_reason,
           hooks_ms_total = excluded.hooks_ms_total,
           transcript_path = COALESCE(excluded.transcript_path, transcript_path)`,
      )
      .run(
        s.id,
        s.namespace,
        s.startedAt,
        s.endedAt ?? null,
        s.source ?? null,
        s.endReason ?? null,
        s.hooksMsTotal,
        s.transcriptPath ?? null,
      );
  }

  getSession(id: string): Session | undefined {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as RawSessionRow | undefined;
    return row ? rowToSession(row) : undefined;
  }

  addHookMs(id: string, ms: number): void {
    this.db
      .prepare(
        "UPDATE sessions SET hooks_ms_total = hooks_ms_total + ? WHERE id = ?",
      )
      .run(ms, id);
  }

  setTranscriptPath(id: string, transcriptPath: string): void {
    this.db
      .prepare("UPDATE sessions SET transcript_path = ? WHERE id = ?")
      .run(transcriptPath, id);
  }
}

// ── Row-to-type mappers ────────────────────────────────────────────────────

interface RawMemoryRow {
  id: string;
  namespace: string;
  kind: string;
  text: string;
  importance: number;
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
  access_count: number;
  valid_from: number;
  valid_to: number | null;
  superseded_by: string | null;
  source_session_id: string | null;
  source_ref: string | null;
  tags: string;
  pii: number;
  pinned: number;
}

function rowToMemory(row: RawMemoryRow): Memory {
  return {
    id: row.id,
    namespace: row.namespace,
    kind: row.kind as MemoryKind,
    text: row.text,
    importance: row.importance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    supersededBy: row.superseded_by,
    sourceSessionId: row.source_session_id,
    sourceRef: row.source_ref,
    tags: JSON.parse(row.tags) as string[],
    pii: row.pii !== 0,
    pinned: row.pinned !== 0,
  };
}

interface RawRefRow {
  id: string;
  namespace: string;
  session_id: string | null;
  tool_name: string | null;
  tool_args: string | null;
  content: string;
  bytes: number;
  created_at: number;
  expires_at: number | null;
}

function rowToRef(row: RawRefRow): MemoryRef {
  return {
    id: row.id,
    namespace: row.namespace,
    sessionId: row.session_id,
    toolName: row.tool_name,
    toolArgs: row.tool_args,
    content: row.content,
    bytes: row.bytes,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

interface RawSessionRow {
  id: string;
  namespace: string;
  started_at: number;
  ended_at: number | null;
  source: string | null;
  end_reason: string | null;
  hooks_ms_total: number;
  transcript_path: string | null;
}

function rowToSession(row: RawSessionRow): Session {
  return {
    id: row.id,
    namespace: row.namespace,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    source: row.source,
    endReason: row.end_reason,
    hooksMsTotal: row.hooks_ms_total,
    transcriptPath: row.transcript_path,
  };
}
