/**
 * Hook logger - writes to .openmem/logs/hook.log (rotating by size).
 * NEVER writes to stdout (reserved for JSON output to Copilot).
 * NEVER logs full tool output or secrets.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MiB before rotation
const LOG_DIR_NAME = ".openmem";
const LOG_FILE_NAME = "hook.log";

let logPath: string | null = null;
let logFd: number | null = null;

export function initLogger(cwd: string): void {
  const dir = path.join(cwd, LOG_DIR_NAME, "logs");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, LOG_FILE_NAME);

    // Rotate if too large
    try {
      const stat = fs.statSync(logPath);
      if (stat.size > MAX_LOG_BYTES) {
        fs.renameSync(logPath, logPath + ".1");
      }
    } catch {
      // File doesn't exist yet - fine
    }

    logFd = fs.openSync(logPath, "a");
  } catch {
    // If we can't open log, silently continue - hook must never fail
    logFd = null;
  }
}

export function log(
  level: "info" | "warn" | "error",
  message: string,
  data?: unknown,
): void {
  if (logFd === null) return;
  try {
    const ts = new Date().toISOString();
    const dataStr =
      data !== undefined ? " " + JSON.stringify(data).slice(0, 500) : "";
    const line = `${ts} [${level.toUpperCase()}] ${message}${dataStr}\n`;
    fs.writeSync(logFd, line);
  } catch {
    // Ignore log errors
  }
}

export function closeLogger(): void {
  if (logFd !== null) {
    try {
      fs.closeSync(logFd);
    } catch {
      // ignore
    }
    logFd = null;
  }
}
