import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPluginPaths, installPluginToDirectory, loadPluginManifest } from "../src/index.js";

describe("openmem-plugin", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmem-plugin-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads a valid plugin manifest", () => {
    const manifest = loadPluginManifest();
    expect(manifest.name).toBe("openmem");
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.hooks).toBe("./hooks.json");
    expect(manifest.mcp).toBe("./mcp.json");
    expect(manifest.instructions).toBe("./copilot-instructions.md");
  });

  it("verifies bundled asset paths exist", () => {
    const paths = getPluginPaths();
    expect(fs.existsSync(paths.manifestPath)).toBe(true);
    expect(fs.existsSync(paths.hooksPath)).toBe(true);
    expect(fs.existsSync(paths.mcpPath)).toBe(true);
    expect(fs.existsSync(paths.instructionsPath)).toBe(true);
  });

  it("installs plugin files to a target directory", () => {
    const res = installPluginToDirectory(tmpDir);
    expect(res.createdFiles.length).toBe(4);
    expect(fs.existsSync(path.join(tmpDir, "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "hooks.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "mcp.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "copilot-instructions.md"))).toBe(true);

    const hooks = JSON.parse(fs.readFileSync(path.join(tmpDir, "hooks.json"), "utf8"));
    expect(hooks.hooks.sessionStart).toBeDefined();

    const mcp = JSON.parse(fs.readFileSync(path.join(tmpDir, "mcp.json"), "utf8"));
    expect(mcp.mcpServers.openmem).toBeDefined();
  });
});
