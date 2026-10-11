import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { OpenmemStore } from "openmem-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDoctor } from "../src/commands/doctor.js";
import { runInit } from "../src/commands/init.js";
import {
  runAdd,
  runExplain,
  runExport,
  runForget,
  runImport,
  runList,
  runRecall,
  runStats,
} from "../src/commands/memory.js";

describe("CLI Commands", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmem-cli-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("init command", () => {
    it("initializes project structure, config, hooks, and instructions", () => {
      const res = runInit({ cwd: tmpDir });
      expect(res.success).toBe(true);

      // Verify files created
      expect(fs.existsSync(path.join(tmpDir, ".openmem", "config.json"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, ".gitignore"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, ".github", "hooks", "openmem.json"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, ".mcp.json"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, ".github", "copilot-instructions.md"))).toBe(true);

      // Verify gitignore contents
      const gitignore = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf8");
      expect(gitignore).toContain(".openmem/openmem.db");

      // Verify hooks structure
      const hooks = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".github", "hooks", "openmem.json"), "utf8"),
      );
      expect(hooks.hooks.sessionStart).toBeDefined();
      expect(hooks.hooks.postToolUse).toBeDefined();

      // Verify instructions contain openmem marker
      const instructions = fs.readFileSync(
        path.join(tmpDir, ".github", "copilot-instructions.md"),
        "utf8",
      );
      expect(instructions).toContain("<!-- openmem:start -->");
      expect(instructions).toContain("<!-- openmem:end -->");
    });

    it("supports --vscode-format / PascalCase hooks", () => {
      runInit({ cwd: tmpDir, vscodeFormat: true });
      const hooks = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".github", "hooks", "openmem.json"), "utf8"),
      );
      expect(hooks.hooks.SessionStart).toBeDefined();
      expect(hooks.hooks.PostToolUse).toBeDefined();
    });

    it("supports --cloud-agent mode", () => {
      runInit({ cwd: tmpDir, cloudAgent: true });
      expect(fs.existsSync(path.join(tmpDir, ".github", "openmem", "memories.md"))).toBe(true);
    });

    it("is idempotent when run repeatedly", () => {
      const first = runInit({ cwd: tmpDir });
      expect(first.createdFiles.length).toBeGreaterThan(0);

      const second = runInit({ cwd: tmpDir });
      expect(second.success).toBe(true);
      expect(second.createdFiles.length).toBe(0);
    });
  });

  describe("doctor command", () => {
    it("reports diagnostics correctly", () => {
      // First initialize
      runInit({ cwd: tmpDir });

      const doc = runDoctor(tmpDir);
      expect(doc.checks.length).toBeGreaterThanOrEqual(5);

      const nodeCheck = doc.checks.find((c) => c.name === "Node.js Version");
      expect(nodeCheck?.status).toBe("OK");

      const sqliteCheck = doc.checks.find((c) => c.name.includes("SQLite"));
      expect(sqliteCheck?.status).toBe("OK");

      const hooksCheck = doc.checks.find((c) => c.name === "Hooks Configuration");
      expect(hooksCheck?.status).toBe("OK");

      const instCheck = doc.checks.find((c) => c.name === "Copilot Instructions");
      expect(instCheck?.status).toBe("OK");

      const latencyCheck = doc.checks.find((c) => c.name === "Store Access & Latency");
      expect(latencyCheck?.status).not.toBe("FAIL");
    });
  });

  describe("memory lifecycle commands", () => {
    beforeEach(() => {
      runInit({ cwd: tmpDir });
    });

    it("adds and recalls memories via CLI functions", () => {
      const addRes = runAdd("We use PostgreSQL for all user data.", {
        kind: "semantic",
        importance: 0.9,
        cwd: tmpDir,
      });
      expect(typeof addRes.id).toBe("string");
      expect(addRes.id.length).toBeGreaterThan(0);

      const recallRes = runRecall("PostgreSQL database", { cwd: tmpDir });
      expect(recallRes.count).toBe(1);
      expect(recallRes.text).toContain("PostgreSQL for all user data");
    });

    it("lists stored memories and filters by kind", () => {
      runAdd("Semantic architectural rule", { kind: "semantic", cwd: tmpDir });
      runAdd("Procedural workflow step", { kind: "procedural", cwd: tmpDir });

      const allList = runList({ cwd: tmpDir });
      expect(allList.length).toBe(2);

      const proceduralOnly = runList({ kind: "procedural", cwd: tmpDir });
      expect(proceduralOnly.length).toBe(1);
      expect(proceduralOnly[0]?.kind).toBe("procedural");
    });

    it("forgets memories individually or all at once", () => {
      const m1 = runAdd("Temporary note 1", { cwd: tmpDir });
      const m2 = runAdd("Temporary note 2", { cwd: tmpDir });

      const forget1 = runForget({ id: m1.id, cwd: tmpDir });
      expect(forget1.forgotten).toBe(1);

      let list = runList({ cwd: tmpDir });
      expect(list.length).toBe(1);
      expect(list[0]?.id).toBe(m2.id);

      const forgetAll = runForget({ all: true, cwd: tmpDir });
      expect(forgetAll.forgotten).toBe(1);

      list = runList({ cwd: tmpDir });
      expect(list.length).toBe(0);
    });

    it("exports memories to Markdown and imports them back", () => {
      runAdd("Critical standard: always write unit tests.", {
        kind: "procedural",
        pin: true,
        importance: 0.95,
        cwd: tmpDir,
      });

      const exportPath = path.join(tmpDir, "exported.md");
      const exportRes = runExport({ out: exportPath, cwd: tmpDir });
      expect(exportRes.count).toBe(1);
      expect(fs.existsSync(exportPath)).toBe(true);

      const mdContent = fs.readFileSync(exportPath, "utf8");
      expect(mdContent).toContain("Critical standard: always write unit tests.");

      // Clear DB
      runForget({ all: true, cwd: tmpDir });
      expect(runList({ cwd: tmpDir }).length).toBe(0);

      // Import back
      const importRes = runImport(exportPath, { cwd: tmpDir });
      expect(importRes.added).toBe(1);

      const importedList = runList({ cwd: tmpDir });
      expect(importedList.length).toBe(1);
      expect(importedList[0]?.text).toContain("always write unit tests");
    });

    it("reports stats and explain logs", () => {
      runAdd("A memory for stats verification", { cwd: tmpDir });

      // Add a compressed ref directly to store
      const dbPath = path.join(tmpDir, ".openmem", "openmem.db");
      const store = new OpenmemStore(dbPath);
      store.insertRef({
        id: "r_cli_explain_test",
        namespace: "test-ns",
        sessionId: "sess-1",
        toolName: "bash",
        toolArgs: null,
        content: "Detailed output line 1\nDetailed output line 2\nError: build failed",
        bytes: 65,
        createdAt: Date.now(),
        expiresAt: null,
      });
      store.close();

      const stats = runStats({ cwd: tmpDir });
      expect(stats.activeMemories).toBe(1);

      const explain = runExplain({ cwd: tmpDir });
      expect(Array.isArray(explain)).toBe(true);
    });
  });
});
