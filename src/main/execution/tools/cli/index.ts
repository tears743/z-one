import { NativeTool } from "../../tool-registry";
import { exec } from "child_process";
import { logger } from "../../../logger";
import { dialog, BrowserWindow } from "electron";

const MAX_OUTPUT_LENGTH = 10000; // Truncate output to avoid token explosion
const DEFAULT_TIMEOUT = 30000; // 30 seconds

// --- Permission Management ---

/**
 * Set of command prefixes that the user has "always approved".
 * Persisted in memory for the current session.
 * Example: "ls", "cat", "git status" etc.
 */
const alwaysApprovedCommands: Set<string> = new Set();

/**
 * Extract the base command (first word) from a full command string.
 * e.g. "ls -la /tmp" -> "ls", "git status" -> "git"
 */
function getBaseCommand(command: string): string {
  const trimmed = command.trim();
  // Handle commands starting with env vars or sudo
  const cleaned = trimmed
    .replace(/^(sudo\s+)/, "")
    .replace(/^([A-Z_]+=\S+\s+)*/, "");
  return cleaned.split(/\s+/)[0] || trimmed;
}

/**
 * Check if the system allows executing CLI commands.
 * On macOS, we test by running a simple command.
 */
async function checkSystemPermission(): Promise<{
  allowed: boolean;
  error?: string;
}> {
  return new Promise((resolve) => {
    exec("echo ok", { timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve({
          allowed: false,
          error: `System CLI execution failed: ${error.message}. The app may need Terminal/Shell access permissions.`,
        });
      } else if (stdout.trim() === "ok") {
        resolve({ allowed: true });
      } else {
        resolve({
          allowed: false,
          error: "Unexpected output from permission check.",
        });
      }
    });
  });
}

/**
 * Show a dialog to the user asking for permission to run a command.
 * Returns: 'allow' | 'always' | 'deny'
 */
async function requestUserPermission(
  command: string,
): Promise<"allow" | "always" | "deny"> {
  const win = BrowserWindow.getFocusedWindow();

  const result = await dialog.showMessageBox(win || ({} as any), {
    type: "question",
    title: "CLI Command Permission",
    message: `Agent wants to execute a command:`,
    detail: `${command}\n\nDo you want to allow this command to run?`,
    buttons: ["Deny", "Allow Once", "Always Allow"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  });

  switch (result.response) {
    case 2:
      return "always";
    case 1:
      return "allow";
    default:
      return "deny";
  }
}

export const RunCommandTool: NativeTool = {
  name: "run_command",
  description:
    "Execute a shell command on the local system and return the output. " +
    "Use this tool to run CLI commands like ls, cat, grep, curl, git, python, node, etc. " +
    "Commands run in a shell (bash/zsh on macOS/Linux, cmd on Windows). " +
    "Output is truncated to avoid excessive length. " +
    "The user will be prompted for permission before the command runs. " +
    "IMPORTANT: Use with caution - avoid destructive commands (rm -rf, format, etc.) unless explicitly instructed.",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute",
      },
      cwd: {
        type: "string",
        description:
          "Working directory for the command (optional, defaults to agent workspace)",
      },
      timeout: {
        type: "number",
        description:
          "Timeout in milliseconds (optional, defaults to 30000ms / 30s)",
      },
    },
    required: ["command"],
  },
  execute: async (args: {
    command: string;
    cwd?: string;
    timeout?: number;
  }) => {
    const { command, cwd, timeout = DEFAULT_TIMEOUT } = args;

    // 1. Check system permission
    const sysCheck = await checkSystemPermission();
    if (!sysCheck.allowed) {
      logger.error(`[CLI Tool] System permission check failed: ${sysCheck.error}`);
      return `[PERMISSION ERROR]: ${sysCheck.error}`;
    }

    // 2. Check user permission
    const baseCmd = getBaseCommand(command);

    if (!alwaysApprovedCommands.has(baseCmd)) {
      logger.info(
        `[CLI Tool] Requesting user permission for command: ${command}`,
      );

      const permission = await requestUserPermission(command);

      if (permission === "deny") {
        logger.info(`[CLI Tool] User denied command: ${command}`);
        return `[DENIED]: User denied permission to execute: ${command}`;
      }

      if (permission === "always") {
        alwaysApprovedCommands.add(baseCmd);
        logger.info(
          `[CLI Tool] User always-approved base command: ${baseCmd}`,
        );
      }

      logger.info(`[CLI Tool] User approved command: ${command}`);
    } else {
      logger.info(
        `[CLI Tool] Command auto-approved (always-allowed: ${baseCmd}): ${command}`,
      );
    }

    // 3. Execute the command
    logger.info(`[CLI Tool] Executing command: ${command}`);
    if (cwd) {
      logger.info(`[CLI Tool] Working directory: ${cwd}`);
    }

    return new Promise((resolve) => {
      exec(
        command,
        {
          cwd: cwd || undefined,
          timeout,
          maxBuffer: 1024 * 1024 * 5, // 5MB max buffer
          shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
        },
        (error, stdout, stderr) => {
          let output = "";

          if (stdout) {
            output += stdout;
          }
          if (stderr) {
            output += (output ? "\n" : "") + `[STDERR]: ${stderr}`;
          }
          if (error) {
            if (error.killed) {
              output +=
                (output ? "\n" : "") +
                `[TIMEOUT]: Command was killed after ${timeout}ms`;
            } else if (!stdout && !stderr) {
              output = `[ERROR]: ${error.message}`;
            }
            logger.warn(
              `[CLI Tool] Command exited with error: ${error.message}`,
            );
          }

          // Truncate if too long
          if (output.length > MAX_OUTPUT_LENGTH) {
            output =
              output.substring(0, MAX_OUTPUT_LENGTH) +
              `\n\n... [OUTPUT TRUNCATED - ${output.length} total characters, showing first ${MAX_OUTPUT_LENGTH}]`;
          }

          logger.info(
            `[CLI Tool] Command completed. Output length: ${output.length}`,
          );
          resolve(output || "(no output)");
        },
      );
    });
  },
};
