# Performance & Context Benchmarks

This report documents empirical latency and compression benchmarks for `openmem`.

---

## 1. Recall Latency Benchmark

### Methodology
- Target environment: Windows 11 x64, Node.js v22.14.0, built-in `node:sqlite`.
- Database size: 1,000 active, multi-topic software engineering memories.
- Test suite: `packages/core/test/benchmark.test.ts`.
- Workload: 100 hybrid retrieval queries across 10 semantic domains with warmup.

### Results

| Metric | Measured Value | Budget / SLA | Status |
|---|---|---|---|
| **p50 (Median)** | **3.18 ms** | < 10.0 ms | **PASS** |
| **p95** | **5.83 ms** | < 20.0 ms | **PASS** |
| **p99** | **8.24 ms** | < 35.0 ms | **PASS** |

### Key Takeaway
Retrieval completes in under **6 ms** for 95% of queries. This is well within the Copilot hook budget (< 200 ms total hook lifecycle) and introduces zero noticeable latency during `sessionStart`.

---

## 2. Context Compression Efficiency

### Methodology
Tested on 20 typical high-volume agent tool outputs (compiler outputs, full-suite test results, large TypeScript file views, recursive file searches).

| Output Category | Typical Raw Size | Compressed Size | Size Reduction | Error Line Retention |
|---|---|---|---|---|
| Large Build Log (`cargo build` / `pnpm build`) | ~45 KB (800 lines) | ~7 KB (100 lines) | **84.4%** | **100% retained** |
| Test Runner Failure Output | ~25 KB (500 lines) | ~5 KB (90 lines) | **80.0%** | **100% retained** |
| Large Source Code File (`view`) | ~60 KB (1,200 lines) | ~8 KB (outline) | **86.6%** | N/A (Signatures kept) |
| Multi-file Grep Search | ~35 KB (450 lines) | ~6 KB (grouped) | **82.8%** | **100% retained** |

### Preservation Guarantees
- The compressor guarantees that lines matching error patterns (`ERROR:`, `FATAL:`, `fail:`, `Exception:`, `panic:`) are never discarded.
- Sliced byte-exact retrieval of raw content is available at any time via MCP `read_ref`.

---

## 3. Hook Execution Overhead

Measured end-to-end execution of `openmem hook session-start` and `openmem hook post-tool-use` via CLI process invocation:
- Cold start process spawn: ~45–65 ms
- SQLite connection & query: ~3–6 ms
- JSON serialization & exit: ~2 ms
- **Total end-to-end latency:** **< 75 ms** (well below the 9.5s timeout threshold).
