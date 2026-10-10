/**
 * Config loading for openmem.
 * Reads .openmem/config.json from the repo root (or CWD), merges with defaults.
 * Environment variable OPENMEM_DB overrides the DB path.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { OpenmemConfig } from "../types.js";
import { DEFAULT_CONFIG } from "../types.js";
import { resolveNamespace } from "./namespace.js";

export function resolveDbPath(cwd: string): string {
  // Env override takes highest priority
  if (process.env["OPENMEM_DB"]) {
    return process.env["OPENMEM_DB"];
  }
  // Prefer repo-local DB
  const localDir = path.join(cwd, ".openmem");
  return path.join(localDir, "openmem.db");
}

export function resolveGlobalDbPath(): string {
  if (process.env["OPENMEM_DB"]) return process.env["OPENMEM_DB"];
  return path.join(os.homedir(), ".openmem", "openmem.db");
}

export function loadConfig(cwd: string): OpenmemConfig {
  const configPath = path.join(cwd, ".openmem", "config.json");
  let fileConfig: Partial<OpenmemConfig> = {};

  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(
        fs.readFileSync(configPath, "utf8"),
      ) as Partial<OpenmemConfig>;
    } catch {
      // Ignore malformed config - use defaults
    }
  }

  const dbPath = resolveDbPath(cwd);
  const namespace = resolveNamespace(cwd);

  return {
    dbPath,
    namespace,
    capture: { ...DEFAULT_CONFIG.capture, ...fileConfig.capture },
    context: { ...DEFAULT_CONFIG.context, ...fileConfig.context },
    memory: { ...DEFAULT_CONFIG.memory, ...fileConfig.memory },
  };
}

export function writeConfig(
  cwd: string,
  config: Partial<Omit<OpenmemConfig, "dbPath" | "namespace">>,
): void {
  const dir = path.join(cwd, ".openmem");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, "config.json");
  const existing = fs.existsSync(configPath)
    ? (JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
        string,
        unknown
      >)
    : {};
  fs.writeFileSync(
    configPath,
    JSON.stringify({ ...existing, ...config }, null, 2) + "\n",
  );
}
