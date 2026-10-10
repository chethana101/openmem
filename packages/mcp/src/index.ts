import { TOOLS, handleMcpToolCall, startMcpServer } from "./server.js";

export { startMcpServer, TOOLS, handleMcpToolCall };

// If run directly as a script:
if (
  process.argv[1]?.endsWith("mcp/dist/index.js") ||
  process.argv[1]?.endsWith("mcp/src/index.ts") ||
  process.argv[2] === "mcp"
) {
  startMcpServer().catch((err) => {
    process.stderr.write(`openmem MCP server error: ${String(err)}\n`);
    process.exit(1);
  });
}
