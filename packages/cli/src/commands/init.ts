import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, writeConfig } from "@openmem/core";
import { writeInstructionsFile } from "@openmem/instructions";

export interface InitOptions {
  cli?: boolean | undefined;
  cloudAgent?: boolean | undefined;
  global?: boolean | undefined;
  yes?: boolean | undefined;
  bin?: string | undefined;
  vscodeFormat?: boolean | undefined;
  cwd?: string | undefined;
}

export function runInit(options: InitOptions = {}): {
  success: boolean;
  createdFiles: string[];
  updatedFiles: string[];
} {
  const cwd = options.cwd ?? process.cwd();
  const createdFiles: string[] = [];
  const updatedFiles: string[] = [];

  const isCloudAgent = Boolean(options.cloudAgent);
  const isGlobal = Boolean(options.global);
  const isPascal = Boolean(options.vscodeFormat);

  const binCmd = options.bin ?? "npx --no-install openmem";

  // 1. .openmem/config.json
  const dotOpenmemDir = path.join(cwd, ".openmem");
  if (!fs.existsSync(dotOpenmemDir)) {
    fs.mkdirSync(dotOpenmemDir, { recursive: true });
  }

  const configPath = path.join(dotOpenmemDir, "config.json");
  if (!fs.existsSync(configPath)) {
    const config = loadConfig(cwd);
    writeConfig(configPath, config);
    createdFiles.push(configPath);
  }

  // 2. .gitignore entries
  const gitignorePath = path.join(cwd, ".gitignore");
  const gitignoreEntries = [
    "\n# openmem local storage",
    ".openmem/openmem.db*",
    ".openmem/logs/\n",
  ];
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf8");
    if (!content.includes(".openmem/openmem.db")) {
      fs.appendFileSync(gitignorePath, gitignoreEntries.join("\n"), "utf8");
      updatedFiles.push(gitignorePath);
    }
  } else {
    fs.writeFileSync(gitignorePath, gitignoreEntries.join("\n").trim() + "\n", "utf8");
    createdFiles.push(gitignorePath);
  }

  // 3. Hooks configuration
  let hooksDir: string;
  if (isGlobal) {
    const homeDir = process.env.COPILOT_HOME ?? path.join(os.homedir(), ".copilot");
    hooksDir = path.join(homeDir, "hooks");
  } else {
    hooksDir = path.join(cwd, ".github", "hooks");
  }

  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const hooksFile = path.join(hooksDir, "openmem.json");
  const hookCmd = (evt: string) => `${binCmd} hook ${evt}`;

  let hooksConfig: Record<string, unknown>;

  if (isPascal) {
    hooksConfig = {
      version: 1,
      hooks: {
        SessionStart: [
          {
            type: "command",
            bash: hookCmd("session-start"),
            powershell: hookCmd("session-start"),
            timeoutSec: 10,
          },
        ],
        PostToolUse: [
          {
            type: "command",
            matcher: "^(?:bash|view|grep|web_fetch)$",
            bash: hookCmd("post-tool-use"),
            powershell: hookCmd("post-tool-use"),
            timeoutSec: 10,
          },
        ],
        AgentStop: [
          {
            type: "command",
            bash: hookCmd("agent-stop"),
            powershell: hookCmd("agent-stop"),
            timeoutSec: 15,
          },
        ],
        PreCompact: [
          {
            type: "command",
            bash: hookCmd("pre-compact"),
            powershell: hookCmd("pre-compact"),
            timeoutSec: 15,
          },
        ],
        SessionEnd: [
          {
            type: "command",
            bash: hookCmd("session-end"),
            powershell: hookCmd("session-end"),
            timeoutSec: 30,
          },
        ],
      },
    };
  } else {
    hooksConfig = {
      version: 1,
      hooks: {
        sessionStart: [
          {
            type: "command",
            bash: hookCmd("session-start"),
            powershell: hookCmd("session-start"),
            timeoutSec: 10,
          },
        ],
        postToolUse: [
          {
            type: "command",
            matcher: "^(?:bash|view|grep|web_fetch)$",
            bash: hookCmd("post-tool-use"),
            powershell: hookCmd("post-tool-use"),
            timeoutSec: 10,
          },
        ],
        agentStop: [
          {
            type: "command",
            bash: hookCmd("agent-stop"),
            powershell: hookCmd("agent-stop"),
            timeoutSec: 15,
          },
        ],
        preCompact: [
          {
            type: "command",
            bash: hookCmd("pre-compact"),
            powershell: hookCmd("pre-compact"),
            timeoutSec: 15,
          },
        ],
        sessionEnd: [
          {
            type: "command",
            bash: hookCmd("session-end"),
            powershell: hookCmd("session-end"),
            timeoutSec: 30,
          },
        ],
      },
    };
  }

  const hooksFileExists = fs.existsSync(hooksFile);
  fs.writeFileSync(hooksFile, JSON.stringify(hooksConfig, null, 2) + "\n", "utf8");
  if (hooksFileExists) {
    updatedFiles.push(hooksFile);
  } else {
    createdFiles.push(hooksFile);
  }

  // 4. MCP registration
  const mcpServerDef = {
    command: "openmem",
    args: ["mcp"],
    type: "stdio",
  };

  if (isGlobal) {
    const copilotDir = process.env.COPILOT_HOME ?? path.join(os.homedir(), ".copilot");
    if (!fs.existsSync(copilotDir)) {
      fs.mkdirSync(copilotDir, { recursive: true });
    }
    const globalMcpPath = path.join(copilotDir, "mcp-config.json");
    let globalMcpConfig: { mcpServers: Record<string, unknown> } = { mcpServers: {} };
    if (fs.existsSync(globalMcpPath)) {
      try {
        globalMcpConfig = JSON.parse(fs.readFileSync(globalMcpPath, "utf8"));
        if (!globalMcpConfig.mcpServers) globalMcpConfig.mcpServers = {};
      } catch {
        globalMcpConfig = { mcpServers: {} };
      }
    }
    globalMcpConfig.mcpServers["openmem"] = mcpServerDef;
    fs.writeFileSync(globalMcpPath, JSON.stringify(globalMcpConfig, null, 2) + "\n", "utf8");
    if (fs.existsSync(globalMcpPath)) updatedFiles.push(globalMcpPath);
    else createdFiles.push(globalMcpPath);
  } else {
    // Project-level .mcp.json
    const projectMcpPath = path.join(cwd, ".mcp.json");
    let mcpConfig: { mcpServers: Record<string, unknown> } = { mcpServers: {} };
    const mcpExists = fs.existsSync(projectMcpPath);
    if (mcpExists) {
      try {
        mcpConfig = JSON.parse(fs.readFileSync(projectMcpPath, "utf8"));
        if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
      } catch {
        mcpConfig = { mcpServers: {} };
      }
    }
    mcpConfig.mcpServers["openmem"] = mcpServerDef;
    fs.writeFileSync(projectMcpPath, JSON.stringify(mcpConfig, null, 2) + "\n", "utf8");
    if (mcpExists) updatedFiles.push(projectMcpPath);
    else createdFiles.push(projectMcpPath);
  }

  // 5. Copilot custom instructions
  const instructionsPath = path.join(cwd, ".github", "copilot-instructions.md");
  const instResult = writeInstructionsFile(instructionsPath);
  if (instResult.created) createdFiles.push(instructionsPath);
  else if (instResult.updated) updatedFiles.push(instructionsPath);

  // 6. Cloud agent specific memories file if requested
  if (isCloudAgent) {
    const cloudMemDir = path.join(cwd, ".github", "openmem");
    if (!fs.existsSync(cloudMemDir)) {
      fs.mkdirSync(cloudMemDir, { recursive: true });
    }
    const cloudMemFile = path.join(cloudMemDir, "memories.md");
    if (!fs.existsSync(cloudMemFile)) {
      fs.writeFileSync(
        cloudMemFile,
        `# Project Memories (openmem for Cloud Agent)\n\n## Semantic\n\n## Procedural\n`,
        "utf8",
      );
      createdFiles.push(cloudMemFile);
    }
  }

  return {
    success: true,
    createdFiles,
    updatedFiles,
  };
}
