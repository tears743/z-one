
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { existsSync } from "fs";

const server = new Server(
  {
    name: "filesystem-server",
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
        name: "read_file",
        description: "Read content from a file",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Absolute path to the file",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "write_file",
        description: "Write content to a file (overwrites existing)",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Absolute path to the file",
            },
            content: {
              type: "string",
              description: "Content to write",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "file_exists",
        description: "Check if a file exists",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Absolute path to the file",
            },
          },
          required: ["path"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "read_file") {
      const path = args?.path as string;
      const content = await readFile(path, "utf-8");
      return {
        content: [{ type: "text", text: content }],
      };
    }

    if (name === "write_file") {
      const path = args?.path as string;
      const content = args?.content as string;
      
      // Ensure directory exists
      await mkdir(dirname(path), { recursive: true });
      
      await writeFile(path, content, "utf-8");
      return {
        content: [{ type: "text", text: `Successfully wrote to ${path}` }],
      };
    }
    
    if (name === "file_exists") {
        const path = args?.path as string;
        const exists = existsSync(path);
        return {
            content: [{ type: "text", text: exists.toString() }]
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
