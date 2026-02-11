
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const server = new Server(
  {
    name: "script-runner-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "run_node_script",
        description: "Execute a Node.js/TypeScript script. Supports 'ts-node' if installed, otherwise runs as JS.",
        inputSchema: {
          type: "object",
          properties: {
            script: {
              type: "string",
              description: "The script content to execute",
            },
            args: {
              type: "array",
              items: { type: "string" },
              description: "Optional arguments to pass to the script",
            },
          },
          required: ["script"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "run_node_script") {
      const scriptContent = args?.script as string;
      const scriptArgs = (args?.args as string[]) || [];
      
      const tempDir = join(tmpdir(), "z-one-scripts");
      await mkdir(tempDir, { recursive: true });
      
      const isTs = scriptContent.includes("import ") || scriptContent.includes(": ");
      const ext = isTs ? "ts" : "js";
      const tempFile = join(tempDir, `${randomUUID()}.${ext}`);
      
      await writeFile(tempFile, scriptContent, "utf-8");

      let command = "";
      // Simple heuristic: use ts-node for TS, node for JS
      // In a packaged app, we might need a bundled runtime or rely on system PATH
      // For robustness, we'll try to use `npx ts-node` for TS if available, or just `node` if JS.
      // Note: This depends on the environment having node/npm/npx available.
      
      if (isTs) {
          // Use ts-node via npx to avoid global install requirement, 
          // but this might be slow. 
          // Alternatively, we can assume `ts-node` is in the path or use `node --loader ts-node/esm`
          // For now, let's assume the user has a node environment.
          command = `npx ts-node "${tempFile}" ${scriptArgs.join(" ")}`;
      } else {
          command = `node "${tempFile}" ${scriptArgs.join(" ")}`;
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
            timeout: 30000, // 30s timeout
            env: { ...process.env } // Inherit env
        });

        // Cleanup
        await unlink(tempFile).catch(() => {});

        return {
            content: [
                { type: "text", text: `STDOUT:\n${stdout}` },
                { type: "text", text: `STDERR:\n${stderr}` }
            ]
        };
      } catch (execError: any) {
         // Cleanup
         await unlink(tempFile).catch(() => {});
         
         return {
            content: [{ type: "text", text: `Execution Failed: ${execError.message}\n${execError.stderr}` }],
            isError: true
         }
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
server.connect(transport);
