/**
 * Payload normalizer.
 *
 * Copilot supports two payload formats, selected by event-name casing:
 *   - camelCase event names  → camelCase fields, epoch-ms timestamps
 *   - PascalCase event names → snake_case fields, ISO-8601 timestamps, hook_event_name
 *
 * This normalizer converts both into a single NormalizedEvent shape.
 */

export type HookEvent =
  | "sessionStart"
  | "sessionEnd"
  | "postToolUse"
  | "postToolUseFailure"
  | "agentStop"
  | "preCompact"
  | "preToolUse"
  | "subagentStart"
  | "subagentStop"
  | "userPromptSubmitted"
  | "userPromptTransformed"
  | "errorOccurred"
  | "notification"
  | string;

export interface NormalizedEvent {
  event: HookEvent;
  sessionId: string;
  cwd: string;
  timestamp: number; // ms epoch, always
  toolName?: string | undefined;
  toolArgs?: unknown;
  toolResultText?: string | undefined;
  toolError?: string | undefined;
  transcriptPath?: string | undefined;
  stopHookActive?: boolean | undefined;
  trigger?: "manual" | "auto" | undefined;
  source?: string | undefined;
  initialPrompt?: string | undefined;
  reason?: string | undefined;
  agentName?: string | undefined;
  casing: "camel" | "pascal";
  raw: unknown; // original payload for debugging
}

/** Map PascalCase event names to camelCase canonical names */
const PASCAL_TO_CAMEL: Record<string, HookEvent> = {
  SessionStart: "sessionStart",
  SessionEnd: "sessionEnd",
  PostToolUse: "postToolUse",
  PostToolUseFailure: "postToolUseFailure",
  Stop: "agentStop",
  PreCompact: "preCompact",
  PreToolUse: "preToolUse",
  SubagentStart: "subagentStart",
  SubagentStop: "subagentStop",
  UserPromptSubmit: "userPromptSubmitted",
  UserPromptTransformed: "userPromptTransformed",
  ErrorOccurred: "errorOccurred",
  Notification: "notification",
};

export function normalizePayload(
  rawEvent: string,
  raw: unknown,
): NormalizedEvent {
  const payload = (raw ?? {}) as Record<string, unknown>;

  // Determine casing from event name
  const isPascal = /^[A-Z]/.test(rawEvent);
  const casing: "camel" | "pascal" = isPascal ? "pascal" : "camel";
  const event: HookEvent = isPascal
    ? (PASCAL_TO_CAMEL[rawEvent] ?? rawEvent)
    : rawEvent;

  // Session ID
  const sessionId = String(
    (isPascal ? payload["session_id"] : payload["sessionId"]) ?? "unknown",
  );

  // CWD
  const cwd = String(payload["cwd"] ?? process.cwd());

  // Timestamp - camelCase is epoch-ms (number), PascalCase is ISO string
  let timestamp: number;
  if (isPascal) {
    const ts = payload["timestamp"];
    timestamp = ts ? new Date(String(ts)).getTime() : Date.now();
  } else {
    const ts = payload["timestamp"];
    timestamp = typeof ts === "number" ? ts : Date.now();
  }

  // Tool name
  const toolName =
    String((isPascal ? payload["tool_name"] : payload["toolName"]) ?? "") ||
    undefined;

  // Tool args
  const toolArgs = isPascal ? payload["tool_input"] : payload["toolArgs"];

  // Tool result text (postToolUse)
  let toolResultText: string | undefined;
  if (isPascal) {
    const result = payload["tool_result"] as
      | Record<string, unknown>
      | undefined;
    toolResultText = result
      ? String(result["text_result_for_llm"] ?? "") || undefined
      : undefined;
  } else {
    const result = payload["toolResult"] as Record<string, unknown> | undefined;
    toolResultText = result
      ? String(result["textResultForLlm"] ?? "") || undefined
      : undefined;
  }

  // Tool error (postToolUseFailure)
  const toolError = String(payload["error"] ?? "") || undefined;

  // Transcript path (agentStop, preCompact, subagentStart/Stop)
  const transcriptPath =
    String(
      (isPascal ? payload["transcript_path"] : payload["transcriptPath"]) ?? "",
    ) || undefined;

  // stop_hook_active (agentStop)
  const stopHookActive =
    payload["stop_hook_active"] === true ||
    payload["stop_hook_active"] === "true";

  // trigger (preCompact)
  const triggerVal = String(
    (isPascal ? payload["trigger"] : payload["trigger"]) ?? "",
  );
  const trigger: "manual" | "auto" | undefined =
    triggerVal === "manual" || triggerVal === "auto" ? triggerVal : undefined;

  // source (sessionStart)
  const source = String(payload["source"] ?? "") || undefined;

  // initialPrompt (sessionStart)
  const initialPrompt =
    String(
      (isPascal ? payload["initial_prompt"] : payload["initialPrompt"]) ?? "",
    ) || undefined;

  // reason (sessionEnd)
  const reason = String(payload["reason"] ?? "") || undefined;

  // agentName (subagentStart/Stop)
  const agentName =
    String((isPascal ? payload["agent_name"] : payload["agentName"]) ?? "") ||
    undefined;

  return {
    event,
    sessionId,
    cwd,
    timestamp,
    toolName,
    toolArgs,
    toolResultText,
    toolError,
    transcriptPath,
    stopHookActive,
    trigger,
    source,
    initialPrompt,
    reason,
    agentName,
    casing,
    raw,
  };
}
