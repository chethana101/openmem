# Risks and Open Questions

This document tracks technical risks, unanswered platform behaviors, and planned investigations for `openmem`.

---

## 1. Resolved Questions

| Question | Finding / Resolution |
|---|---|
| **What is the Copilot CLI MCP config path?** | Project-level: `.mcp.json`. Global user-level: `~/.copilot/mcp-config.json`. |
| **Does `sessionEnd` contain `transcriptPath`?** | No. Only `agentStop` provides `transcriptPath`. Handled by persisting `transcriptPath` in SQLite during `agentStop`. |
| **How does payload casing differ across environments?** | Copilot CLI uses camelCase with epoch-ms timestamps. Certain schema definitions use PascalCase / snake_case with ISO-8601 strings. Unified by `openmem-hooks/normalizer.ts`. |
| **Can Windows Node v22 run SQLite FTS5?** | Windows Node v22 lacks FTS5 by default. Resolved by transparent fallback to in-process keyword occurrence ranking. |

---

## 2. Active Technical Risks

### 2.1 Copilot Hooks API Evolution
- **Risk:** GitHub Copilot is rapidly evolving; hook argument formats or event names may change in upcoming CLI releases.
- **Mitigation:**
  - Strict contract tests replaying recorded JSON fixtures.
  - Normalizer maps multiple naming conventions to a single internal representation.
  - Fail-safe wrapper ensures unknown fields or unexpected formats never crash a session turn.

### 2.2 Copilot Memory Feature Overlap
- **Risk:** GitHub recently introduced a preview Copilot Memory feature stored in the GitHub cloud.
- **Mitigation & Positioning:**
  - Focus on clear differentiators: local-first, offline availability, plain Markdown export/import, cross-tool interoperability, and context compression via `postToolUse`.
  - Provide an export/import pipeline so users can seamlessly migrate between openmem and other memory backends.

### 2.3 Sandboxed Execution Path Restrictions
- **Risk:** When Copilot CLI runs in full sandbox mode, file writes outside permitted workspace roots may fail with `EPERM`.
- **Mitigation:**
  - Store database files by default in `.openmem/` directly under the repository root.
  - `openmem doctor` checks and reminds users to verify `sandbox.userPolicy` paths.

---

## 3. Future Extensions & Spikes

1. **VS Code Chat & Agent Mode Hook Support:**
   Monitor GitHub Copilot VS Code extension releases for native hook support or unified extension hooks.
2. **Local Vector Embeddings:**
   Evaluate lightweight, in-process embeddings (e.g. transformers.js with a quantized mini-model) for semantic similarity matching on write path.
3. **Claude Code Adapter:**
   Create a thin hook adapter for Claude Code using the same normalized `openmem-core` API.
