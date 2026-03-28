import { randomUUID } from "crypto";
import { AgentConfig, AgentState, AgentMessage } from "./types";
import { LLMService, ChatMessage } from "../model/llm-service";
import { ToolRegistry } from "../execution/tool-registry";
import { logger } from "../logger";
import { estimateMessageTokens } from "../model/token-counter";

export class Agent {
  public config: AgentConfig;
  public state: AgentState;
  private llmService: LLMService;
  private toolRegistry: ToolRegistry;
  private history: AgentMessage[] = [];

  constructor(
    config: AgentConfig,
    llmService: LLMService,
    toolRegistry: ToolRegistry,
  ) {
    this.config = config;
    this.llmService = llmService;
    this.toolRegistry = toolRegistry;
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
    onStep?: (step: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    this.state.status = "thinking";
    this.history.push({ role: "user", content: input });

    // Check and compress history if needed
    await this.compressHistoryIfNeeded();

    let steps = 0;
    const MAX_STEPS = 10;
    let finalAnswer = "";

    // Prepare Tools
    const tools = await this.getNativeTools();

    // Always use native tools (function calling) for reliable tool execution.
    // Legacy JSON text parsing is kept as fallback but is unreliable for tools 
    // whose args contain nested JSON/markdown (e.g. write_file with markdown content).
    // Most modern models (including kimi2.5) support both thinking and function calling.
    const useNativeTools = true;

    while (steps < MAX_STEPS) {
      // Check abort at each iteration
      if (signal?.aborted) {
        logger.info(`[Agent] Process aborted at step ${steps}`);
        return finalAnswer || "[Task aborted]";
      }
      steps++;

      try {
        // 1. Prepare messages for LLM
        const messages: ChatMessage[] = this.sanitizeHistory(this.history).map((m) => {
          const base: any = {
            role: m.role,
            content: m.content as any, // Cast for compatibility with ChatMessage
            name: m.name,
          };

          // Forward tool_calls and reasoning_content on assistant messages so that
          // subsequent tool-role messages have a matching tool_call_id reference,
          // and thinking-enabled models (e.g. kimi-k2.5) get required reasoning_content.
          if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
            base.tool_calls = m.tool_calls;
            if (m.reasoning_content) {
              base.reasoning_content = m.reasoning_content;
            }
          }

          // Forward tool_call_id on tool messages.
          if (m.role === "tool" && m.tool_call_id) {
            base.tool_call_id = m.tool_call_id;
          }

          return base as ChatMessage;
        });

        // 2. Call LLM
        let fullResponse = "";
        const response: any = await this.llmService.generateCompletion(
          messages,
          this.config.modelConfig,
          false, // jsonMode
          (chunk) => {
            fullResponse += chunk;
            if (onChunk) onChunk(chunk);
          },
          useNativeTools ? tools : undefined,
          signal,
        );

        if (!response) {
          throw new Error("Empty response from LLM");
        }

        // Handle Tool Calls (Object response)
        if (typeof response === "object" && response.tool_calls) {
          // Ensure every tool_call has an id (some models like kimi/local LLMs may not return one)
          const toolCalls = response.tool_calls.map((tc: any) => ({
            ...tc,
            id: tc.id || `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
          }));
          const assistantMsg: AgentMessage = {
            role: "assistant",
            content: response.content || null,
            tool_calls: toolCalls,
            reasoning_content: response.reasoning_content || undefined,
          };
          this.history.push(assistantMsg);

          // Log Thought (if content exists)
          if (response.content) {
            if (onStep) onStep(`**Thought**: ${response.content}`);
          }

          this.state.status = "acting";

          // Execute Tools
          for (const toolCall of toolCalls) {
            // Check abort before each tool call
            if (signal?.aborted) {
              logger.info(`[Agent] Aborted before tool: ${toolCall.function.name}`);
              return finalAnswer || "[Task aborted]";
            }

            let functionName = toolCall.function.name;
            // Some models (e.g. Kimi) prepend 'functions.' to tool call names — strip it
            if (functionName.startsWith('functions.')) {
              functionName = functionName.slice('functions.'.length);
            }
            const argsString = toolCall.function.arguments;
            const toolCallId = toolCall.id;

            if (onStep)
              onStep(
                `**Action**: Calling tool \`${functionName}\` with args: \`${argsString}\``,
              );
            if (onChunk) onChunk(`\n*Executing: ${functionName}*\n`);

            let resultStr = "";
            try {
              const args = JSON.parse(argsString);

              // Verify permission — reject tools not in the agent's allowed list
              if (!this.config.tools.includes(functionName)) {
                throw new Error(
                  `Tool ${functionName} not permitted for agent ${this.config.name}`,
                );
              }

              // Race tool execution against abort signal
              const toolPromise = this.toolRegistry.callTool(
                functionName,
                args,
              );

              let result: any;
              if (signal) {
                result = await Promise.race([
                  toolPromise,
                  new Promise<never>((_, reject) => {
                    if (signal.aborted) reject(new Error("Aborted"));
                    signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
                  }),
                ]);
              } else {
                result = await toolPromise;
              }

              resultStr =
                typeof result === "string" ? result : JSON.stringify(result);
            } catch (e: any) {
              if (signal?.aborted) {
                logger.info(`[Agent] Tool ${functionName} aborted`);
                return finalAnswer || "[Task aborted]";
              }
              resultStr = `Error: ${e.message}`;
            }

            if (onStep)
              onStep(`**Observation**: ${resultStr.substring(0, 500)}...`);
            if (onChunk)
              onChunk(`\n*Result: ${resultStr.substring(0, 100)}...*\n`);

            // Append Tool Result
            this.history.push({
              role: "tool",
              tool_call_id: toolCallId,
              name: functionName,
              content: resultStr,
            });
          }
          this.state.status = "thinking";
          continue; // Loop back to LLM with tool results
        }

        // Handle Text Response (Legacy or Final Answer)
        const content =
          typeof response === "string" ? response : response.content;
        const refusal = typeof response === "object" ? response.refusal : null;

        if (!content) {
          if (refusal) {
            logger.warn(`[Agent] Model refused response: ${refusal}`);
            return `I cannot complete this request. The model refused: ${refusal}`;
          }

          // If we expected native tools but got nothing, check if we have tool calls
          if (
            useNativeTools &&
            response.tool_calls &&
            response.tool_calls.length > 0
          ) {
            // This case is handled above, so if we are here, we truly have no content and no tools.
          }

          logger.error("[Agent] Received empty content and no tool calls", {
            response: JSON.stringify(response),
            history: this.history.slice(-3),
          });

          // Retry logic could go here, but for now, let's provide a better error message
          // or fallback if useLegacyTooling was intended but failed.
          if (!useNativeTools) {
            // If we expected text (JSON) but got empty, maybe the model is confused.
            // We can return a prompt to the model to "Please output JSON".
            // But strictly, we should throw.
          }

          throw new Error(
            `Received empty content and no tool calls. Response: ${JSON.stringify(response)}`,
          );
        }

        this.history.push({ role: "assistant", content: content });

        // Log Thought/Content
        // Only log as thought if we are not done yet (heuristic)
        // But for text response, we might just log it.
        // If it contains legacy JSON, we log it as thought.

        // 3. Parse JSON Action (Legacy Fallback)
        let parsed: any = null;
        try {
          // Try to extract JSON from code block first
          const match = content.match(/```json\n?([\s\S]*?)\n?```/);
          if (match) {
            parsed = JSON.parse(match[1]);
          } else {
            // Fallback: Try to find valid JSON object in text
            // We look for the LAST valid JSON object that looks like an action
            const start = content.indexOf("{");
            const end = content.lastIndexOf("}");
            if (start !== -1 && end !== -1) {
              try {
                const potentialJson = content.substring(start, end + 1);
                parsed = JSON.parse(potentialJson);
              } catch (e) {
                // If strict parse fails, maybe there are multiple JSONs or noise.
                // Try to find a JSON with "action" property.
              }
            }
          }
        } catch (e) {
          // Ignore parse errors, it might just be chat
        }

        // 4. Execute Action (Legacy)
        if (parsed && parsed.action) {
          if (onStep) onStep(`**Thought**: ${content}`);

          // Check for final answer
          if (parsed.action === "final_answer") {
            finalAnswer = parsed.args?.text || content;
            this.state.status = "idle";
            if (onStep) onStep(`**Final Answer**: ${finalAnswer}`);
            return finalAnswer;
          }

          // Verify permission for legacy actions
          if (!this.config.tools.includes(parsed.action)) {
            throw new Error(
              `Tool ${parsed.action} not permitted for agent ${this.config.name}`,
            );
          }

          this.state.status = "acting";
          if (onChunk) onChunk(`\n*Executing: ${parsed.action}*\n`);
          if (onStep)
            onStep(
              `**Action**: ${parsed.action} ${JSON.stringify(parsed.args)}`,
            );

          try {
            const result = await this.toolRegistry.callTool(
              parsed.action,
              parsed.args || {},
            );
            const resultStr =
              typeof result === "string" ? result : JSON.stringify(result);

            // Add observation to history
            this.history.push({
              role: "user",
              content: `[Tool Result for ${parsed.action}]:\n${resultStr}`,
            });

            if (onChunk)
              onChunk(`\n*Result: ${resultStr.substring(0, 100)}...*\n`);
            if (onStep)
              onStep(`**Observation**: ${resultStr.substring(0, 500)}...`);
          } catch (err: any) {
            this.history.push({
              role: "user",
              content: `[Tool Error]: ${err.message}`,
            });
            if (onChunk) onChunk(`\n*Error: ${err.message}*\n`);
            if (onStep) onStep(`**Error**: ${err.message}`);
          }
          this.state.status = "thinking";
        } else {
          // No structured action found.
          finalAnswer = content;
          this.state.status = "idle";
          // If it didn't use tools, we assume it's the final answer
          // But with native tools, we might have just completed a tool loop and got a text summary.
          if (onStep) onStep(`**Final Answer**: ${finalAnswer}`);
          return finalAnswer;
        }
      } catch (e: any) {
        this.state.status = "failed";
        logger.error(`Agent ${this.config.name} failed:`, e);
        throw e;
      }
    }

    this.state.status = "idle";
    return finalAnswer || "Agent reached max steps without final answer.";
  }

  private async getNativeTools(): Promise<any[]> {
    const allTools = await this.toolRegistry.getAllTools();
    const allowedTools = allTools.filter((t) =>
      this.config.tools.includes(t.name),
    );

    return allowedTools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema || { type: "object", properties: {} },
      },
    }));
  }

  public async executeTool(toolName: string, args: any): Promise<any> {
    if (!this.config.tools.includes(toolName)) {
      throw new Error(
        `Tool ${toolName} not permitted for agent ${this.config.name}`,
      );
    }

    this.state.status = "acting";
    try {
      const result = await this.toolRegistry.callTool(toolName, args);
      this.state.status = "idle";
      return result;
    } catch (e) {
      this.state.status = "failed";
      throw e;
    }
  }

  public setHistory(messages: AgentMessage[]) {
    this.history = this.sanitizeHistory(messages);
  }

  public getHistory(): AgentMessage[] {
    return this.history;
  }

  /**
   * Returns the execution trace (thoughts and tool interactions) for the current session.
   * Filters out system prompts and initial user input to focus on the agent's actions.
   */
  public getExecutionTrace(): string {
    return this.history
      .filter((m) => {
        if (m.role === "assistant") return true;
        if (m.role === "user") {
          return typeof m.content === "string" && m.content.startsWith("[Tool");
        }
        return false;
      })
      .map((m) => {
        const contentStr =
          typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        if (m.role === "assistant") {
          return `**Thought/Action**: ${contentStr}`;
        } else {
          return `**Observation**: ${contentStr}`;
        }
      })
      .join("\n\n");
  }

  /**
   * Sanitize history to ensure tool_calls/tool message pairing is valid.
   * - Removes orphaned 'tool' messages that lack a preceding assistant+tool_calls
   * - Strips tool_calls from assistant messages whose tool results are missing
   * - Converts orphaned tool messages to system observations so context isn't lost
   */
  private sanitizeHistory(messages: AgentMessage[]): AgentMessage[] {
    const result: AgentMessage[] = [];
    let i = 0;
    while (i < messages.length) {
      const msg = messages[i];

      if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        // Collect all expected tool_call_ids
        const expectedIds = new Set(msg.tool_calls.map((tc: any) => tc.id).filter(Boolean));
        
        // Look ahead for matching tool messages
        const toolMessages: AgentMessage[] = [];
        let j = i + 1;
        while (j < messages.length && messages[j].role === "tool") {
          toolMessages.push(messages[j]);
          j++;
        }

        // Check if all tool_calls have matching tool messages
        const foundIds = new Set(toolMessages.map(m => m.tool_call_id).filter(Boolean));
        const allMatched = expectedIds.size > 0 && [...expectedIds].every(id => foundIds.has(id));

        if (allMatched) {
          // All good, keep assistant + tool messages as-is
          result.push(msg);
          for (const tm of toolMessages) {
            result.push(tm);
          }
        } else {
          // Broken pairing — convert to plain assistant message
          logger.warn(`[Agent] sanitizeHistory: stripped tool_calls from assistant message (expected ${expectedIds.size} tools, found ${foundIds.size} matches)`);
          result.push({
            role: "assistant",
            content: msg.content || "(used tools)",
          });
          // Convert orphaned tool results into system observations
          for (const tm of toolMessages) {
            result.push({
              role: "user",
              content: `[Tool Result for ${tm.name || 'unknown'}]:\n${typeof tm.content === 'string' ? tm.content : JSON.stringify(tm.content)}`,
            });
          }
        }
        i = j;
      } else if (msg.role === "tool") {
        // Orphaned tool message (no preceding assistant+tool_calls)
        logger.warn(`[Agent] sanitizeHistory: converting orphaned tool message to system observation`);
        result.push({
          role: "user",
          content: `[Tool Result for ${msg.name || 'unknown'}]:\n${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`,
        });
        i++;
      } else {
        result.push(msg);
        i++;
      }
    }
    return result;
  }

  private async compressHistoryIfNeeded(): Promise<void> {
    const maxInputTokens = this.config.modelConfig.inputMaxTokens;
    if (!maxInputTokens) return;

    let currentTokens = 0;
    for (const msg of this.history) {
      currentTokens += estimateMessageTokens(msg);
    }

    // Trigger compression at 85% of max tokens
    const threshold = 0.85;
    const tokenLimit = Math.floor(maxInputTokens * threshold);
    if (currentTokens <= tokenLimit) return;

    logger.info(
      `[Agent] History tokens (${currentTokens}) exceed ${Math.round(threshold * 100)}% of limit (${maxInputTokens}). Compressing...`,
    );

    // Compression Strategy:
    // 1. Keep System Prompt (Index 0)
    // 2. For many messages (>3): keep last N messages, summarize the middle
    // 3. For few but huge messages (≤3): summarize the largest non-system message content

    const systemPrompt = this.history[0];
    let messagesToSummarize: AgentMessage[];
    let keepMessages: AgentMessage[];

    if (this.history.length <= 3) {
      // Few messages but still over token limit — the messages themselves are huge
      // (e.g., workflow context dump). Summarize the largest non-system message.
      let largestIdx = 1;
      let largestLen = 0;
      for (let idx = 1; idx < this.history.length; idx++) {
        const len = typeof this.history[idx].content === 'string'
          ? this.history[idx].content!.length
          : JSON.stringify(this.history[idx].content).length;
        if (len > largestLen) {
          largestLen = len;
          largestIdx = idx;
        }
      }
      messagesToSummarize = [this.history[largestIdx]];
      keepMessages = this.history.filter((_, idx) => idx !== 0 && idx !== largestIdx);
    } else {
      // Many messages — keep system + last N, summarize the middle
      const lastMessagesCount = Math.min(4, Math.floor(this.history.length / 2));
      keepMessages = this.history.slice(-lastMessagesCount);
      messagesToSummarize = this.history.slice(1, -lastMessagesCount);
      if (messagesToSummarize.length === 0) return;
    }

    // Use LLM to summarize
    try {
      const summaryPrompt = `
Summarize the following conversation history concisely, retaining key facts, decisions, and tool outputs. 
Focus on what has been done and what information was gathered.
Output in the same language as the input.

Conversation:
${JSON.stringify(messagesToSummarize)}
`;

      const summary = await this.llmService.generateCompletion(
        [
          {
            role: "system",
            content:
              "You are a helpful assistant that summarizes conversation history. Retain key facts, decisions, tool outputs, and important context. Be concise but thorough.",
          },
          { role: "user", content: summaryPrompt },
        ],
        { ...this.config.modelConfig, stream: false },
      );

      if (summary) {
        const summaryMessage: AgentMessage = {
          role: "system",
          content: `[Previous Context Summary]: ${summary}`,
        };

        // Reconstruct history
        this.history = this.sanitizeHistory([systemPrompt, summaryMessage, ...keepMessages]);

        logger.info(
          `[Agent] History compressed and sanitized. New length: ${this.history.length}`,
        );

        // Persist compressed history to file if fileSessionStore is available
        if (this.config.fileSessionStore && this.config.sessionId) {
          try {
            await this.config.fileSessionStore.compressSession(
              this.config.sessionId,
              this.history,
              this.config.modelConfig,
            );
            logger.info(
              `[Agent] Compressed history persisted to file for session ${this.config.sessionId}`,
            );
          } catch (e) {
            logger.warn(
              "[Agent] Failed to persist compressed history to file",
              e,
            );
          }
        }
      }
    } catch (e) {
      logger.error("[Agent] Failed to compress history:", e);
    }
  }

  private async getCompletion(messages: AgentMessage[]): Promise<string> {
    const config = this.config.modelConfig;

    // Convert AgentMessage to ChatMessage
    const chatMessages: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content as any, // Cast to any to handle null/undefined or type mismatches
    }));

    const response = await this.llmService.generateCompletion(
      chatMessages,
      config,
      false, // Default to text mode for general agent conversation, unless specific tool requires JSON
    );

    if (!response) {
      throw new Error("Empty response from LLM");
    }
    return response;
  }
}
