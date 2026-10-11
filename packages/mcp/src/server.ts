#!/usr/bin/env node

/**
 * openmem MCP server - stdio transport.
 *
 * Exposes 5 tools:
 *   memory_remember  - save a durable fact/preference/convention
 *   memory_recall    - search project memory
 *   memory_forget    - mark memories forgotten/superseded
 *   memory_list      - list current memories for review
 *   read_ref         - retrieve full content of a truncated tool output
 *
 * Descriptions are kept short and unambiguous so the model picks the
 * right tool without confusion.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ContextCompressor,
  MemoryManager,
  OpenmemStore,
  loadConfig,
} from "@openmem/core";

export const TOOLS = [
  {
    name: "memory_remember",
    description:
      "Save a durable fact, preference, convention, or decision for this project. Do not save secrets or credentials.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description: "The fact or convention to remember.",
        },
        kind: {
          type: "string",
          enum: ["semantic", "episodic", "procedural"],
          description:
            "semantic=facts/conventions, procedural=how-to steps, episodic=what happened.",
        },
        importance: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            "Importance score 0-1 (default 0.5). Use 0.8+ for critical conventions.",
        },
        replaces: {
          type: "string",
          description: "ID of an existing memory this supersedes (optional).",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "memory_recall",
    description:
      "Search project memory for relevant facts, conventions, or decisions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query." },
        k: { type: "number", description: "Max results (default 8)." },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_forget",
    description:
      "Mark a memory as forgotten or superseded. Use when a stored fact is wrong or outdated.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "ID of the memory to forget (from memory_list).",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_list",
    description:
      "List current project memories so the user can review and manage them.",
    inputSchema: {
      type: "object" as const,
      properties: {
        kind: {
          type: "string",
          enum: ["semantic", "episodic", "procedural"],
          description: "Filter by kind (optional).",
        },
        limit: { type: "number", description: "Max results (default 50)." },
      },
    },
  },
  {
    name: "read_ref",
    description:
      "Retrieve the full content of a tool output that was truncated by openmem. Use the ref ID from the truncation notice.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Ref ID from the truncation notice (e.g. r_8f3k2).",
        },
        start: {
          type: "number",
          description: "Start line (1-indexed, optional).",
        },
        end: { type: "number", description: "End line (inclusive, optional)." },
      },
      required: ["id"],
    },
  },
];

export async function startMcpServer(): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  const server = new Server(
    { name: "openmem", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleMcpToolCall(
      name,
      args as Record<string, unknown> | undefined,
      config,
    );
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export async function handleMcpToolCall(
  name: string,
  args: Record<string, unknown> | undefined,
  config: ReturnType<typeof loadConfig>,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  const store = new OpenmemStore(config.dbPath);

  try {
    switch (name) {
      case "memory_remember": {
        const manager = new MemoryManager(store, config);
        const id = manager.add({
          text: String(args?.["text"] ?? ""),
          kind:
            (args?.["kind"] as "semantic" | "episodic" | "procedural") ??
            "semantic",
          importance:
            typeof args?.["importance"] === "number" ? args["importance"] : 0.5,
          replaces: args?.["replaces"] ? String(args["replaces"]) : undefined,
          sourceRef: "mcp",
        });
        return {
          content: [{ type: "text", text: `Memory saved with id: ${id}` }],
        };
      }

      case "memory_recall": {
        const manager = new MemoryManager(store, config);
        const result = manager.recall({
          query: String(args?.["query"] ?? ""),
          k: typeof args?.["k"] === "number" ? args["k"] : 8,
          namespace: config.namespace,
        });
        const text =
          result.memories.length === 0
            ? "No relevant memories found."
            : result.formattedBlock;
        return { content: [{ type: "text", text }] };
      }

      case "memory_forget": {
        const manager = new MemoryManager(store, config);
        const ok = manager.forget(String(args?.["id"] ?? ""), config.namespace);
        return {
          content: [
            {
              type: "text",
              text: ok
                ? "Memory forgotten."
                : "Memory not found or already forgotten.",
            },
          ],
        };
      }

      case "memory_list": {
        const manager = new MemoryManager(store, config);
        const memories = manager.list({
          namespace: config.namespace,
          kind: args?.["kind"] as
            | "semantic"
            | "episodic"
            | "procedural"
            | undefined,
          limit: typeof args?.["limit"] === "number" ? args["limit"] : 50,
        });
        if (memories.length === 0) {
          return {
            content: [{ type: "text", text: "No memories stored yet." }],
          };
        }
        const lines = memories.map(
          (m) =>
            `[id:${m.id}] (${m.kind}, imp ${m.importance.toFixed(1)}${m.pinned ? ", pinned" : ""}) ${m.text}`,
        );
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "read_ref": {
        const compressor = new ContextCompressor(store, config);
        const content = compressor.readRef(
          String(args?.["id"] ?? ""),
          typeof args?.["start"] === "number" ? args["start"] : undefined,
          typeof args?.["end"] === "number" ? args["end"] : undefined,
        );
        if (content === null) {
          return {
            content: [
              {
                type: "text",
                text: "Ref not found. It may have expired. Re-run the original command to get fresh output.",
              },
            ],
          };
        }
        return { content: [{ type: "text", text: content }] };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${String(err)}` }],
      isError: true,
    };
  } finally {
    store.close();
  }
}
