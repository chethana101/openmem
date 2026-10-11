# Copilot Platform Notes & Specifications

This document tracks verified facts, runtime behaviors, and constraints discovered across GitHub Copilot CLI, GitHub Copilot Cloud Agent, and the Copilot ecosystem.

---

## 1. Surfaces

| Surface | Hook Support | MCP Support | Custom Instructions | Notes |
|---|---|---|---|---|
| **Copilot CLI** | Full (`.github/hooks/*.json`, `~/.copilot/hooks/*.json`) | Full (`.mcp.json`, `~/.copilot/mcp-config.json`) | Full (`.github/copilot-instructions.md`) | Primary target. Full interactive shell and subagent workflows. |
| **Copilot Cloud Agent** | Repo-level only (`.github/hooks/*.json`) | In development | Full (`.github/copilot-instructions.md`) | Ephemeral container execution; egress network restricted. |
| **VS Code / JetBrains IDE** | Not documented for chat | Standard VS Code MCP | Standard `.github/copilot-instructions.md` | Hooks are CLI/Cloud agent specific at present. |

---

## 2. Hook Configuration Locations & Schemas

### 2.1 Project vs. Global Discovery
Copilot CLI discovers hook files in:
1. **Repository root:** `.github/hooks/*.json` (loaded when working inside a repo).
2. **User home directory:** `~/.copilot/hooks/*.json` or `$COPILOT_HOME/hooks/*.json`.
3. **Inline settings:** `settings.json` under the `"hooks"` key.

### 2.2 Hook Event Casing & Formats
Copilot uses two distinct payload casing conventions:
- **camelCase Format:**
  - Used by standard Copilot CLI hooks.
  - Event names: `sessionStart`, `postToolUse`, `agentStop`, `preCompact`, `sessionEnd`.
  - Timestamps: Numeric epoch milliseconds (e.g. `1700000000000`).
- **PascalCase / snake_case Format:**
  - Used in certain VS Code / external schema definitions.
  - Event names: `SessionStart`, `PostToolUse`, `AgentStop`, `PreCompact`, `SessionEnd`.
  - Contains `hook_event_name: "PostToolUse"` and ISO-8601 string timestamps (e.g. `"2026-10-08T12:00:00Z"`).
  - Uses snake_case fields like `tool_name`, `tool_args`, `tool_result`.

**Our Solution:** `openmem-hooks/normalizer.ts` normalizes both payload variations into a unified `NormalizedEvent` contract so all handlers execute identically.

---

## 3. Hook Behavioral Rules & Constraints

### 3.1 Strict Fail-Safe Guarantee
- If a hook exits with non-zero or prints invalid JSON to stdout, Copilot may abort or fail the session turn.
- Every `openmem hook <event>` invocation is wrapped in a fail-safe runner:
  - Catches all uncaught exceptions and rejections.
  - Enforces a 9.5s execution timeout.
  - Writes **only** a single valid JSON object to `stdout` (`{}` or `{ additionalContext: ... }`).
  - Logs diagnostics to stderr or `.openmem/logs/hook.log`.
  - **Always exits with status 0.**

### 3.2 Output Field Contracts
- `sessionStart`: Returns `{ "additionalContext": "..." }`. This content is injected into the model's system context for that session.
- `postToolUse`: Returns `{ "modifiedResult": "..." }`. The model receives this modified text instead of the original raw tool output.
- `agentStop`: Returns `{ "decision": "block", "reason": "..." }` or `{}`. If `decision: "block"`, the agent is forced to continue the turn. Guarded by `stop_hook_active` to prevent loops!
- `preCompact`: Notification only. Emits `{}`.
- `sessionEnd`: Clean-up notification. Emits `{}`.

### 3.3 Transcript Availability
- `agentStop` includes `transcriptPath` in its payload.
- `sessionEnd` does **NOT** provide `transcriptPath`. It only includes `sessionId`, `timestamp`, `cwd`, and `reason`.
- Therefore, `openmem` records `transcriptPath` during `agentStop` into the `sessions` table in SQLite so it remains accessible during session finalization.

---

## 4. MCP Configuration

- Project-level: `.mcp.json` or `.github/mcp.json`
- Global user-level: `~/.copilot/mcp-config.json`
- Schema:
```json
{
  "mcpServers": {
    "openmem": {
      "command": "openmem",
      "args": ["mcp"],
      "type": "stdio"
    }
  }
}
```

---

## 5. SQLite & Runtime Specifics

### 5.1 `node:sqlite` Built-in Engine
- Node.js ≥ 22.5 includes native `DatabaseSync` under `node:sqlite`.
- **FTS5 Module on Windows:** The official Node.js v22 Windows binary is compiled without the SQLite FTS5 extension (`no such module: fts5`).
- `openmem-core` detects FTS5 at database initialization:
  - If FTS5 is available: uses `fts5` virtual table with `bm25()` ranking.
  - If FTS5 is unavailable: falls back to an in-process keyword matching and token occurrence scoring algorithm that provides identical hybrid retrieval without external native compilation dependencies!

### 5.2 Sandbox Execution
- When Copilot's session sandbox is enabled, commands spawned by hooks execute inside the sandbox.
- Repository-local paths (`.openmem/`) must be included in `sandbox.userPolicy` read/write permissions.
