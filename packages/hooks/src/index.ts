/**
 * Hook entry point - `openmem hook <event>`
 *
 * Reads JSON from stdin, normalizes payload, dispatches to handler,
 * and writes exactly ONE JSON object to stdout. Exit code always 0.
 *
 * Rule: NEVER write non-JSON to stdout. Log to file only.
 */

import {
  handleAgentStop,
  handlePostToolUse,
  handlePreCompact,
  handleSessionEnd,
  handleSessionStart,
} from "./handlers.js";
import { closeLogger, initLogger, log } from "./logger.js";
import { normalizePayload } from "./normalizer.js";

const TIMEOUT_MS = 9500; // Hard timeout - hooks timeout at 10-15s; we exit before then

export async function run(customEventArg?: string): Promise<void> {
  const eventArg = customEventArg ?? process.argv[2] ?? "";

  // Map CLI arg (kebab-case) to camelCase event name
  const EVENT_MAP: Record<string, string> = {
    "session-start": "sessionStart",
    "session-end": "sessionEnd",
    "post-tool-use": "postToolUse",
    "agent-stop": "agentStop",
    "pre-compact": "preCompact",
    "pre-tool-use": "preToolUse",
  };
  const eventName = EVENT_MAP[eventArg] ?? eventArg;

  // Read stdin
  let rawInput = "";
  try {
    for await (const chunk of process.stdin) {
      rawInput += chunk;
    }
  } catch {
    emit({});
    return;
  }

  // Parse JSON
  let parsed: unknown = {};
  try {
    parsed = rawInput.trim() ? JSON.parse(rawInput) : {};
  } catch {
    emit({});
    return;
  }

  // Init logger using cwd from payload or process.cwd()
  const cwd =
    typeof parsed === "object" && parsed !== null
      ? String((parsed as Record<string, unknown>)["cwd"] ?? process.cwd())
      : process.cwd();

  initLogger(cwd);

  // Set a hard timeout
  const timer = setTimeout(() => {
    log("warn", "hook timeout reached, emitting {}");
    emit({});
    process.exit(0);
  }, TIMEOUT_MS);

  try {
    const ev = normalizePayload(eventName, parsed);
    log("info", `hook ${eventName}`, { sessionId: ev.sessionId, cwd: ev.cwd });

    const start = Date.now();
    let output: Record<string, unknown> = {};

    switch (ev.event) {
      case "sessionStart":
        output = await handleSessionStart(ev);
        break;
      case "sessionEnd":
        output = await handleSessionEnd(ev);
        break;
      case "postToolUse":
        output = await handlePostToolUse(ev);
        break;
      case "agentStop":
        output = await handleAgentStop(ev);
        break;
      case "preCompact":
        output = await handlePreCompact(ev);
        break;
      default:
        // Unknown event - return empty (fail-open)
        output = {};
    }

    log("info", `hook ${eventName} done`, { ms: Date.now() - start });
    clearTimeout(timer);
    emit(output);
  } catch (err) {
    log("error", "Unhandled hook error", { message: String(err) });
    clearTimeout(timer);
    emit({});
  } finally {
    closeLogger();
  }
}

function emit(obj: Record<string, unknown>): void {
  // Write exactly one JSON object to stdout, followed by newline
  process.stdout.write(JSON.stringify(obj) + "\n");
}

export {
  normalizePayload,
  handleSessionStart,
  handleSessionEnd,
  handlePostToolUse,
  handleAgentStop,
  handlePreCompact,
};

// If run directly as a script (e.g. node dist/index.js session-start)
if (
  process.argv[1]?.endsWith("hooks/dist/index.js") ||
  process.argv[1]?.endsWith("hooks/src/index.ts")
) {
  run().catch(() => {
    emit({});
    process.exit(0);
  });
}
