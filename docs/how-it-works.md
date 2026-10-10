# How openmem Works

`openmem` provides persistent memory and smart context compression across GitHub Copilot sessions without requiring cloud infrastructure or network calls.

---

## 1. Lifecycle Overview

```
               GitHub Copilot Session Lifecycle
===============================================================

  Session Start
       │
       ▼
 [hook: sessionStart] ──► Reads SQLite Store (.openmem/openmem.db)
       │                  Scores active memories (decay + relevance)
       │                  Injects formatted block into { additionalContext }
       ▼
  Agent Turn Execution
       │
       ├──► Model executes tool (e.g. bash, view, grep)
       │         │
       │         ▼
       │   [hook: postToolUse] ──► Evaluates output byte size (> threshold)
       │         │                 Checks deny list (.env, *.pem, etc.)
       │         │                 Stores full raw output in SQLite `refs`
       │         │                 Generates compact outline + ref ID (`r_...`)
       │         │                 Returns { modifiedResult: stub } to model
       │         ▼
       ├──► Model calls MCP tools (optional)
       │         │
       │         ├──► `memory_remember`: Stores new fact/rule
       │         ├──► `memory_recall`: Runs hybrid retrieval
       │         ├──► `memory_forget`: Forgets or supersedes memory
       │         └──► `read_ref`: Slices exact lines from truncated output
       │
       ▼
  Agent Turn Completed
       │
       ▼
 [hook: agentStop] ──► Guarded check (`stop_hook_active`)
       │               Optional capture prompt: Ask agent to record key learnings
       ▼
  Session End
       │
       ▼
 [hook: sessionEnd] ──► Applies exponential memory decay
                       Evicts memories exceeding capacity
                       Cleans up expired context refs
                       Updates `.openmem/memories.md` export
```

---

## 2. Memory Model & Hybrid Retrieval

Each memory record contains:
- `id`: 26-character ULID (lexicographically sortable).
- `namespace`: Truncated SHA-256 hash of the git repository root.
- `kind`: `semantic` (facts, architecture), `procedural` (rules, workflows), `episodic` (past session actions).
- `importance`: Float `0.0` to `1.0`.
- `validFrom` / `validTo`: Temporal bounds for supersession.

### Hybrid Scoring Formula
When querying memories:
$$\text{RecallScore} = \text{Decay} \times \text{AccessBoost} \times \text{Recency} \times (0.35 + 0.65 \times \text{Importance}) \times \text{Relevance}$$

1. **Decay:** $e^{-\frac{\ln(2) \cdot \Delta t}{\text{halfLife}}}$. Pinned memories have a floor of `0.3`.
2. **Access Boost:** $1.0 + 0.1 \times \min(\text{accessCount}, 5)$ rewards frequently accessed facts.
3. **Recency:** Exponential factor based on last access timestamp.
4. **Relevance:** FTS BM25 score (or keyword match ratio) normalized between $0.2$ and $1.0$.

---

## 3. Context Management & Compression

Tool outputs from commands like `cargo build`, `npm test`, or large file views frequently exhaust the model's context window.

### Per-Tool Compression Strategy
- **`bash`:** Keeps head 40 lines and tail 60 lines. **Critically preserves all lines matching error/fatal/exception patterns.**
- **`view`:** Retains module header and extracts class, interface, function, and export declarations.
- **`grep`:** Groups matches by file path and truncates repetitive hits per file.
- **`web_fetch`:** Extracts titles, document outline, and first 30 lines.

### Offloaded References
When compressed, the raw output is saved to SQLite under an ID like `r_4j9k2`. The agent can invoke MCP `read_ref` with `{ id: "r_4j9k2", start: 40, end: 80 }` to inspect any exact lines needed.

---

## 4. Contradiction & Supersession

When an updated rule or decision is recorded (e.g. "We switched from Postgres to SQLite"):
1. The new memory is inserted with `validFrom = now` and `validTo = null`.
2. The old memory is marked with `validTo = now` and `supersededBy = new_id`.
3. Standard queries exclude superseded memories, maintaining an unambiguous working context while preserving audit history in `openmem list --history`.
