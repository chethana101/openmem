#!/usr/bin/env node

/**
 * openmem CLI binary entry point.
 */

import { runDoctor } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import {
  runAdd,
  runExplain,
  runExport,
  runForget,
  runImport,
  runList,
  runRecall,
  runStats,
} from "./commands/memory.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "--help";

  switch (command) {
    case "init": {
      const cli = args.includes("--cli");
      const cloudAgent = args.includes("--cloud-agent");
      const global = args.includes("--global");
      const yes = args.includes("--yes") || args.includes("-y");
      const vscodeFormat = args.includes("--vscode-format");
      const binIdx = args.indexOf("--bin");
      const bin = binIdx !== -1 && args[binIdx + 1] ? args[binIdx + 1] : undefined;

      const result = runInit({ cli, cloudAgent, global, yes, bin, vscodeFormat });
      console.log("openmem initialized successfully!");
      if (result.createdFiles.length > 0) {
        console.log("\nCreated files:");
        for (const f of result.createdFiles) console.log(`  + ${f}`);
      }
      if (result.updatedFiles.length > 0) {
        console.log("\nUpdated files:");
        for (const f of result.updatedFiles) console.log(`  ~ ${f}`);
      }
      console.log("\nNext steps:");
      console.log("  1. Run 'openmem doctor' to verify setup");
      console.log("  2. Add memories with 'openmem add \"<fact>\"'");
      break;
    }

    case "doctor": {
      console.log("Diagnosing openmem environment...\n");
      const { allOk, checks } = runDoctor();
      for (const check of checks) {
        const badge =
          check.status === "OK" ? "[OK]" : check.status === "WARN" ? "[WARN]" : "[FAIL]";
        console.log(`${badge} ${check.name}: ${check.message}`);
        if (check.details) {
          console.log(`     ${check.details}`);
        }
      }
      console.log(
        "\nSummary: " +
          (allOk
            ? "All checks passed! System ready."
            : "One or more checks failed. Review warnings above."),
      );
      if (!allOk) process.exit(1);
      break;
    }

    case "hook": {
      // Delegate to openmem-hooks
      // Must read from stdin, process, output to stdout, exit 0
      const eventName = args[1];
      if (!eventName) {
        process.stdout.write("{}\n");
        process.exit(0);
      }
      // Dynamically load hooks runner
      try {
        const hooksMod = await import("openmem-hooks");
        if (typeof (hooksMod as unknown as { run: () => Promise<void> }).run === "function") {
          await (hooksMod as unknown as { run: () => Promise<void> }).run();
        } else {
          process.stdout.write("{}\n");
        }
      } catch {
        process.stdout.write("{}\n");
      }
      break;
    }

    case "mcp": {
      // Start MCP server over stdio
      const { startMcpServer } = await import("openmem-mcp");
      await startMcpServer();
      break;
    }

    case "add": {
      const text = args[1];
      if (!text || text.startsWith("-")) {
        console.error(
          'Usage: openmem add "<memory text>" [--kind semantic|episodic|procedural] [--importance 0.8] [--pin]',
        );
        process.exit(1);
      }
      let kind: "semantic" | "episodic" | "procedural" | undefined;
      const kindIdx = args.indexOf("--kind");
      if (kindIdx !== -1 && args[kindIdx + 1]) {
        kind = args[kindIdx + 1] as "semantic" | "episodic" | "procedural";
      }
      let importance: number | undefined;
      const impIdx = args.indexOf("--importance");
      if (impIdx !== -1 && args[impIdx + 1]) {
        importance = Number.parseFloat(args[impIdx + 1]!);
      }
      const pin = args.includes("--pin");
      const replacesIdx = args.indexOf("--replaces");
      const replaces = replacesIdx !== -1 ? args[replacesIdx + 1] : undefined;

      const res = runAdd(text, { kind, importance, pin, replaces });
      console.log(`Memory remembered [id: ${res.id}]`);
      break;
    }

    case "recall": {
      const query = args[1];
      if (!query || query.startsWith("-")) {
        console.error('Usage: openmem recall "<query>" [-k 5]');
        process.exit(1);
      }
      let k: number | undefined;
      const kIdx = args.indexOf("-k");
      if (kIdx !== -1 && args[kIdx + 1]) {
        k = Number.parseInt(args[kIdx + 1]!, 10);
      }
      const res = runRecall(query, { k });
      if (res.count === 0) {
        console.log("No relevant memories found.");
      } else {
        console.log(res.text);
      }
      break;
    }

    case "list": {
      const history = args.includes("--history");
      let kind: "semantic" | "episodic" | "procedural" | undefined;
      const kindIdx = args.indexOf("--kind");
      if (kindIdx !== -1 && args[kindIdx + 1]) {
        kind = args[kindIdx + 1] as "semantic" | "episodic" | "procedural";
      }
      const memories = runList({ history, kind });
      if (memories.length === 0) {
        console.log("No memories stored.");
      } else {
        console.log(`Stored memories (${memories.length}):\n`);
        for (const m of memories) {
          const status = m.validTo !== null ? " [SUPERSEDED]" : m.pinned ? " [PINNED]" : "";
          console.log(`- [${m.id}] (${m.kind}, imp ${m.importance.toFixed(1)})${status} ${m.text}`);
        }
      }
      break;
    }

    case "forget": {
      const all = args.includes("--all");
      const id = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
      if (!all && !id) {
        console.error("Usage: openmem forget <id> | openmem forget --all");
        process.exit(1);
      }
      const res = runForget({ id, all });
      console.log(`Forgotten ${res.forgotten} memory/memories.`);
      break;
    }

    case "export": {
      const outIdx = args.indexOf("--out");
      const out = outIdx !== -1 ? args[outIdx + 1] : undefined;
      const res = runExport({ out });
      console.log(`Exported ${res.count} memories to ${res.filePath}`);
      break;
    }

    case "import": {
      const file = args[1];
      if (!file) {
        console.error("Usage: openmem import <file.md>");
        process.exit(1);
      }
      const res = runImport(file);
      console.log(
        `Imported ${res.added} new, updated ${res.updated}, forgotten ${res.forgotten} memories.`,
      );
      break;
    }

    case "explain": {
      const sIdx = args.indexOf("--session");
      const sessionId = sIdx !== -1 ? args[sIdx + 1] : undefined;
      const records = runExplain({ sessionId });
      if (records.length === 0) {
        console.log("No compressed outputs found.");
      } else {
        console.log(`Compressed tool outputs (${records.length}):\n`);
        for (const r of records) {
          const date = new Date(r.createdAt).toISOString();
          console.log(`- [${r.id}] ${r.toolName ?? "tool"} (${r.bytes} bytes, ${date})`);
          console.log(`  Snippet: ${r.snippet.replace(/\n/g, " ")}...\n`);
        }
      }
      break;
    }

    case "stats": {
      const s = runStats();
      console.log("openmem Statistics:\n");
      console.log(`  Namespace:       ${s.namespace}`);
      console.log(`  Active memories: ${s.activeMemories}`);
      console.log(`  Compressed refs: ${s.totalRefs}`);
      console.log(`  Bytes stored:    ${s.totalSavedBytes}`);
      break;
    }

    case "--help":
    case "-h":
    default: {
      console.log(`
openmem - Copilot-first memory and context layer for AI coding agents

Commands:
  init [--cli] [--cloud-agent] [--global] [--yes] [--bin PATH]
                       Initialize openmem in current repository
  doctor               Verify installation, node:sqlite, hooks, and latency
  add <text>           Add a memory manually
  recall <query>       Search memories matching a query
  list [--history]     List active or historical memories
  forget <id>|--all    Forget a memory by ID or clear all
  export [--out <f>]   Export memories to Markdown
  import <file>        Import memories from Markdown
  explain [--session]  Inspect compressed tool output history
  stats                Show memory and compression metrics
  hook <event>         Internal: invoke Copilot hook handler
  mcp                  Start stdio Model Context Protocol server
`);
      break;
    }
  }
}

main().catch((err) => {
  console.error("openmem error:", err);
  process.exit(1);
});
