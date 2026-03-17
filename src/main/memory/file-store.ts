import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { AgentMessage } from "../agent/types";
import { logger } from "../logger";
import { getAppSettings } from "../db";
import { LLMService } from "../model/llm-service";
import { estimateMessageTokens } from "../model/token-counter";

export class FileSessionStore {
  private llmService: LLMService;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
  }

  private getBaseDir(): string {
    const settings = getAppSettings();
    logger.info(
      `[FileSessionStore] Loaded settings. agentWorkspace: ${settings?.general?.agentWorkspace}`,
    );

    const workspaceRoot =
      settings?.general?.agentWorkspace ||
      path.join(process.cwd(), "workspace");

    const fullPath = path.join(workspaceRoot, "memory");
    logger.info(`[FileSessionStore] Resolved memory path: ${fullPath}`);
    return fullPath;
  }

  private async ensureDir() {
    const dir = this.getBaseDir();
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (e) {
      logger.error(`Failed to create session directory: ${dir}`, e);
    }
  }

  private async findSessionFile(sessionId: string): Promise<string | null> {
    await this.ensureDir();
    const dir = this.getBaseDir();
    try {
      const files = await fs.readdir(dir);

      // Find all files matching this sessionId
      const matchingFiles = files.filter((f) => f.includes(`_${sessionId}.md`));

      if (matchingFiles.length === 0) return null;

      if (matchingFiles.length === 1) {
        return path.join(dir, matchingFiles[0]);
      }

      // Multiple files (e.g. original + compressed versions)
      // Prefer the latest one by modification time
      let latestFile = matchingFiles[0];
      let latestMtime = 0;
      for (const f of matchingFiles) {
        try {
          const stat = await fs.stat(path.join(dir, f));
          if (stat.mtimeMs > latestMtime) {
            latestMtime = stat.mtimeMs;
            latestFile = f;
          }
        } catch {
          // skip files that can't be stat'd
        }
      }

      return path.join(dir, latestFile);
    } catch (e) {
      logger.error(`Failed to list session files in ${dir}`, e);
      return null;
    }
  }

  /**
   * Get the current session file path (public accessor)
   */
  public async getSessionFilePath(sessionId: string): Promise<string | null> {
    return this.findSessionFile(sessionId);
  }

  public async loadSession(sessionId: string): Promise<AgentMessage[]> {
    const filePath = await this.findSessionFile(sessionId);
    if (!filePath) {
      return [];
    }

    try {
      const content = await fs.readFile(filePath, "utf-8");
      return this.parseMarkdown(content);
    } catch (e) {
      logger.error(`Failed to read session file ${filePath}`, e);
      return [];
    }
  }

  public async appendMessage(sessionId: string, message: AgentMessage) {
    let filePath = await this.findSessionFile(sessionId);

    logger.info(
      `[FileSessionStore] Appending message to session ${sessionId}. File path: ${filePath || "New File"}`,
    );

    // If file doesn't exist, create it with a summary
    if (!filePath) {
      const summary = await this.generateSummary(message.content);
      // Sanitize summary for filename
      const safeSummary = summary
        .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")
        .substring(0, 50);

      // Ensure sessionId is safe
      const safeSessionId = sessionId.replace(/[^a-zA-Z0-9-]/g, "_");

      // Use the original sessionId for the filename if it is a valid UUID, otherwise use safe one
      // But consistency is key.
      // If we use simple string matching in findSessionFile, we should use the exact sessionId here.
      // But we sanitize to be safe for filesystem.
      // UUIDs are safe for filenames.

      const fileName = `${safeSummary}_${sessionId}.md`;
      filePath = path.join(this.getBaseDir(), fileName);

      // Initialize file
      await this.ensureDir();
      logger.info(`[FileSessionStore] Creating new session file: ${filePath}`);
      await fs.writeFile(
        filePath,
        `# Chat Session: ${summary}\n\nSession ID: ${sessionId}\n\n---\n`,
      );
    }

    // Format message
    const date = new Date().toISOString();
    const role = message.role.toUpperCase();
    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);

    const entry = `\n### ${role} [${date}]\n\n${content}\n\n---\n`;

    try {
      await fs.appendFile(filePath, entry, "utf-8");
      logger.info(
        `[FileSessionStore] Successfully wrote message to ${filePath}`,
      );
    } catch (e) {
      logger.error(`Failed to append to session file ${filePath}`, e);
    }
  }

  /**
   * Compress session history: creates a new file with compressed content,
   * archives the original, and marks the provenance.
   */
  public async compressSession(
    sessionId: string,
    compressedMessages: AgentMessage[],
    modelConfig: any,
  ): Promise<string | null> {
    const originalFilePath = await this.findSessionFile(sessionId);
    const originalFileName = originalFilePath
      ? path.basename(originalFilePath)
      : "unknown";

    // Generate compressed file name
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const newFileName = `compressed_${timestamp}_${sessionId}.md`;
    const newFilePath = path.join(this.getBaseDir(), newFileName);

    // Build compressed file header with provenance
    let header = `# Compressed Chat Session\n\n`;
    header += `Session ID: ${sessionId}\n`;
    header += `Compressed at: ${new Date().toISOString()}\n`;
    header += `Compressed from: ${originalFileName}\n`;
    header += `\n---\n`;

    // Write compressed messages
    let body = "";
    for (const msg of compressedMessages) {
      const date = new Date().toISOString();
      const role = msg.role.toUpperCase();
      const content =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);
      body += `\n### ${role} [${date}]\n\n${content}\n\n---\n`;
    }

    try {
      await this.ensureDir();
      await fs.writeFile(newFilePath, header + body, "utf-8");
      logger.info(
        `[FileSessionStore] Created compressed session file: ${newFilePath}`,
      );

      // Archive original file (rename with .archived suffix)
      if (originalFilePath) {
        try {
          const archivedPath = originalFilePath + ".archived";
          await fs.rename(originalFilePath, archivedPath);
          logger.info(
            `[FileSessionStore] Archived original file: ${archivedPath}`,
          );
        } catch (e) {
          logger.warn(
            `[FileSessionStore] Failed to archive original file: ${originalFilePath}`,
            e,
          );
        }
      }

      return newFilePath;
    } catch (e) {
      logger.error(
        `[FileSessionStore] Failed to create compressed session file`,
        e,
      );
      return null;
    }
  }

  /**
   * Check if a session's history exceeds the token threshold and compress if needed.
   * Returns the (potentially compressed) messages.
   */
  public async checkAndCompressIfNeeded(
    sessionId: string,
    messages: AgentMessage[],
    maxInputTokens: number,
    modelConfig: any,
    threshold: number = 0.85,
    onNotify?: (message: string) => void,
  ): Promise<AgentMessage[]> {
    if (!maxInputTokens || messages.length <= 2) return messages;

    let currentTokens = 0;
    for (const msg of messages) {
      currentTokens += estimateMessageTokens(msg);
    }

    const tokenLimit = Math.floor(maxInputTokens * threshold);
    if (currentTokens <= tokenLimit) {
      return messages;
    }

    logger.info(
      `[FileSessionStore] Session ${sessionId}: tokens (${currentTokens}) exceed ${Math.round(threshold * 100)}% of limit (${maxInputTokens}). Compressing file history...`,
    );

    // Notify the device about compression
    if (onNotify) {
      onNotify(
        `\n⚙️ *History compression triggered (${currentTokens}/${maxInputTokens} tokens, ${Math.round((currentTokens / maxInputTokens) * 100)}% used). Compressing...*\n`,
      );
    }

    // Strategy: Keep first message context, summarize middle, keep last 4 messages
    const lastMessagesCount = Math.min(4, Math.floor(messages.length / 2));
    const recentMessages = messages.slice(-lastMessagesCount);
    const messagesToSummarize = messages.slice(0, -lastMessagesCount);

    if (messagesToSummarize.length === 0) return messages;

    // Build text to summarize
    const textToSummarize = messagesToSummarize
      .map((m) => {
        const content =
          typeof m.content === "string"
            ? m.content
            : JSON.stringify(m.content);
        return `${m.role.toUpperCase()}: ${content}`;
      })
      .join("\n\n");

    try {
      const summaryResponse = await this.llmService.generateCompletion(
        [
          {
            role: "system",
            content:
              "You are a helpful assistant that summarizes conversation history. Retain key facts, decisions, tool outputs, and important context. Be concise but thorough. Output in the same language as the input.",
          },
          {
            role: "user",
            content: `Please summarize the following conversation history concisely:\n\n${textToSummarize}`,
          },
        ],
        { ...modelConfig, stream: false },
      );

      if (summaryResponse) {
        const compressedMessages: AgentMessage[] = [
          {
            role: "system",
            content: `[Compressed History Summary]:\n${summaryResponse}`,
          },
          ...recentMessages,
        ];

        // Persist to new file
        await this.compressSession(sessionId, compressedMessages, modelConfig);

        logger.info(
          `[FileSessionStore] Compression complete. ${messages.length} messages -> ${compressedMessages.length} messages`,
        );

        // Notify the device about compression completion
        if (onNotify) {
          onNotify(
            `\n✅ *History compressed: ${messages.length} messages → ${compressedMessages.length} messages. Previous context saved to compressed file.*\n`,
          );
        }

        return compressedMessages;
      }
    } catch (e) {
      logger.error(`[FileSessionStore] Failed to compress session history`, e);
    }

    return messages;
  }

  private async generateSummary(firstMessage: string | any): Promise<string> {
    try {
      const text =
        typeof firstMessage === "string" ? firstMessage : "New Conversation";

      const settings = getAppSettings();
      const modelConfig = settings?.models.find(
        (m) => m.id === settings.activeModelId,
      );

      if (modelConfig && text.length > 10) {
        // Use LLM to summarize
        const response = await this.llmService.generateCompletion(
          [
            {
              role: "user",
              content: `Summarize this text in 3-5 words for a filename (no special chars/symbols, use underscores if needed): "${text}"`,
            },
          ],
          modelConfig,
        );
        return response?.trim() || "New_Chat";
      }

      return text.substring(0, 20) || "New_Chat";
    } catch (e) {
      return "New_Chat";
    }
  }

  private parseMarkdown(content: string): AgentMessage[] {
    const messages: AgentMessage[] = [];
    // Regex to match ### ROLE [DATE] ... content ... ---
    const regex =
      /### (SYSTEM|USER|ASSISTANT|TOOL) \[(.*?)\]\n\n([\s\S]*?)(?=\n### (SYSTEM|USER|ASSISTANT|TOOL) \[|\n---|$)/g;

    let match;
    while ((match = regex.exec(content)) !== null) {
      const role = match[1].toLowerCase() as any;
      const msgContent = match[3].trim();
      messages.push({
        role,
        content: msgContent,
      });
    }

    return messages;
  }
}
