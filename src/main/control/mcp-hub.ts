import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ListToolsResult,
  CallToolResult,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export class McpHub {
  private clients: Map<string, Client> = new Map();
  private toolCache: Map<string, Tool[]> = new Map();

  constructor() {}

  async connectToServer(config: McpServerConfig): Promise<void> {
    console.log(`[McpHub] Connecting to server: ${config.name} (${config.id})`);

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
    });

    const client = new Client(
      {
        name: "z-one-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    try {
      await client.connect(transport);
      this.clients.set(config.id, client);
      console.log(`[McpHub] Connected to ${config.name}`);

      // List tools to verify connection
      const tools = await client.listTools();
      this.toolCache.set(config.id, tools.tools);
      console.log(
        `[McpHub] Available tools from ${config.name}:`,
        tools.tools.map((t) => t.name),
      );
    } catch (error) {
      console.error(`[McpHub] Failed to connect to ${config.name}:`, error);
      throw error;
    }
  }

  async getAllTools(): Promise<ListToolsResult["tools"]> {
    const allTools: ListToolsResult["tools"] = [];
    for (const [id, tools] of this.toolCache) {
      allTools.push(...tools);
    }
    return allTools;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> | undefined,
  ): Promise<CallToolResult> {
    // Ideally we should look up which server has the tool,
    // but for now we might need to know the server ID or search.
    // Let's implement a search.

    for (const [id, client] of this.clients) {
      // Optimization: Cache tool lists instead of fetching every time
      const tools = this.toolCache.get(id) || [];
      if (tools.some((t) => t.name === toolName)) {
        const result = await client.callTool({
          name: toolName,
          arguments: args,
        });
        return result as CallToolResult;
      }
    }

    throw new Error(`Tool ${toolName} not found on any connected server.`);
  }
}
