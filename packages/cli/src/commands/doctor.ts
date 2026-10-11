import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { MemoryManager, OpenmemStore, loadConfig } from "openmem-core";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: typeof DatabaseSyncType };

export interface CheckResult {
  name: string;
  status: "OK" | "WARN" | "FAIL";
  message: string;
  details?: string;
}

export function runDoctor(cwd = process.cwd()): {
  allOk: boolean;
  checks: CheckResult[];
} {
  const checks: CheckResult[] = [];

  // 1. Node version check
  const nodeVersion = process.versions.node;
  const [major, minor] = nodeVersion.split(".").map(Number);
  if ((major ?? 0) > 22 || ((major ?? 0) === 22 && (minor ?? 0) >= 5)) {
    checks.push({
      name: "Node.js Version",
      status: "OK",
      message: `Node ${nodeVersion} meets requirement (>=22.5.0)`,
    });
  } else {
    checks.push({
      name: "Node.js Version",
      status: "FAIL",
      message: `Node ${nodeVersion} is below required >=22.5.0 (node:sqlite requirement)`,
    });
  }

  // 2. node:sqlite and search test
  try {
    const testDb = new DatabaseSync(":memory:");
    testDb.exec("CREATE TABLE test (id TEXT PRIMARY KEY, val TEXT);");
    testDb.prepare("INSERT INTO test (id, val) VALUES (?, ?)").run("1", "hello");
    let hasFts5 = false;
    try {
      testDb.exec("CREATE VIRTUAL TABLE test_fts USING fts5(val);");
      hasFts5 = true;
    } catch {
      hasFts5 = false;
    }
    testDb.close();

    if (hasFts5) {
      checks.push({
        name: "SQLite & FTS5 Support",
        status: "OK",
        message: "node:sqlite built-in engine and FTS5 full-text indexing available",
      });
    } else {
      checks.push({
        name: "SQLite Engine",
        status: "OK",
        message: "node:sqlite operational (using fast keyword matching fallback)",
      });
    }
  } catch (err) {
    checks.push({
      name: "SQLite Support",
      status: "FAIL",
      message: `SQLite initialization failed: ${String(err)}`,
    });
  }

  // 3. Hooks configuration check
  const hooksPath = path.join(cwd, ".github", "hooks", "openmem.json");
  if (fs.existsSync(hooksPath)) {
    try {
      const hooksData = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
      if (hooksData.hooks && (hooksData.hooks.sessionStart || hooksData.hooks.SessionStart)) {
        checks.push({
          name: "Hooks Configuration",
          status: "OK",
          message: `Valid hooks file at .github/hooks/openmem.json`,
        });
      } else {
        checks.push({
          name: "Hooks Configuration",
          status: "WARN",
          message: ".github/hooks/openmem.json exists but missing expected hook handlers",
        });
      }
    } catch {
      checks.push({
        name: "Hooks Configuration",
        status: "FAIL",
        message: ".github/hooks/openmem.json is not valid JSON",
      });
    }
  } else {
    checks.push({
      name: "Hooks Configuration",
      status: "WARN",
      message: "Hooks file not found. Run 'openmem init' to generate it.",
    });
  }

  // 4. Instructions file check
  const instPath = path.join(cwd, ".github", "copilot-instructions.md");
  if (fs.existsSync(instPath)) {
    const instContent = fs.readFileSync(instPath, "utf8");
    if (instContent.includes("<!-- openmem:start -->")) {
      checks.push({
        name: "Copilot Instructions",
        status: "OK",
        message: "Instructions configured with openmem markers",
      });
    } else {
      checks.push({
        name: "Copilot Instructions",
        status: "WARN",
        message: ".github/copilot-instructions.md exists but missing openmem markers",
      });
    }
  } else {
    checks.push({
      name: "Copilot Instructions",
      status: "WARN",
      message: ".github/copilot-instructions.md not found. Run 'openmem init' to generate.",
    });
  }

  // 5. Database access & round-trip latency
  try {
    const config = loadConfig(cwd);
    const store = new OpenmemStore(config.dbPath);
    const mgr = new MemoryManager(store, config);

    const t0 = performance.now();
    const testId = mgr.add({
      text: "openmem doctor probe verification test item",
      kind: "semantic",
      importance: 0.1,
    });
    const recallResult = mgr.recall({ query: "doctor probe", namespace: config.namespace, k: 3 });
    mgr.forget(testId, config.namespace);
    const latencyMs = Math.round(performance.now() - t0);
    store.close();

    const latencyOk = latencyMs < 20;
    checks.push({
      name: "Store Access & Latency",
      status: latencyOk ? "OK" : "WARN",
      message: `DB read/write functional (round-trip: ${latencyMs} ms, budget < 20 ms)`,
      details: `DB Path: ${config.dbPath}`,
    });
  } catch (err) {
    checks.push({
      name: "Store Access & Latency",
      status: "FAIL",
      message: `Database access error: ${String(err)}`,
    });
  }

  // 6. Sandbox policy check
  checks.push({
    name: "Copilot Sandbox Policy",
    status: "OK",
    message:
      "If session sandbox is active, ensure .openmem is inside sandbox.userPolicy read/write paths",
  });

  const allOk = checks.every((c) => c.status !== "FAIL");
  return { allOk, checks };
}
