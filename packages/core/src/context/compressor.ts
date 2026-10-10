/**
 * Tool-output compression for postToolUse hook.
 *
 * Reduces large tool results to a compressed stub, storing the full content
 * in the refs table so the agent can retrieve specific ranges via read_ref.
 *
 * Supports: bash, view (file), grep, web_fetch, JSON outputs.
 */

import { toolArgsDenied } from "../policies/redaction.js";
import type { OpenmemStore } from "../store/db.js";
import type { OpenmemConfig } from "../types.js";
import { shortId } from "../ulid.js";

export interface CompressResult {
  /** The compressed text to return as modifiedResult.textResultForLlm */
  compressedText: string;
  /** The ref ID for the full content */
  refId: string;
  /** Original byte count */
  originalBytes: number;
  /** Compressed byte count */
  compressedBytes: number;
}

export interface CompressionRecord {
  sessionId: string;
  toolName: string;
  refId: string;
  originalBytes: number;
  compressedBytes: number;
  timestamp: number;
}

const FOOTER_TEMPLATE = (id: string, origBytes: number, compBytes: number) =>
  `\n[openmem: output truncated from ${origBytes.toLocaleString()} to ${compBytes.toLocaleString()} chars. Full output stored as ref ${id}. Call MCP tool read_ref("${id}") to retrieve specific ranges.]`;

export class ContextCompressor {
  private compressionLog: CompressionRecord[] = [];

  constructor(
    private readonly store: OpenmemStore,
    private readonly config: OpenmemConfig,
  ) {}

  /**
   * Maybe compress a tool result. Returns null if compression is disabled,
   * output is below threshold, tool is deny-listed, or args contain denied paths.
   */
  maybeCompress(
    toolName: string,
    toolArgs: unknown,
    textResult: string,
    sessionId: string,
    namespace: string,
  ): CompressResult | null {
    if (!this.config.context.compress) return null;
    if (textResult.length <= this.config.context.threshold) return null;
    if (this.config.context.denyList.includes(toolName)) return null;
    if (toolArgsDenied(toolArgs)) return null;

    const refId = shortId();
    const originalBytes = textResult.length;

    let compressed: string;
    const tool = toolName.toLowerCase();

    if (tool === "bash" || tool === "powershell") {
      compressed = compressBash(textResult);
    } else if (tool === "view" || tool === "read") {
      compressed = compressFileView(textResult, toolArgs);
    } else if (tool === "grep" || tool === "rg") {
      compressed = compressGrep(textResult);
    } else if (tool === "web_fetch") {
      compressed = compressWebFetch(textResult);
    } else {
      compressed = compressGeneric(textResult);
    }

    const footer = FOOTER_TEMPLATE(refId, originalBytes, compressed.length);
    const compressedText = compressed + footer;
    const compressedBytes = compressedText.length;

    // Store full content as ref
    const expiresAt =
      this.config.context.refTtlDays > 0
        ? Date.now() + this.config.context.refTtlDays * 86_400_000
        : null;

    this.store.insertRef({
      id: refId,
      namespace,
      sessionId,
      toolName,
      toolArgs: toolArgs ? JSON.stringify(toolArgs) : null,
      content: textResult,
      bytes: originalBytes,
      createdAt: Date.now(),
      expiresAt,
    });

    this.compressionLog.push({
      sessionId,
      toolName,
      refId,
      originalBytes,
      compressedBytes,
      timestamp: Date.now(),
    });

    return { compressedText, refId, originalBytes, compressedBytes };
  }

  /** Read a ref by ID, optionally slicing lines */
  readRef(id: string, startLine?: number, endLine?: number): string | null {
    const ref = this.store.getRef(id);
    if (!ref) return null;
    if (startLine === undefined && endLine === undefined) return ref.content;

    const lines = ref.content.split("\n");
    const start = Math.max(0, (startLine ?? 1) - 1);
    const end = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;
    return lines.slice(start, end).join("\n");
  }

  getCompressionLog(sessionId?: string): CompressionRecord[] {
    if (sessionId) return this.compressionLog.filter((r) => r.sessionId === sessionId);
    return this.compressionLog;
  }
}

// ── Per-tool compressors ────────────────────────────────────────────────────

const HEAD_LINES = 40;
const TAIL_LINES = 60;
const ERROR_PATTERN = /error|fail|exception|warning|traceback|panic|fatal/i;

function compressBash(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= HEAD_LINES + TAIL_LINES) return text;

  const head = lines.slice(0, HEAD_LINES);
  const tail = lines.slice(-TAIL_LINES);
  const errorLines = lines
    .slice(HEAD_LINES, lines.length - TAIL_LINES)
    .filter((l) => ERROR_PATTERN.test(l))
    .slice(0, 20);

  const omitted = lines.length - HEAD_LINES - TAIL_LINES;
  const parts = [...head, `\n... [${omitted} lines omitted] ...`];
  if (errorLines.length > 0) {
    parts.push(`\n[Captured error/warning lines from omitted section:]`);
    parts.push(...errorLines);
  }
  parts.push(...tail);
  return parts.join("\n");
}

function compressFileView(text: string, toolArgs: unknown): string {
  const lines = text.split("\n");
  const MAX_LINES = 100;
  if (lines.length <= MAX_LINES) return text;

  // Extract function/class signatures (simple heuristic)
  const signatures = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) =>
      /^\s*(export\s+)?(async\s+)?function\s+\w+|^\s*(export\s+)?(abstract\s+)?class\s+\w+|^\s*(export\s+)?(const|let|var)\s+\w+\s*=.*=>|^\s*def\s+\w+|^\s*class\s+\w+/i.test(
        l,
      ),
    )
    .slice(0, 30)
    .map(({ l, i }) => `  L${i + 1}: ${l.trim()}`);

  const filePath =
    toolArgs && typeof toolArgs === "object" && "path" in toolArgs
      ? String((toolArgs as Record<string, unknown>)["path"])
      : "file";

  const head = lines.slice(0, 60).join("\n");
  const outline =
    signatures.length > 0 ? `\n[File outline (${filePath}):\n${signatures.join("\n")}\n]` : "";
  const omitted = lines.length - 60;

  return `${head}${outline}\n\n... [${omitted} more lines omitted. Use view tool with line ranges to read specific sections.]`;
}

function compressGrep(text: string): string {
  const lines = text.split("\n").filter(Boolean);
  const MAX = 50;
  if (lines.length <= MAX) return text;

  // Group by file prefix (e.g. "src/foo.ts:42: ...")
  const fileGroups = new Map<string, string[]>();
  const noFileLines: string[] = [];

  for (const line of lines) {
    const m = /^([^:]+):\d+:/.exec(line);
    if (m?.[1]) {
      const file = m[1];
      if (!fileGroups.has(file)) fileGroups.set(file, []);
      fileGroups.get(file)!.push(line);
    } else {
      noFileLines.push(line);
    }
  }

  const summary: string[] = [];
  let shown = 0;
  for (const [file, fileLines] of fileGroups) {
    if (shown >= MAX) break;
    const take = Math.min(fileLines.length, MAX - shown);
    summary.push(...fileLines.slice(0, take));
    if (fileLines.length > take) {
      summary.push(`  ... [${fileLines.length - take} more matches in ${file}]`);
    }
    shown += take;
  }
  summary.push(...noFileLines.slice(0, Math.max(0, MAX - shown)));

  const total = lines.length;
  return summary.join("\n") + `\n\n[${total} total matches; ${total - shown} not shown]`;
}

function compressWebFetch(text: string): string {
  // Extract title (first # heading), first paragraph, and all headings
  const lines = text.split("\n");
  const title = lines.find((l) => /^#{1,2}\s/.test(l)) ?? lines[0] ?? "";
  const headings = lines.filter((l) => /^#{1,4}\s/.test(l)).slice(0, 20);
  const firstSection = lines.slice(0, 30).join("\n");

  return [
    `[Web page summary]`,
    `Title: ${title}`,
    "",
    firstSection,
    "",
    `[Page headings:]`,
    ...headings,
  ].join("\n");
}

function compressGeneric(text: string): string {
  const lines = text.split("\n");
  const MAX = 80;
  if (lines.length <= MAX) return text;
  const head = lines.slice(0, MAX).join("\n");
  return head + `\n\n... [${lines.length - MAX} more lines omitted]`;
}
