import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryManager } from "../src/memory/manager.js";
import { OpenmemStore } from "../src/store/db.js";
import { DEFAULT_CONFIG } from "../src/types.js";
import type { OpenmemConfig } from "../src/types.js";

describe("Performance Benchmark", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: OpenmemStore;
  let config: OpenmemConfig;
  let mgr: MemoryManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmem-bench-"));
    dbPath = path.join(tmpDir, "bench.db");
    store = new OpenmemStore(dbPath);
    config = {
      ...DEFAULT_CONFIG,
      dbPath,
      namespace: "bench-ns",
      memory: { capacity: 2000, decayHalfLifeDays: 30 },
    };
    mgr = new MemoryManager(store, config);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("recalls with p95 < 20ms across 1,000 memories", () => {
    // 1. Seed 1,000 memories
    const topics = [
      "authentication and OAuth tokens",
      "database migrations and postgres schema",
      "docker container deployment pipelines",
      "frontend state management and reactivity",
      "caching layers and redis cluster",
      "logging metrics and tracing OpenTelemetry",
      "unit testing and vitest coverage configurations",
      "biome linter formatting rules and git hooks",
      "API rate limiting and token bucket algorithms",
      "cloud agent environment variables and secret stores",
    ];

    const db = (store as unknown as { db: { exec: (sql: string) => void } }).db;
    db.exec("BEGIN TRANSACTION;");
    for (let i = 0; i < 1000; i++) {
      const topic = topics[i % topics.length];
      mgr.add({
        text: `Memory record #${i}: Project convention for ${topic}. Always ensure proper validation and error handling.`,
        kind: i % 3 === 0 ? "procedural" : i % 3 === 1 ? "semantic" : "episodic",
        importance: 0.1 + (i % 9) * 0.1,
        pin: i % 50 === 0,
      });
    }
    db.exec("COMMIT;");

    expect(store.countActive("bench-ns")).toBe(1000);

    // 2. Run 100 recall queries and measure latencies
    const queries = [
      "postgres database schema",
      "docker container build",
      "biome formatting rules",
      "authentication OAuth",
      "caching redis",
      "unit testing vitest",
      "OpenTelemetry metrics",
      "cloud agent secrets",
      "rate limiting token bucket",
      "frontend state management",
    ];

    const latencies: number[] = [];

    // Warmup
    mgr.recall({ query: "warmup database", namespace: "bench-ns", k: 8 });

    for (let i = 0; i < 100; i++) {
      const q = queries[i % queries.length]!;
      const t0 = performance.now();
      const res = mgr.recall({ query: q, namespace: "bench-ns", k: 8 });
      const elapsed = performance.now() - t0;
      latencies.push(elapsed);
      expect(res.memories.length).toBeGreaterThan(0);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)]!;
    const p95 = latencies[Math.floor(latencies.length * 0.95)]!;
    const p99 = latencies[Math.floor(latencies.length * 0.99)]!;

    console.log(`\n--- Recall Latency Benchmark (1,000 memories) ---`);
    console.log(`p50: ${p50.toFixed(2)} ms`);
    console.log(`p95: ${p95.toFixed(2)} ms`);
    console.log(`p99: ${p99.toFixed(2)} ms\n`);

    // Acceptance criterion: recall p95 < 20 ms
    expect(p95).toBeLessThan(20);
  });
});
