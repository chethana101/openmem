/**
 * Namespace resolution.
 * Default: SHA-256 (truncated) of the git repo root path, ensuring per-project isolation.
 * Falls back to the CWD if no git root is found.
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

export function resolveNamespace(cwd: string): string {
  try {
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return hashPath(gitRoot);
  } catch {
    return hashPath(cwd);
  }
}

function hashPath(p: string): string {
  return createHash("sha256").update(p).digest("hex").slice(0, 16);
}
