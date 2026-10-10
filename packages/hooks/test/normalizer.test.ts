import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePayload } from "../src/normalizer.js";

describe("Hooks payload normalizer", () => {
  const fixturesDir = path.resolve(__dirname, "../../../test/fixtures");

  it("normalizes camelCase sessionStart payload", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "sessionStart_camel.json"), "utf8"),
    );
    const ev = normalizePayload("sessionStart", raw);

    expect(ev.event).toBe("sessionStart");
    expect(ev.sessionId).toBe("sess_01JTESTCAMELSESSIONSTART001");
    expect(ev.casing).toBe("camel");
    expect(ev.timestamp).toBe(1728410000000);
    expect(ev.initialPrompt).toContain("How do I build the core package");
    expect(ev.source).toBe("new");
  });

  it("normalizes PascalCase SessionStart payload with ISO timestamp", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "sessionStart_pascal.json"), "utf8"),
    );
    const ev = normalizePayload("SessionStart", raw);

    expect(ev.event).toBe("sessionStart");
    expect(ev.sessionId).toBe("sess_01JTESTPASCALSESSIONSTART002");
    expect(ev.casing).toBe("pascal");
    expect(ev.timestamp).toBe(Date.parse("2026-10-08T18:00:00.000Z"));
    expect(ev.initialPrompt).toBe("Run tests across all workspaces");
    expect(ev.source).toBe("startup");
  });

  it("normalizes camelCase postToolUse payload", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "postToolUse_bash_camel.json"), "utf8"),
    );
    const ev = normalizePayload("postToolUse", raw);

    expect(ev.event).toBe("postToolUse");
    expect(ev.toolName).toBe("bash");
    expect(ev.toolArgs).toEqual({ command: "pnpm test" });
    expect(ev.toolResultText).toContain("PASS  packages/core/test/store.test.ts");
  });

  it("normalizes PascalCase PostToolUse payload", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "postToolUse_bash_pascal.json"), "utf8"),
    );
    const ev = normalizePayload("PostToolUse", raw);

    expect(ev.event).toBe("postToolUse");
    expect(ev.toolName).toBe("bash");
    expect(ev.toolArgs).toEqual({ command: "cat /var/log/build.log" });
    expect(ev.toolResultText).toContain("Build completed with 0 errors");
  });

  it("normalizes agentStop with stop_hook_active guard", () => {
    const rawCamel = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "agentStop_camel.json"), "utf8"),
    );
    const ev1 = normalizePayload("agentStop", rawCamel);
    expect(ev1.stopHookActive).toBe(false);
    expect(ev1.transcriptPath).toContain("transcripts");

    const rawPascal = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "agentStop_pascal.json"), "utf8"),
    );
    const ev2 = normalizePayload("AgentStop", rawPascal);
    expect(ev2.stopHookActive).toBe(true);
    expect(ev2.transcriptPath).toBe("/workspace/.copilot/transcript.jsonl");
  });

  it("normalizes preCompact trigger and sessionEnd reason", () => {
    const rawPre = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "preCompact_pascal.json"), "utf8"),
    );
    const evPre = normalizePayload("PreCompact", rawPre);
    expect(evPre.trigger).toBe("manual");

    const rawEnd = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "sessionEnd_camel.json"), "utf8"),
    );
    const evEnd = normalizePayload("sessionEnd", rawEnd);
    expect(evEnd.reason).toBe("user_exit");
  });

  it("handles malformed, empty, or invalid input safely", () => {
    const ev = normalizePayload("unknownEvent", null);
    expect(ev.event).toBe("unknownEvent");
    expect(ev.sessionId).toBe("unknown");
    expect(ev.cwd).toBe(process.cwd());
    expect(typeof ev.timestamp).toBe("number");
  });
});
