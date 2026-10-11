/**
 * Individual hook event handlers.
 * Each handler receives a NormalizedEvent and returns a hook output object.
 *
 * CRITICAL: Every handler must:
 *   1. Catch all exceptions
 *   2. Return a plain object (even {} on error)
 *   3. Never throw
 *   4. Complete in < 2000ms
 */

import { execSync } from "node:child_process";
import {
  ContextCompressor,
  MemoryManager,
  OpenmemStore,
  loadConfig,
} from "openmem-core";
import { log } from "./logger.js";
import type { NormalizedEvent } from "./normalizer.js";

type HookOutput = Record<string, unknown>;

// ── sessionStart ────────────────────────────────────────────────────────────

export async function handleSessionStart(
  ev: NormalizedEvent,
): Promise<HookOutput> {
  try {
    const start = Date.now();
    const config = loadConfig(ev.cwd);
    const store = new OpenmemStore(config.dbPath);

    try {
      // Record session
      store.upsertSession({
        id: ev.sessionId,
        namespace: config.namespace,
        startedAt: ev.timestamp,
        endedAt: null,
        source: ev.source ?? null,
        endReason: null,
        hooksMsTotal: 0,
        transcriptPath: null,
      });

      // Build recall query from initial prompt or repo context
      const query = ev.initialPrompt ?? buildContextQuery(ev.cwd);

      if (!query) {
        store.addHookMs(ev.sessionId, Date.now() - start);
        return {};
      }

      const manager = new MemoryManager(store, config);
      const result = manager.recall({ query, namespace: config.namespace });

      store.addHookMs(ev.sessionId, Date.now() - start);

      if (!result.formattedBlock) return {};
      return { additionalContext: result.formattedBlock };
    } finally {
      store.close();
    }
  } catch (err) {
    log("error", "sessionStart handler failed", { message: String(err) });
    return {};
  }
}

// ── sessionEnd ──────────────────────────────────────────────────────────────

export async function handleSessionEnd(
  ev: NormalizedEvent,
): Promise<HookOutput> {
  try {
    const config = loadConfig(ev.cwd);
    const store = new OpenmemStore(config.dbPath);
    try {
      store.upsertSession({
        id: ev.sessionId,
        namespace: config.namespace,
        startedAt: ev.timestamp,
        endedAt: Date.now(),
        source: null,
        endReason: ev.reason ?? null,
        hooksMsTotal: 0,
        transcriptPath: null,
      });

      const manager = new MemoryManager(store, config);
      manager.consolidate(config.namespace);

      log("info", "sessionEnd: consolidation done", {
        sessionId: ev.sessionId,
        reason: ev.reason,
      });
    } finally {
      store.close();
    }
  } catch (err) {
    log("error", "sessionEnd handler failed", { message: String(err) });
  }
  return {};
}

// ── postToolUse ─────────────────────────────────────────────────────────────

export async function handlePostToolUse(
  ev: NormalizedEvent,
): Promise<HookOutput> {
  try {
    if (!ev.toolName || !ev.toolResultText) return {};

    const start = Date.now();
    const config = loadConfig(ev.cwd);
    const store = new OpenmemStore(config.dbPath);

    try {
      const compressor = new ContextCompressor(store, config);
      const result = compressor.maybeCompress(
        ev.toolName,
        ev.toolArgs,
        ev.toolResultText,
        ev.sessionId,
        config.namespace,
      );

      store.addHookMs(ev.sessionId, Date.now() - start);

      if (!result) return {};

      log("info", "postToolUse: compressed output", {
        tool: ev.toolName,
        refId: result.refId,
        originalBytes: result.originalBytes,
        compressedBytes: result.compressedBytes,
      });

      return {
        modifiedResult: {
          resultType: "success",
          textResultForLlm: result.compressedText,
        },
      };
    } finally {
      store.close();
    }
  } catch (err) {
    log("error", "postToolUse handler failed", { message: String(err) });
    return {};
  }
}

// ── agentStop ───────────────────────────────────────────────────────────────

export async function handleAgentStop(
  ev: NormalizedEvent,
): Promise<HookOutput> {
  try {
    const config = loadConfig(ev.cwd);

    // Guard: only block once per turn chain
    if (ev.stopHookActive) {
      log("info", "agentStop: stop_hook_active=true, skipping block");
      return {};
    }

    // Only block if capture-on-stop is enabled
    if (!config.capture.onStop) return {};

    // Record transcript path for later use
    if (ev.transcriptPath) {
      const store = new OpenmemStore(config.dbPath);
      try {
        store.setTranscriptPath(ev.sessionId, ev.transcriptPath);
      } finally {
        store.close();
      }
    }

    log("info", "agentStop: requesting memory capture");

    return {
      decision: "block",
      reason:
        "Before finishing: if you learned any durable conventions, decisions, user preferences, or gotchas during this session, call memory_remember for each one (never include secrets or credentials). If nothing worth saving, reply 'nothing to save'.",
    };
  } catch (err) {
    log("error", "agentStop handler failed", { message: String(err) });
    return {};
  }
}

// ── preCompact ──────────────────────────────────────────────────────────────

export async function handlePreCompact(
  ev: NormalizedEvent,
): Promise<HookOutput> {
  try {
    // preCompact is notification-only - no output is processed
    // We use it to save a note that compaction occurred
    if (ev.transcriptPath) {
      const config = loadConfig(ev.cwd);
      const store = new OpenmemStore(config.dbPath);
      try {
        store.setTranscriptPath(ev.sessionId, ev.transcriptPath);
      } finally {
        store.close();
      }
    }
    log("info", "preCompact", { trigger: ev.trigger, sessionId: ev.sessionId });
  } catch (err) {
    log("error", "preCompact handler failed", { message: String(err) });
  }
  return {};
}

// ── Utilities ────────────────────────────────────────────────────────────────

/** Build a context-aware query for sessionStart recall when no initialPrompt */
function buildContextQuery(cwd: string): string {
  try {
    const parts: string[] = [];

    // Repo name from directory
    const repoName = cwd.split(/[\\/]/).pop() ?? "";
    if (repoName) parts.push(repoName);

    // Current branch
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd,
        encoding: "utf8",
        timeout: 1000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (branch && branch !== "HEAD") parts.push(branch);
    } catch {
      /* ignore */
    }

    // Recent commit subjects (last 3)
    try {
      const log = execSync("git log --oneline -3 --pretty=%s", {
        cwd,
        encoding: "utf8",
        timeout: 1000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (log) parts.push(log);
    } catch {
      /* ignore */
    }

    return parts.join(" ").slice(0, 300);
  } catch {
    return "";
  }
}
