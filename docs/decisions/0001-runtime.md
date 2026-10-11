# ADR 0001: Runtime Environment and SQLite Driver

## Context
`openmem` must operate as an extension point for GitHub Copilot across diverse developer environments (Windows, macOS, Linux). It executes during time-sensitive lifecycle hooks (`sessionStart`, `postToolUse`, `agentStop`), requiring low startup overhead, zero external database setup, and cross-platform reliability.

We evaluated three potential execution strategies:
1. **Node.js ≥ 22 with built-in `node:sqlite`**
2. **Node.js with native C++ addons (`better-sqlite3`)**
3. **Compiled native binary (Go or Rust)**

---

## Decision

We chose **Node.js ≥ 22 with built-in `node:sqlite`** (with an automatic keyword fallback for platforms where FTS5 is not precompiled into the Node binary).

---

## Rationale

1. **Zero Native Compilation Overhead:**
   Using `better-sqlite3` requires node-gyp, Python, and C++ compiler toolchains during `npm install` / `pnpm install`. This frequently breaks in CI environments, Docker containers, and on locked-down Windows developer machines.
   In contrast, `node:sqlite` is built directly into Node.js 22.5+.

2. **Cold Start Performance:**
   A standard Node CLI process spawn takes 45–65 ms on modern machines, which comfortably meets our < 200 ms total hook budget. A separate background daemon is not needed for v0.x.

3. **Ecosystem Fit:**
   Both the GitHub Copilot CLI and Model Context Protocol (MCP) TypeScript SDK are built on JavaScript/TypeScript. Implementing `openmem` in TypeScript ensures direct interoperability with `@modelcontextprotocol/sdk` and standard Node stdio streams.

4. **Handling the Windows FTS5 Limitation:**
   The official Windows x64 distribution of Node v22.14 does not bundle the SQLite FTS5 extension. Rather than failing or falling back to slow native builds, `openmem-core` detects FTS5 support at runtime. If absent, it activates an in-process keyword matching and token ranking engine that provides equivalent BM25-like scoring semantics without native crashes.

---

## Consequences

- Requires Node.js ≥ 22.5.0. Verified during `openmem doctor`.
- Future optimizations: If sub-10ms process invocation becomes critical for tight hook budgets on low-power devices, a compiled Go or Rust binary can be introduced for the `hook` subcommand while retaining TypeScript for core/MCP.
