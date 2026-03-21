
import { NativeTool } from "../../tool-registry";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { getAppSettings } from "../../../db";

// Helper to get workspace root
const getWorkspace = (): string => {
    const settings = getAppSettings();
    return settings?.general?.agentWorkspace || path.join(process.cwd(), "workspace");
};

// Helper to resolve workspace path — always prefer workspace-relative
const resolvePath = (filePath: string): string => {
    const workspace = getWorkspace();

    // 1. Already relative → resolve against workspace
    if (!path.isAbsolute(filePath)) {
        return path.join(workspace, filePath);
    }

    // 2. Absolute path — check if it's already inside the workspace
    const normalized = path.normalize(filePath);
    if (normalized.startsWith(workspace)) {
        return normalized;
    }

    // 3. Absolute path outside workspace — try stripping to make it relative
    //    e.g. "/output/report.md" → "output/report.md" → workspace/output/report.md
    const stripped = filePath.replace(/^\/+/, "");
    const workspaceResolved = path.join(workspace, stripped);

    // If the original absolute path exists on disk (e.g. /etc/hosts), use it
    // Otherwise, treat it as relative to workspace
    if (fsSync.existsSync(filePath)) {
        return filePath;
    }

    return workspaceResolved;
};

export const ReadFileTool: NativeTool = {
    name: "read_file",
    description: `Read content of a file from the workspace directory. 
IMPORTANT: Always use RELATIVE paths (e.g. "report.md", "data/output.json"). 
Do NOT use absolute paths like "/Users/xxx/file.txt". 
Files are resolved relative to the Agent Workspace directory.`,
    inputSchema: {
        type: "object",
        properties: {
            path: { type: "string", description: "Relative file path within the workspace (e.g. 'report.md', 'data/result.json'). Do NOT use absolute paths." }
        },
        required: ["path"]
    },
    execute: async (args: { path: string }) => {
        try {
            const fullPath = resolvePath(args.path);
            const content = await fs.readFile(fullPath, "utf-8");
            return JSON.stringify({ type: "text", text: content });
        } catch (e: any) {
            throw new Error(`Failed to read file "${args.path}" (resolved to: ${resolvePath(args.path)}): ${e.message}`);
        }
    }
};

export const WriteFileTool: NativeTool = {
    name: "write_file",
    description: `Write content to a file in the workspace directory. Creates parent directories automatically.
IMPORTANT: Always use RELATIVE paths (e.g. "report.md", "data/output.json").
Do NOT use absolute paths like "/Users/xxx/file.txt".
Files are saved relative to the Agent Workspace directory.`,
    inputSchema: {
        type: "object",
        properties: {
            path: { type: "string", description: "Relative file path within the workspace (e.g. 'report.md', 'results/data.json'). Do NOT use absolute paths." },
            content: { type: "string", description: "Content to write to the file" }
        },
        required: ["path", "content"]
    },
    execute: async (args: { path: string; content: string }) => {
        try {
            const fullPath = resolvePath(args.path);
            console.log(`[WriteFile] Writing to: ${fullPath} (input path: ${args.path})`);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, args.content, "utf-8");
            console.log(`[WriteFile] Success: ${fullPath}`);
            return `File written successfully to ${fullPath}`;
        } catch (e: any) {
            console.error(`[WriteFile] Failed: ${e.message}`);
            throw new Error(`Failed to write file "${args.path}" (resolved to: ${resolvePath(args.path)}): ${e.message}`);
        }
    }
};

export const ListDirTool: NativeTool = {
    name: "list_dir",
    description: `List files in a directory within the workspace. 
Use relative paths (e.g. "." for workspace root, "data/" for a subdirectory).`,
    inputSchema: {
        type: "object",
        properties: {
            path: { type: "string", description: "Relative directory path within the workspace (e.g. '.', 'data/'). Do NOT use absolute paths." }
        },
        required: ["path"]
    },
    execute: async (args: { path: string }) => {
        try {
            const fullPath = resolvePath(args.path);
            const files = await fs.readdir(fullPath);
            return files;
        } catch (e: any) {
            throw new Error(`Failed to list directory "${args.path}" (resolved to: ${resolvePath(args.path)}): ${e.message}`);
        }
    }
};
