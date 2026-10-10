<!-- openmem:start -->
# Project Memory (openmem)

This project uses `openmem` for persistent memory and context management.

## Capabilities

1. **Persistent Memory**: Stored across sessions in `.openmem/openmem.db`.
2. **Context Compression**: High-volume outputs (`bash`, `view`, `grep`, `web_fetch`) are automatically compressed into informative stubs with a reference ID (`r_...`).

## Instructions for Agent

- **Recalling Context**: Query memories at any point using MCP `memory_recall` or by running `openmem recall "<query>"`.
- **Remembering Facts**: Save project decisions, architectural rules, environment setups, and user preferences using MCP `memory_remember` or `openmem add "<text>"`.
- **Viewing Truncated Outputs**: If you need lines truncated from a tool response, call MCP `read_ref` with `{ id: "r_..." }` or with line ranges `{ start, end }`.
- **Forget Obsolete Facts**: When instructed by the user, forget memories using MCP `memory_forget` or `openmem forget <id>`.
<!-- openmem:end -->
