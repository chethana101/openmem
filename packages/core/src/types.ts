/**
 * Core types for openmem.
 * Keep this file dependency-free - it must be importable anywhere.
 */

export type MemoryKind = "semantic" | "episodic" | "procedural";

export interface Memory {
  id: string; // ULID
  namespace: string;
  kind: MemoryKind;
  text: string;
  importance: number; // 0..1
  createdAt: number; // ms epoch
  updatedAt: number;
  lastAccessedAt: number;
  accessCount: number;
  validFrom: number;
  validTo: number | null; // null = currently valid
  supersededBy: string | null;
  sourceSessionId: string | null;
  sourceRef: string | null; // e.g. 'user', 'mcp', 'transcript:/path#42'
  tags: string[]; // parsed from JSON blob in DB
  pii: boolean;
  pinned: boolean;
}

export interface MemoryRef {
  id: string; // short id e.g. 'r_8f3k2'
  namespace: string;
  sessionId: string | null;
  toolName: string | null;
  toolArgs: string | null; // JSON string
  content: string;
  bytes: number;
  createdAt: number;
  expiresAt: number | null;
}

export interface Session {
  id: string;
  namespace: string;
  startedAt: number;
  endedAt: number | null;
  source: string | null;
  endReason: string | null;
  hooksMsTotal: number;
  transcriptPath: string | null;
}

export interface AddMemoryInput {
  text: string;
  kind?: MemoryKind | undefined;
  importance?: number | undefined;
  pin?: boolean | undefined;
  tags?: string[] | undefined;
  sourceSessionId?: string | undefined;
  sourceRef?: string | undefined;
  replaces?: string | undefined; // id of memory this supersedes
}

export interface RecallOptions {
  query: string;
  k?: number | undefined; // max items to return (default 8)
  charBudget?: number | undefined; // max total chars (default 2000)
  namespace: string;
}

export interface RecallResult {
  memories: Memory[];
  formattedBlock: string; // <openmem> block
}

export interface ForgetInput {
  id?: string | undefined;
  query?: string | undefined;
  namespace: string;
}

export interface ListOptions {
  namespace: string;
  kind?: MemoryKind | undefined;
  includeHistory?: boolean | undefined; // include superseded memories
  limit?: number | undefined;
}

export interface OpenmemConfig {
  dbPath: string;
  namespace: string;
  capture: {
    onStop: boolean; // whether to block agentStop for capture (default false)
  };
  context: {
    compress: boolean; // whether to compress postToolUse results (default true)
    threshold: number; // chars above which to compress (default 6000)
    denyList: string[]; // tool names to never compress
    refTtlDays: number; // days to keep refs (default 7)
  };
  memory: {
    capacity: number; // max active memories per namespace (default 500)
    decayHalfLifeDays: number; // half-life for time decay (default 30)
  };
}

export const DEFAULT_CONFIG: Omit<OpenmemConfig, "dbPath" | "namespace"> = {
  capture: { onStop: false },
  context: {
    compress: true,
    threshold: 6000,
    denyList: [],
    refTtlDays: 7,
  },
  memory: {
    capacity: 500,
    decayHalfLifeDays: 30,
  },
};
