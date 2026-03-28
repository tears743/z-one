
import { NativeTool } from "../../tool-registry";
import * as fs from "fs/promises";
import * as path from "path";
import { getAppSettings } from "../../../db";

// Helper to resolve workspace path
const resolvePath = (filePath: string) => {
    const settings = getAppSettings();
    // Use configured workspace or default to 'workspace' folder in CWD
    const workspace = settings?.general?.agentWorkspace || path.join(process.cwd(), "workspace");
    
    // If path is absolute, check if it's within workspace (optional security check)
    // For now, if workspace is set, we prefer relative paths or enforce workspace root
    // But to support legacy/system absolute paths, we might need a policy.
    // Requirement says: "It is the space for agent file output reading and writing"
    
    if (workspace && !path.isAbsolute(filePath)) {
        return path.join(workspace, filePath);
    }
    
    // If absolute, just return it (or restrict it later)
    return filePath;
};

export const ReadFileTool: NativeTool = {
    name: "read_file",
    description: "Read content of a file. IMPORTANT: Use relative paths (e.g. 'notes/todo.md'). Relative paths are automatically resolved under the configured Agent Workspace directory. Absolute paths are used as-is.",
    inputSchema: {
        type: "object",
        properties: {
            path: { type: "string", description: "Relative path preferred (e.g. 'data/config.json'). The system will automatically prepend the workspace directory to relative paths. Only use absolute paths if you need to access files outside the workspace." }
        },
        required: ["path"]
    },
    execute: async (args: { path: string }) => {
        try {
            const fullPath = resolvePath(args.path);
            const content = await fs.readFile(fullPath, "utf-8");
            return content;
        } catch (e: any) {
            throw new Error(`Failed to read file: ${e.message}`);
        }
    }
};

export const WriteFileTool: NativeTool = {
    name: "write_file",
    description: "Write content to a file. IMPORTANT: Use relative paths (e.g. 'output/report.md'). Relative paths are automatically resolved under the configured Agent Workspace directory. Parent directories are created automatically.",
    inputSchema: {
        type: "object",
        properties: {
            path: { type: "string", description: "Relative path preferred (e.g. 'output/report.md'). The system will automatically prepend the workspace directory to relative paths. Only use absolute paths if you need to write outside the workspace." },
            content: { type: "string", description: "Content to write" }
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
            throw new Error(`Failed to write file: ${e.message}`);
        }
    }
};

export const ListDirTool: NativeTool = {
    name: "list_dir",
    description: "List files in a directory. IMPORTANT: Use relative paths (e.g. '.' for workspace root, 'docs' for docs subfolder). Relative paths are automatically resolved under the configured Agent Workspace directory.",
    inputSchema: {
        type: "object",
        properties: {
            path: { type: "string", description: "Relative path preferred (e.g. '.' for workspace root). The system will automatically prepend the workspace directory to relative paths. Only use absolute paths if you need to list outside the workspace." }
        },
        required: ["path"]
    },
    execute: async (args: { path: string }) => {
        try {
            const fullPath = resolvePath(args.path);
            const files = await fs.readdir(fullPath);
            return files;
        } catch (e: any) {
            throw new Error(`Failed to list directory: ${e.message}`);
        }
    }
};
