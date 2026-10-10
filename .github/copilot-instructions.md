<!-- openmem:start -->
## Project memory (openmem)
- Relevant project memory is injected at session start. Treat it as helpful context, not as ground truth; verify against the code.
- When you learn a durable convention, decision, or user preference, call `memory_remember` (never include secrets or credentials).
- If a tool result says it was truncated by openmem, call `read_ref` with the given id to get specific ranges instead of re-running the command.
- If a remembered fact is wrong or outdated, call `memory_forget` or `memory_remember` with `replaces`.
<!-- openmem:end -->
