/**
 * Markdown export and import for human-editable memory files.
 *
 * Export format (.openmem/memories.md or .github/openmem/memories.md):
 *
 * ## Semantic
 * - [id:01J..] (imp 0.8) Project uses pnpm workspaces; never use npm.
 *
 * ## Procedural
 * - [id:01J..] (imp 0.7) Run `pnpm test -F core` before committing.
 *
 * Import re-reads the file and syncs changes back to the DB.
 * - New entries (no id or unknown id) → inserted as new memories
 * - Deleted lines → memories are forgotten
 * - Modified text → supersession
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { redact } from "../policies/redaction.js";
import type { OpenmemStore } from "../store/db.js";
import type { Memory, MemoryKind } from "../types.js";
import { ulid } from "../ulid.js";

const KIND_ORDER: MemoryKind[] = ["semantic", "procedural", "episodic"];
const KIND_LABELS: Record<MemoryKind, string> = {
  semantic: "Semantic",
  procedural: "Procedural",
  episodic: "Episodic",
};
const LABEL_TO_KIND: Record<string, MemoryKind> = {
  semantic: "semantic",
  procedural: "procedural",
  episodic: "episodic",
};

const ID_PATTERN = /\[id:([A-Z0-9]+)\]/i;
const IMP_PATTERN = /\(imp ([\d.]+)\)/;
const LINE_PATTERN =
  /^- (?:\[id:[A-Z0-9]+\]\s*)?(?:\(imp [\d.]+\)\s*)?(?:📌\s*)?(.+)$/i;

export function exportMarkdown(memories: Memory[]): string {
  const byKind = new Map<MemoryKind, Memory[]>();
  for (const k of KIND_ORDER) byKind.set(k, []);

  for (const m of memories) {
    byKind.get(m.kind)?.push(m);
  }

  const sections: string[] = [
    "<!-- openmem memories - editable by humans; import with `openmem import` -->",
    "",
  ];

  for (const kind of KIND_ORDER) {
    const items = byKind.get(kind) ?? [];
    if (items.length === 0) continue;
    sections.push(`## ${KIND_LABELS[kind]}`);
    for (const m of items) {
      const pinMark = m.pinned ? " 📌" : "";
      sections.push(
        `- [id:${m.id}] (imp ${m.importance.toFixed(1)})${pinMark} ${m.text}`,
      );
    }
    sections.push("");
  }

  return sections.join("\n");
}

export function writeMarkdownFile(memories: Memory[], outPath: string): void {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, exportMarkdown(memories), "utf8");
}

export interface ImportResult {
  added: number;
  updated: number;
  forgotten: number;
}

export function importMarkdown(
  filePath: string,
  store: OpenmemStore,
  namespace: string,
): ImportResult {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  let currentKind: MemoryKind = "semantic";
  const now = Date.now();

  // Parse all entries from file
  const fileEntries: Array<{
    id: string | null;
    kind: MemoryKind;
    importance: number;
    text: string;
    pinned: boolean;
  }> = [];

  for (const line of lines) {
    // Section heading
    const headingMatch = /^## (.+)/.exec(line);
    if (headingMatch) {
      const label = headingMatch[1]?.toLowerCase().trim() ?? "";
      currentKind = LABEL_TO_KIND[label] ?? "semantic";
      continue;
    }

    // Memory line
    if (!line.startsWith("- ")) continue;
    const idMatch = ID_PATTERN.exec(line);
    const impMatch = IMP_PATTERN.exec(line);
    const textMatch = LINE_PATTERN.exec(line);

    if (!textMatch) continue;
    const text = (textMatch[1]?.trim() ?? "").replace(/^📌\s*/, "");
    if (!text) continue;

    fileEntries.push({
      id: idMatch?.[1] ?? null,
      kind: currentKind,
      importance: impMatch ? Number.parseFloat(impMatch[1] ?? "0.5") : 0.5,
      text,
      pinned: line.includes("📌"),
    });
  }

  // Load existing active memories
  const existing = store.listActive(namespace);
  const existingMap = new Map(existing.map((m) => [m.id, m]));
  const fileIds = new Set(
    fileEntries.map((e) => e.id).filter(Boolean) as string[],
  );

  let added = 0;
  let updated = 0;
  let forgotten = 0;

  // Forget memories not in file
  for (const mem of existing) {
    if (!fileIds.has(mem.id) && !mem.pinned) {
      store.forget(mem.id, now);
      forgotten++;
    }
  }

  // Add or update memories from file
  for (const entry of fileEntries) {
    const { text: cleanText, pii } = redact(entry.text);

    if (entry.id && existingMap.has(entry.id)) {
      const existing = existingMap.get(entry.id)!;
      // If text changed, supersede with a new entry
      if (
        existing.text !== cleanText ||
        existing.importance !== entry.importance
      ) {
        const newId = ulid(now);
        store.insertMemory({
          id: newId,
          namespace,
          kind: entry.kind,
          text: cleanText,
          importance: entry.importance,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
          accessCount: 0,
          validFrom: now,
          validTo: null,
          supersededBy: null,
          sourceSessionId: null,
          sourceRef: "import",
          tags: [],
          pii,
          pinned: entry.pinned,
        });
        store.supersede(entry.id, newId, now);
        updated++;
      }
    } else {
      // Entry not in existing active map
      if (entry.id && store.getMemory(entry.id)) {
        store.reactivateMemory(
          entry.id,
          cleanText,
          entry.importance,
          entry.pinned,
          now,
        );
        added++;
      } else {
        const id = entry.id ?? ulid(now);
        store.insertMemory({
          id,
          namespace,
          kind: entry.kind,
          text: cleanText,
          importance: entry.importance,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
          accessCount: 0,
          validFrom: now,
          validTo: null,
          supersededBy: null,
          sourceSessionId: null,
          sourceRef: "import",
          tags: [],
          pii,
          pinned: entry.pinned,
        });
        added++;
      }
    }
  }

  return { added, updated, forgotten };
}
