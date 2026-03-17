
import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { McpHub } from "../control/mcp-hub";
import { logger } from "../logger";

export interface ToolContext {
    deviceId?: string;
    sessionId?: string;
}

export interface NativeTool {
    name: string;
    description: string;
    inputSchema: any;
    execute: (args: any, context?: ToolContext) => Promise<any>;
}

export class ToolRegistry {
    private nativeTools: Map<string, NativeTool> = new Map();
    private mcpHub: McpHub;

    constructor(mcpHub: McpHub) {
        this.mcpHub = mcpHub;
    }

    public registerNativeTool(tool: NativeTool) {
        if (this.nativeTools.has(tool.name)) {
            logger.warn(`[ToolRegistry] Duplicate native tool name: "${tool.name}" — overwriting previous registration`);
        }
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

        // Deduplicate: native tools take priority over MCP tools with the same name
        const nativeNames = new Set(nativeToolsList.map(t => t.name));
        const dedupedMcpTools = mcpTools.filter(t => {
            if (nativeNames.has(t.name)) {
                logger.warn(`[ToolRegistry] MCP tool "${t.name}" conflicts with native tool — skipping MCP version`);
                return false;
            }
            return true;
        });

        // Also check for duplicates within MCP tools themselves
        const seen = new Set<string>(nativeNames);
        const finalMcpTools = dedupedMcpTools.filter(t => {
            if (seen.has(t.name)) {
                logger.warn(`[ToolRegistry] Duplicate MCP tool name: "${t.name}" — skipping`);
                return false;
            }
            seen.add(t.name);
            return true;
        });

        return [...nativeToolsList, ...finalMcpTools];
    }

    public async callTool(toolName: string, args: any, context?: ToolContext): Promise<CallToolResult> {
        // 1. Try Native Tools
        const nativeTool = this.nativeTools.get(toolName);
        if (nativeTool) {
            logger.info(`Executing native tool: ${toolName}`);
            try {
                const result = await nativeTool.execute(args, context);
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

