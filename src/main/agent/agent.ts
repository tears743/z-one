import { randomUUID } from "crypto";
import { AgentConfig, AgentState, AgentMessage } from "./types";
import { LLMService, ChatMessage } from "../model/llm-service";
import { McpHub } from "../control/mcp-hub";
import { logger } from "../logger";
import { estimateMessageTokens } from "../model/token-counter";

export class Agent {
  public config: AgentConfig;
  public state: AgentState;
  private llmService: LLMService;
  private mcpHub: McpHub;
  private history: AgentMessage[] = [];

  constructor(config: AgentConfig, llmService: LLMService, mcpHub: McpHub) {
    this.config = config;
    this.llmService = llmService;
    this.mcpHub = mcpHub;
    this.state = {
      id: config.id,
      status: "idle",
      memory: [],
    };

    // Initialize history with system prompt
    this.history.push({
      role: "system",
      content: config.systemPrompt,
    });
  }

  public async process(
    input:
      | string
      | Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string } }
        >,
    onChunk?: (chunk: string) => void,
  ): Promise<string> {
    this.state.status = "thinking";
    this.history.push({ role: "user", content: input });

    // Check and compress history if needed
    await this.compressHistoryIfNeeded();

    try {
      // 1. Prepare messages for LLM
      const messages: ChatMessage[] = this.history.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // 2. Call LLM
      // TODO: Add tool definitions to LLM call (Function Calling)
      // For now, we'll use a simple ReAct loop simulation or direct prompting

      const response = await this.llmService.generateCompletion(
        messages,
        this.config.modelConfig,
        false, // jsonMode
        onChunk, // Pass the stream callback
      );

      if (!response) {
        throw new Error("Empty response from LLM");
      }

      this.history.push({ role: "assistant", content: response });
      this.state.status = "idle";

      return response;
    } catch (e: any) {
      this.state.status = "failed";
      logger.error(`Agent ${this.config.name} failed:`, e);
      throw e;
    }
  }

  public async executeTool(toolName: string, args: any): Promise<any> {
    if (!this.config.tools.includes(toolName)) {
      throw new Error(
        `Tool ${toolName} not permitted for agent ${this.config.name}`,
      );
    }

    this.state.status = "acting";
    try {
      const result = await this.mcpHub.callTool("unknown", toolName, args);
      this.state.status = "idle";
      return result;
    } catch (e) {
      this.state.status = "failed";
      throw e;
    }
  }

  private async compressHistoryIfNeeded(): Promise<void> {
    const maxInputTokens = this.config.modelConfig.inputMaxTokens;
    if (!maxInputTokens) return;

    let currentTokens = 0;
    for (const msg of this.history) {
      currentTokens += estimateMessageTokens(msg);
    }

    if (currentTokens <= maxInputTokens) return;

    logger.info(
      `History tokens (${currentTokens}) exceed limit (${maxInputTokens}). Compressing...`,
    );

    // Compression Strategy:
    // 1. Keep System Prompt (Index 0)
    // 2. Keep last N messages (e.g., last 2 turns) to maintain immediate context
    // 3. Summarize the middle part

    if (this.history.length <= 3) return; // Can't compress much if very short

    const systemPrompt = this.history[0];
    const lastMessagesCount = 2;
    const recentHistory = this.history.slice(-lastMessagesCount);

    const messagesToSummarize = this.history.slice(1, -lastMessagesCount);
    if (messagesToSummarize.length === 0) return;

    // Use LLM to summarize
    // We create a temporary "Summarizer" context
    try {
      const summaryPrompt = `
      Summarize the following conversation history concisely, retaining key facts, decisions, and tool outputs. 
      Focus on what has been done and what information was gathered.
      
      Conversation:
      ${JSON.stringify(messagesToSummarize)}
      `;

      const summary = await this.llmService.generateCompletion(
        [
          {
            role: "system",
            content:
              "You are a helpful assistant that summarizes conversation history.",
          },
          { role: "user", content: summaryPrompt },
        ],
        this.config.modelConfig,
      ); // Use same model for summary

      if (summary) {
        const summaryMessage: AgentMessage = {
          role: "system",
          content: `[Previous Context Summary]: ${summary}`,
        };

        // Reconstruct history
        this.history = [systemPrompt, summaryMessage, ...recentHistory];

        logger.info(`History compressed. New length: ${this.history.length}`);
      }
    } catch (e) {
      logger.error("Failed to compress history:", e);
      // Fallback: Just truncate middle messages if summarization fails
      // this.history = [systemPrompt, ...recentHistory];
    }
  }
}
