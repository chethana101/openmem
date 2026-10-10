import * as fs from "node:fs";
import * as path from "node:path";

export const OPENMEM_START_MARKER = "<!-- openmem:start -->";
export const OPENMEM_END_MARKER = "<!-- openmem:end -->";

export const DEFAULT_INSTRUCTIONS = `${OPENMEM_START_MARKER}
## Project memory (openmem)
- Relevant project memory is injected at session start. Treat it as helpful context, not as ground truth; verify against the code.
- When you learn a durable convention, decision, or user preference, call \`memory_remember\` (never include secrets or credentials).
- If a tool result says it was truncated by openmem, call \`read_ref\` with the given id to get specific ranges instead of re-running the command.
- If a remembered fact is wrong or outdated, call \`memory_forget\` or \`memory_remember\` with \`replaces\`.
${OPENMEM_END_MARKER}`;

/**
 * Idempotently injects or updates the openmem instruction block in custom instructions markdown.
 */
export function applyInstructions(
  existingContent: string,
  instructions = DEFAULT_INSTRUCTIONS,
): string {
  const startIndex = existingContent.indexOf(OPENMEM_START_MARKER);
  const endIndex = existingContent.indexOf(OPENMEM_END_MARKER);

  if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
    // Replace existing block
    const before = existingContent.slice(0, startIndex);
    const after = existingContent.slice(endIndex + OPENMEM_END_MARKER.length);
    return (
      `${before.trimEnd()}\n\n${instructions}\n${after.trimStart()}`.trim() +
      "\n"
    );
  }

  // Markers not found - append
  const trimmed = existingContent.trim();
  if (trimmed.length === 0) {
    return instructions + "\n";
  }
  return `${trimmed}\n\n${instructions}\n`;
}

/**
 * Removes the openmem instruction block from custom instructions markdown.
 */
export function removeInstructions(existingContent: string): string {
  const startIndex = existingContent.indexOf(OPENMEM_START_MARKER);
  const endIndex = existingContent.indexOf(OPENMEM_END_MARKER);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return existingContent;
  }

  const before = existingContent.slice(0, startIndex);
  const after = existingContent.slice(endIndex + OPENMEM_END_MARKER.length);
  const result = `${before.trimEnd()}\n\n${after.trimStart()}`.trim();
  return result ? `${result}\n` : "";
}

/**
 * Ensures copilot-instructions.md has the openmem instructions block.
 */
export function writeInstructionsFile(
  filePath: string,
  instructions = DEFAULT_INSTRUCTIONS,
): {
  created: boolean;
  updated: boolean;
  changed: boolean;
} {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let existing = "";
  let exists = false;
  if (fs.existsSync(filePath)) {
    exists = true;
    existing = fs.readFileSync(filePath, "utf8");
  }

  const updatedContent = applyInstructions(existing, instructions);
  const changed = !exists || existing !== updatedContent;

  if (changed) {
    fs.writeFileSync(filePath, updatedContent, "utf8");
  }

  return {
    created: !exists,
    updated: exists && changed,
    changed,
  };
}
