/**
 * @openmem/core - public API
 */

// Types
export type {
  Memory,
  MemoryRef,
  Session,
  MemoryKind,
  AddMemoryInput,
  RecallOptions,
  RecallResult,
  ListOptions,
  ForgetInput,
  OpenmemConfig,
} from "./types.js";
export { DEFAULT_CONFIG } from "./types.js";

// Store
export { OpenmemStore } from "./store/db.js";
export { resolveNamespace } from "./store/namespace.js";
export {
  loadConfig,
  writeConfig,
  resolveDbPath,
  resolveGlobalDbPath,
} from "./store/config.js";

// Memory
export { MemoryManager } from "./memory/manager.js";

// Policies
export {
  redact,
  isDeniedFilePath,
  toolArgsDenied,
} from "./policies/redaction.js";
export { effectiveImportance, recallScore } from "./policies/decay.js";

// Context
export { ContextCompressor } from "./context/compressor.js";
export type {
  CompressResult,
  CompressionRecord,
} from "./context/compressor.js";

// Export/Import
export {
  exportMarkdown,
  writeMarkdownFile,
  importMarkdown,
} from "./export/markdown.js";
export type { ImportResult } from "./export/markdown.js";

// Utilities
export { ulid, shortId } from "./ulid.js";
