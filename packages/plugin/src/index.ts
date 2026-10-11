/**
 * openmem-plugin - Copilot CLI Plugin bundle metadata and loader.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string | undefined;
  license?: string | undefined;
  hooks: string;
  mcp: string;
  instructions: string;
}

export function getPluginPaths(): {
  manifestPath: string;
  hooksPath: string;
  mcpPath: string;
  instructionsPath: string;
} {
  return {
    manifestPath: path.join(packageRoot, "plugin.json"),
    hooksPath: path.join(packageRoot, "hooks.json"),
    mcpPath: path.join(packageRoot, "mcp.json"),
    instructionsPath: path.join(packageRoot, "copilot-instructions.md"),
  };
}

export function loadPluginManifest(): PluginManifest {
  const { manifestPath } = getPluginPaths();
  const raw = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(raw) as PluginManifest;
}

export function installPluginToDirectory(targetDir: string): {
  createdFiles: string[];
} {
  const { manifestPath, hooksPath, mcpPath, instructionsPath } = getPluginPaths();
  const createdFiles: string[] = [];

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const filesToCopy = [
    { src: manifestPath, destName: "plugin.json" },
    { src: hooksPath, destName: "hooks.json" },
    { src: mcpPath, destName: "mcp.json" },
    { src: instructionsPath, destName: "copilot-instructions.md" },
  ];

  for (const { src, destName } of filesToCopy) {
    const dest = path.join(targetDir, destName);
    fs.copyFileSync(src, dest);
    createdFiles.push(dest);
  }

  return { createdFiles };
}
