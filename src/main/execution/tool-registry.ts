
import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { McpHub } from "../control/mcp-hub";
import { logger } from "../logger";

export interface NativeTool {
    name: string;
    description: string;
    inputSchema: any;
    execute: (args: any) => Promise<any>;
}

export class ToolRegistry {
    private nativeTools: Map<string, NativeTool> = new Map();
    private mcpHub: McpHub;

    constructor(mcpHub: McpHub) {
        this.mcpHub = mcpHub;
    }

    public registerNativeTool(tool: NativeTool) {
        this.nativeTools.set(tool.name, tool);
        logger.info(`Registered native tool: ${tool.name}`);
    }

    public async getAllTools(): Promise<Tool[]> {
        const mcpTools = await this.mcpHub.getAllTools();
        const nativeToolsList: Tool[] = Array.from(this.nativeTools.values()).map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema
        }));

        return [...nativeToolsList, ...mcpTools];
    }

    public async callTool(toolName: string, args: any): Promise<CallToolResult> {
        // 1. Try Native Tools
        const nativeTool = this.nativeTools.get(toolName);
        if (nativeTool) {
            logger.info(`Executing native tool: ${toolName}`);
            try {
                const result = await nativeTool.execute(args);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
                };
            } catch (e: any) {
                logger.error(`Native tool ${toolName} failed`, e);
                return {
                    content: [{ type: "text", text: `Error: ${e.message}` }],
                    isError: true
                };
            }
        }

        // 2. Try MCP Tools
        return this.mcpHub.callTool("unknown", toolName, args);
    }
}
