/**
 * Memory operations: add, recall, list, forget.
 * This is the core API consumed by hooks and the CLI.
 */

import { effectiveImportance, recallScore } from "../policies/decay.js";
import { redact } from "../policies/redaction.js";
import type { OpenmemStore } from "../store/db.js";
import type {
  AddMemoryInput,
  ListOptions,
  Memory,
  OpenmemConfig,
  RecallOptions,
  RecallResult,
} from "../types.js";
import { ulid } from "../ulid.js";

const DEFAULT_K = 8;
const DEFAULT_CHAR_BUDGET = 2000;

export class MemoryManager {
  constructor(
    private readonly store: OpenmemStore,
    private readonly config: OpenmemConfig,
  ) {}

  /**
   * Add a new memory. Handles redaction, supersession, and capacity enforcement.
   * Returns the created memory ID.
   */
  add(input: AddMemoryInput): string {
    const now = Date.now();
    const namespace = this.config.namespace;

    // Redact secrets/PII before storing
    const { text, pii } = redact(input.text);

    // Handle explicit supersession
    if (input.replaces) {
      const existing = this.store.getMemory(input.replaces);
      if (
        existing &&
        existing.namespace === namespace &&
        existing.validTo === null
      ) {
        // Create the new memory first, then supersede the old one
        const id = this.createAndInsert({ input, text, pii, now, namespace });
        this.store.supersede(input.replaces, id, now);
        this.enforceCapacity(now);
        return id;
      }
    }

    // Check for near-duplicate (FTS similarity) for auto-supersession
    const id = this.createAndInsert({ input, text, pii, now, namespace });
    this.enforceCapacity(now);
    return id;
  }

  private createAndInsert(opts: {
    input: AddMemoryInput;
    text: string;
    pii: boolean;
    now: number;
    namespace: string;
  }): string {
    const { input, text, pii, now, namespace } = opts;
    const id = ulid(now);
    const memory: Memory = {
      id,
      namespace,
      kind: input.kind ?? "semantic",
      text,
      importance: Math.min(1, Math.max(0, input.importance ?? 0.5)),
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      validFrom: now,
      validTo: null,
      supersededBy: null,
      sourceSessionId: input.sourceSessionId ?? null,
      sourceRef: input.sourceRef ?? "user",
      tags: input.tags ?? [],
      pii,
      pinned: input.pin ?? false,
    };
    this.store.insertMemory(memory);
    return id;
  }

  private enforceCapacity(now: number): void {
    this.store.evictToCapacity(
      this.config.namespace,
      this.config.memory.capacity,
      now,
    );
  }

  /**
   * Hybrid recall: FTS5 BM25 + scoring blend.
   * Returns top-k memories within charBudget, formatted as an <openmem> block.
   */
  recall(opts: RecallOptions): RecallResult {
    const now = Date.now();
    const k = opts.k ?? DEFAULT_K;
    const charBudget = opts.charBudget ?? DEFAULT_CHAR_BUDGET;
    const namespace = opts.namespace;

    // Sanitize FTS query - escape special FTS5 chars
    const safeQuery = sanitizeFtsQuery(opts.query);

    // FTS search (returns more candidates than k for re-ranking)
    const ftsResults = safeQuery
      ? this.store.ftsSearch(namespace, safeQuery, k * 3)
      : [];

    // Build a map of all FTS hits
    const ftsMap = new Map(ftsResults.map((r) => [r.id, r.rank]));

    // Fetch full memory objects
    const candidates: Array<{ memory: Memory; score: number }> = [];

    // FTS candidates
    for (const { id, rank } of ftsResults) {
      const mem = this.store.getMemory(id);
      if (!mem || mem.validTo !== null) continue;
      const eff = effectiveImportance(
        mem.importance,
        mem.lastAccessedAt,
        mem.accessCount,
        mem.pinned,
        now,
        { halfLifeDays: this.config.memory.decayHalfLifeDays },
      );
      candidates.push({
        memory: mem,
        score: recallScore(rank, eff, mem.pinned),
      });
    }

    // If no FTS results, fall back to importance-ranked list
    if (candidates.length === 0) {
      const all = this.store.listActive(namespace, undefined, k * 2);
      for (const mem of all) {
        if (ftsMap.has(mem.id)) continue; // already added
        const eff = effectiveImportance(
          mem.importance,
          mem.lastAccessedAt,
          mem.accessCount,
          mem.pinned,
          now,
          { halfLifeDays: this.config.memory.decayHalfLifeDays },
        );
        candidates.push({ memory: mem, score: eff });
      }
    }

    // Sort by score desc, take top-k within char budget
    candidates.sort((a, b) => b.score - a.score);

    const selected: Memory[] = [];
    let chars = 0;
    for (const { memory } of candidates) {
      if (selected.length >= k) break;
      if (chars + memory.text.length > charBudget) continue;
      selected.push(memory);
      chars += memory.text.length;
    }

    // Update access stats for selected memories
    for (const mem of selected) {
      this.store.touchMemory(mem.id, now);
    }

    const formattedBlock = formatMemoryBlock(selected);
    return { memories: selected, formattedBlock };
  }

  /**
   * List memories for the user to review.
   */
  list(opts: ListOptions): Memory[] {
    if (opts.includeHistory) {
      return this.store.listAll(opts.namespace, opts.kind, opts.limit ?? 1000);
    }
    return this.store.listActive(opts.namespace, opts.kind, opts.limit ?? 500);
  }

  /**
   * Forget a memory by ID.
   */
  forget(id: string, namespace: string): boolean {
    const mem = this.store.getMemory(id);
    if (!mem || mem.namespace !== namespace) return false;
    this.store.forget(id, Date.now());
    return true;
  }

  /**
   * Forget all memories in a namespace.
   */
  forgetAll(namespace: string): number {
    const all = this.store.listActive(namespace);
    const now = Date.now();
    for (const mem of all) {
      this.store.forget(mem.id, now);
    }
    return all.length;
  }

  /**
   * Run end-of-session consolidation: expire old refs, enforce capacity.
   */
  consolidate(namespace: string): void {
    const now = Date.now();
    this.store.deleteExpiredRefs(now);
    this.enforceCapacity(now);
  }
}

// ── Formatting ────────────────────────────────────────────────────────────

function formatMemoryBlock(memories: Memory[]): string {
  if (memories.length === 0) return "";

  const lines = memories.map((m) => `- ${m.text} [id:${m.id}]`);
  return [
    "<openmem>",
    "Relevant project memory (editable via `openmem list`):",
    ...lines,
    "</openmem>",
  ].join("\n");
}

function sanitizeFtsQuery(query: string): string {
  // Remove FTS5 special operators that could cause parse errors
  // Keep alphanumeric, spaces, hyphens, and underscores
  return query
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200); // cap length
}
