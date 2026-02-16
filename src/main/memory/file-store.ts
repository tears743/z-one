import * as fs from "fs/promises";
import * as path from "path";
import { AgentMessage } from "../agent/types";
import { logger } from "../logger";
import { getAppSettings } from "../db";
import { LLMService } from "../model/llm-service";

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

      // Ensure sessionId is safe (remove non-alphanumeric chars except hyphens/underscores if any, but UUIDs usually have hyphens)
      // Actually, we want to match the UUID part at the end of the filename.
      // The filename format is: {summary}_{sessionId}.md

      // Let's iterate and match suffix
      // Since sessionId is a UUID, it should be unique enough.

      const file = files.find((f) => f.includes(`_${sessionId}.md`));

      return file ? path.join(dir, file) : null;
    } catch (e) {
      logger.error(`Failed to list session files in ${dir}`, e);
      return null;
    }
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
