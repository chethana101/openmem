import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextCompressor } from "../src/context/compressor.js";
import { OpenmemStore } from "../src/store/db.js";
import { DEFAULT_CONFIG } from "../src/types.js";
import type { OpenmemConfig } from "../src/types.js";

describe("ContextCompressor", () => {
  let tmpDir: string;
  let store: OpenmemStore;
  let config: OpenmemConfig;
  let compressor: ContextCompressor;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmem-test-comp-"));
    const dbPath = path.join(tmpDir, "test.db");
    store = new OpenmemStore(dbPath);
    config = {
      ...DEFAULT_CONFIG,
      dbPath,
      namespace: "test-ns",
      context: {
        ...DEFAULT_CONFIG.context,
        threshold: 200, // lower threshold for testing
      },
    };
    compressor = new ContextCompressor(store, config);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips compression when output is below threshold", () => {
    const shortText = "Small build output: done in 100ms.";
    const result = compressor.maybeCompress("bash", {}, shortText, "sess-1", "test-ns");
    expect(result).toBeNull();
  });

  it("skips compression when tool is on deny list", () => {
    const customConfig: OpenmemConfig = {
      ...config,
      context: {
        ...config.context,
        denyList: ["git_diff"],
      },
    };
    const comp = new ContextCompressor(store, customConfig);
    const bigOutput = "a\n".repeat(500);
    const result = comp.maybeCompress("git_diff", {}, bigOutput, "sess-1", "test-ns");
    expect(result).toBeNull();
  });

  it("skips compression when toolArgs point to sensitive files", () => {
    const bigOutput = "a\n".repeat(500);
    const result = compressor.maybeCompress(
      "view",
      { path: ".env.production" },
      bigOutput,
      "sess-1",
      "test-ns",
    );
    expect(result).toBeNull();
  });

  it("compresses large bash output while preserving error lines", () => {
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) {
      if (i === 75) {
        lines.push("ERROR: compilation failed on file src/main.rs: line 42");
      } else if (i === 120) {
        lines.push("FATAL: out of memory during linking");
      } else {
        lines.push(`Info log item line ${i}: building artifact...`);
      }
    }
    const fullText = lines.join("\n");

    const result = compressor.maybeCompress(
      "bash",
      { command: "cargo build" },
      fullText,
      "sess-1",
      "test-ns",
    );
    expect(result).not.toBeNull();
    expect(result!.compressedBytes).toBeLessThan(result!.originalBytes);

    // Verify errors are preserved
    expect(result!.compressedText).toContain(
      "ERROR: compilation failed on file src/main.rs: line 42",
    );
    expect(result!.compressedText).toContain("FATAL: out of memory during linking");
    expect(result!.compressedText).toContain("[openmem: output truncated from");
    expect(result!.compressedText).toContain(`Full output stored as ref ${result!.refId}`);

    // Verify ref can be retrieved
    const retrieved = compressor.readRef(result!.refId);
    expect(retrieved).toBe(fullText);

    // Verify slicing ref lines
    const sliced = compressor.readRef(result!.refId, 1, 3);
    expect(sliced).toBe(lines.slice(0, 3).join("\n"));
  });

  it("compresses large file view output with signature outline", () => {
    const lines: string[] = [];
    lines.push("import * as fs from 'node:fs';");
    for (let i = 0; i < 150; i++) {
      if (i === 10) lines.push("export class DataStore {");
      else if (i === 20) lines.push("  export function loadData(): void {");
      else lines.push(`  const x_${i} = ${i};`);
    }
    const fullText = lines.join("\n");

    const result = compressor.maybeCompress(
      "view",
      { path: "src/store.ts" },
      fullText,
      "sess-1",
      "test-ns",
    );
    expect(result).not.toBeNull();
    expect(result!.compressedText).toContain("File outline (src/store.ts)");
    expect(result!.compressedText).toContain("export class DataStore");
  });

  it("compresses large grep output grouping by file", () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`src/models/user.ts:${i + 1}: const name = "test";`);
    }
    const fullText = lines.join("\n");

    const result = compressor.maybeCompress(
      "grep",
      { query: "name" },
      fullText,
      "sess-1",
      "test-ns",
    );
    expect(result).not.toBeNull();
    expect(result!.compressedText).toContain("src/models/user.ts");
    expect(result!.compressedText).toContain("more matches");
  });

  it("compresses web_fetch content", () => {
    const webText = [
      "# Official Documentation",
      "Welcome to the agent documentation.",
      "## Getting Started",
      "Step 1: Install prerequisites.",
      "## API Reference",
      "Endpoint details.",
      ...Array.from({ length: 100 }, (_, i) => `Paragraph line ${i} of web page body content`),
    ].join("\n");

    const result = compressor.maybeCompress(
      "web_fetch",
      { url: "https://example.com" },
      webText,
      "sess-1",
      "test-ns",
    );
    expect(result).not.toBeNull();
    expect(result!.compressedText).toContain("[Web page summary]");
    expect(result!.compressedText).toContain("Title: # Official Documentation");
    expect(result!.compressedText).toContain("## Getting Started");
  });

  it("compresses generic long tool output", () => {
    const lines = Array.from({ length: 150 }, (_, i) => `Generic tool line ${i}`);
    const fullText = lines.join("\n");

    const result = compressor.maybeCompress("unknown_tool", {}, fullText, "sess-1", "test-ns");
    expect(result).not.toBeNull();
    expect(result!.compressedText).toContain("more lines omitted");
  });
});
