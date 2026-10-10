import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OPENMEM_END_MARKER,
  OPENMEM_START_MARKER,
  applyInstructions,
  removeInstructions,
  writeInstructionsFile,
} from "../src/generator.js";

describe("Instructions generator", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmem-test-inst-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends instructions to empty or new content", () => {
    const empty = "";
    const result = applyInstructions(empty);
    expect(result).toContain(OPENMEM_START_MARKER);
    expect(result).toContain(OPENMEM_END_MARKER);
    expect(result).toContain("## Project memory (openmem)");
  });

  it("is idempotent: re-running replaces between markers without duplicating", () => {
    const existing = "# My Project\n\nSome custom instructions here.\n";
    const pass1 = applyInstructions(existing);
    expect(pass1).toContain("# My Project");
    expect(pass1).toContain("Some custom instructions here.");
    expect(pass1.indexOf(OPENMEM_START_MARKER)).toBe(pass1.lastIndexOf(OPENMEM_START_MARKER));

    // Re-run
    const pass2 = applyInstructions(pass1);
    expect(pass2).toBe(pass1);
    expect(pass2.indexOf(OPENMEM_START_MARKER)).toBe(pass2.lastIndexOf(OPENMEM_START_MARKER));
  });

  it("removes instructions cleanly", () => {
    const original = "# My Project\n\nSome guidelines.\n";
    const withInst = applyInstructions(original);
    const cleaned = removeInstructions(withInst);
    expect(cleaned).toContain("# My Project");
    expect(cleaned).toContain("Some guidelines.");
    expect(cleaned).not.toContain(OPENMEM_START_MARKER);
  });

  it("writes instructions to file and reports creation/update status", () => {
    const targetFile = path.join(tmpDir, ".github", "copilot-instructions.md");

    // First write: creates file
    const res1 = writeInstructionsFile(targetFile);
    expect(res1.created).toBe(true);
    expect(res1.changed).toBe(true);
    expect(fs.existsSync(targetFile)).toBe(true);

    // Second write without changes: not updated
    const res2 = writeInstructionsFile(targetFile);
    expect(res2.created).toBe(false);
    expect(res2.updated).toBe(false);
    expect(res2.changed).toBe(false);
  });
});
