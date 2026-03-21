import * as Lark from "@larksuiteoapi/node-sdk";
import WebSocket from "ws";
import { logger } from "../logger";
import { DeviceConfig } from "../../renderer/src/types/settings";

/**
 * LarkBridge connects a Lark (飞书) bot to Z-One's InteractionManager
 * via WebSocket. It receives messages from Lark users (DM and group @mention),
 * forwards them to the planner, and replies using Lark's API with rich cards.
 */
export class LarkBridge {
  private config: DeviceConfig;
  private larkClient: InstanceType<typeof Lark.Client> | null = null;
  private wsClient: InstanceType<typeof Lark.WSClient> | null = null;
  private ws: WebSocket | null = null;
  private deviceId: string;
  private registered = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private sessionId: string | null = null;

  // Map: WS message correlation → Lark reply context
  private pendingReplies: Map<
    number,
    { messageId: string; chatId: string; chatType: string; reactionPromise?: Promise<string | undefined> }
  > = new Map();

  // Map: Lark chatId → pending ask_user request for routing user replies
  private pendingAskUsers: Map<string, { requestId: string; deviceId: string }> = new Map();

  constructor(config: DeviceConfig) {
    this.config = config;
    this.deviceId = `lark-${config.id}`;
  }

  /**
   * Start: Initialize Lark client + WS bridge
   */
  async start() {
    if (!this.config.appId || !this.config.appSecret) {
      logger.error(
        `[LarkBridge:${this.config.name}] Missing appId or appSecret`,
      );
      return;
    }

    const larkConfig = {
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    };

    // Lark REST client for sending replies
    this.larkClient = new Lark.Client(larkConfig);

    // Lark WebSocket client for receiving events
    this.wsClient = new Lark.WSClient({
      ...larkConfig,
      loggerLevel: Lark.LoggerLevel.info,
    });

    // Connect to InteractionManager
    this.connectToManager();

    // Start listening for Lark events
    this.wsClient.start({
      eventDispatcher: new Lark.EventDispatcher({}).register({
        "im.message.receive_v1": async (data) => {
          await this.handleLarkMessage(data);
        },
      }),
    });

    logger.info(
      `[LarkBridge:${this.config.name}] Started (device: ${this.deviceId})`,
    );
  }

  /**
   * Connect to Z-One's InteractionManager WebSocket
   */
  private connectToManager() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket("ws://localhost:18888");
      const currentWs = this.ws; // Capture reference for close handler

      this.ws.on("open", () => {
        logger.info(
          `[LarkBridge:${this.config.name}] Connected to InteractionManager`,
        );
        // Register as an external device
        this.ws!.send(
          JSON.stringify({
            type: "register",
            payload: {
              name: `Lark: ${this.config.name}`,
              type: "external",
              deviceId: this.deviceId,
            },
            timestamp: Date.now(),
          }),
        );
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleManagerMessage(msg);
        } catch (e) {
          logger.error(
            `[LarkBridge:${this.config.name}] Failed to parse WS message`,
            e,
          );
        }
      });

      this.ws.on("close", () => {
        logger.info(
          `[LarkBridge:${this.config.name}] Disconnected from InteractionManager`,
        );
        this.registered = false;
        // Only reconnect if this socket is still the active one
        // (prevents reconnect loop when server closes old connection due to re-registration)
        if (this.ws === currentWs) {
          this.scheduleReconnect();
        }
      });

      this.ws.on("error", (err) => {
        logger.error(
          `[LarkBridge:${this.config.name}] WS error`,
          err,
        );
      });
    } catch (err) {
      logger.error(
        `[LarkBridge:${this.config.name}] Failed to connect to InteractionManager`,
        err,
      );
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectToManager();
    }, 5000);
  }

  /**
   * Handle incoming Lark message → forward to InteractionManager
   */
  private async handleLarkMessage(data: any) {
    const {
      message: {
        message_id: messageId,
        chat_id: chatId,
        chat_type: chatType,
        content,
        mentions,
      },
      sender,
    } = data;

    // Parse message content
    let textContent = "";
    try {
      const parsed = JSON.parse(content);
      textContent = parsed.text || "";
    } catch {
      textContent = content || "";
    }

    // For group messages, strip @bot mention text
    if (chatType === "group" && mentions?.length) {
      for (const mention of mentions) {
        if (mention.name) {
          textContent = textContent.replace(`@${mention.name}`, "").trim();
        }
        // Also handle @_user_1 style placeholders
        if (mention.key) {
          textContent = textContent.replace(mention.key, "").trim();
        }
      }
    }

    if (!textContent) return;

    // Reset stage tracking for each new user message
    this.reportedStages.clear();

    // Check if this is a reply to a pending ask_user request
    if (this.pendingAskUsers.has(chatId)) {
      const pending = this.pendingAskUsers.get(chatId)!;
      this.pendingAskUsers.delete(chatId);

      logger.info(`[LarkBridge:${this.config.name}] Routing user reply to ask_user request: ${pending.requestId}`);

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: "user_reply",
          payload: {
            requestId: pending.requestId,
            reply: textContent,
          },
          timestamp: Date.now(),
        }));
      }
      return; // Don't process as a new task
    }

    // Fire-and-forget: add "thinking" emoji reaction without blocking message processing.
    // Store the promise so we can resolve the reactionId later for cleanup.
    const reactionPromise = this.addThinkingReaction(messageId);

    const senderId = sender?.sender_id?.open_id || "unknown";
    logger.info(
      `[LarkBridge:${this.config.name}] Received from ${chatType}:${chatId}, sender: ${senderId}: ${textContent}`,
    );

    // Ensure WS connection
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.registered) {
      // Queue or drop — for now reply with error
      await this.replyToLark(messageId, chatId, chatType, "⚠️ Agent 暂时离线，请稍后再试。");
      return;
    }

    // Store reply context keyed by timestamp (used to correlate responses)
    const timestamp = Date.now();
    this.pendingReplies.set(timestamp, { messageId, chatId, chatType, reactionPromise });

    // Request a session if we don't have one
    if (!this.sessionId) {
      this.ws.send(
        JSON.stringify({
          type: "session_request",
          payload: { requestId: `lark-session-${timestamp}` },
          timestamp,
        }),
      );
      // Wait briefly for session response
      await new Promise((r) => setTimeout(r, 500));
    }

    // Forward as text_message to InteractionManager
    this.ws.send(
      JSON.stringify({
        type: "message",
        payload: {
          content: textContent,
          from: this.deviceId,
          sessionId: this.sessionId,
          modelConfig: {}, // Use server default
          larkContext: { messageId, chatId, chatType, senderId },
        },
        timestamp,
      }),
    );
  }

  /**
   * Handle messages from InteractionManager
   */
  private handleManagerMessage(msg: any) {
    switch (msg.type) {
      case "register_ack":
        if (msg.payload?.status === "active") {
          this.registered = true;
          logger.info(
            `[LarkBridge:${this.config.name}] Registered as device ${this.deviceId}`,
          );
        } else {
          logger.warn(
            `[LarkBridge:${this.config.name}] Registration status: ${msg.payload?.status}`,
          );
        }
        break;

      case "session_response":
        if (msg.payload?.sessionId) {
          this.sessionId = msg.payload.sessionId;
          logger.info(
            `[LarkBridge:${this.config.name}] Session: ${this.sessionId}`,
          );
        }
        break;

      case "message":
        this.handleAgentResponse(msg);
        break;

      case "heartbeat":
        // Respond to heartbeat
        break;
    }
  }

  /**
   * Handle agent response → send to Lark user
   */
  private async handleAgentResponse(msg: any) {
    const payload = msg.payload;

    // Handle streaming chunks — send real-time stage results
    if (payload?.isChunk) {
      if (payload?.details?.swarmState) {
        this.handleSwarmStateUpdate(payload.details.swarmState);
      }
      if (payload?.details?.askUser) {
        this.handleAskUserChunk(payload.details.askUser);
      }
      // Skip plain text chunks (they accumulate in the final response)
      return;
    }

    const content = payload?.content;
    if (!content) return;

    // Find the Lark reply context
    // Use the most recent pending reply for this device
    let replyCtx: { messageId: string; chatId: string; chatType: string; reactionPromise?: Promise<string | undefined> } | undefined;
    for (const [ts, ctx] of this.pendingReplies.entries()) {
      replyCtx = ctx;
      this.pendingReplies.delete(ts);
      break; // Take the oldest
    }

    if (replyCtx) {
      // Resolve the reaction promise and remove the thinking reaction
      const reactionId = replyCtx.reactionPromise ? await replyCtx.reactionPromise : undefined;
      await this.removeThinkingReaction(replyCtx.messageId, reactionId);

      await this.replyToLark(
        replyCtx.messageId,
        replyCtx.chatId,
        replyCtx.chatType,
        content,
      );
    } else {
      logger.warn(
        `[LarkBridge:${this.config.name}] No reply context found for response`,
      );
    }
  }

  /**
   * Track which stages have been reported to avoid duplicate cards
   */
  private reportedStages: Set<string> = new Set();

  /**
   * Handle swarm state updates — send stage result cards when stages complete
   */
  private handleSwarmStateUpdate(swarmState: any) {
    if (!swarmState?.stages) return;

    for (const stage of swarmState.stages) {
      const stageKey = stage.id || stage.name;
      if (!stageKey) continue;

      // Skip if already reported
      if (this.reportedStages.has(stageKey)) continue;

      // Check if all tasks in this stage are done (completed/failed/cancelled)
      const allDone = stage.tasks?.every(
        (t: any) => t.status === "completed" || t.status === "failed" || t.status === "cancelled",
      );

      if (allDone && stage.tasks?.length > 0) {
        this.reportedStages.add(stageKey);
        // Fire-and-forget stage result card
        this.sendStageResultCard(stage).catch((err) => {
          logger.warn(`[LarkBridge:${this.config.name}] Failed to send stage result card`, err);
        });
      }
    }
  }

  /**
   * Handle ask_user chunk — send an interactive Card and track pending request
   */
  private async handleAskUserChunk(askUser: any) {
    const { requestId, message, imageBase64, waitForReply } = askUser;
    if (!requestId || !message) return;

    // Get chat context from pending replies
    let chatId: string | undefined;
    for (const [, ctx] of this.pendingReplies.entries()) {
      chatId = ctx.chatId;
      break;
    }
    if (!chatId || !this.larkClient) return;

    // If agent expects a reply, track this request
    if (waitForReply) {
      this.pendingAskUsers.set(chatId, {
        requestId,
        deviceId: this.deviceId,
      });
    }

    // Upload image if provided
    let imageKey: string | undefined;
    if (imageBase64) {
      imageKey = await this.uploadImage(imageBase64);
    }

    // Build and send the ask_user Card
    const card = this.buildAskUserCard(message, waitForReply, imageKey);
    try {
      await this.larkClient.im.v1.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: chatId,
          content: JSON.stringify(card),
          msg_type: "interactive",
        },
      });
      logger.info(`[LarkBridge:${this.config.name}] Sent ask_user card: ${requestId}`);
    } catch (err) {
      logger.warn(`[LarkBridge:${this.config.name}] Failed to send ask_user card`, err);
    }
  }

  /**
   * Build a Lark Card for ask_user — prompts user for input
   */
  private buildAskUserCard(message: string, waitForReply: boolean, imageKey?: string): object {
    const elements: any[] = [
      {
        tag: "markdown",
        content: message,
      },
    ];

    if (imageKey) {
      elements.push({
        tag: "img",
        img_key: imageKey,
        alt: { tag: "plain_text", content: "Agent Image" },
      });
    }

    if (waitForReply) {
      elements.push({ tag: "hr" });
      elements.push({
        tag: "markdown",
        content: "💬 **请直接回复此消息以响应 Agent 的请求**",
      });
    }

    elements.push({ tag: "hr" });
    elements.push({
      tag: "note",
      elements: [
        { tag: "plain_text", content: waitForReply ? "Z-One Agent · 等待您的回复" : "Z-One Agent · 通知" },
      ],
    });

    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: waitForReply ? "💬 Agent 需要您的帮助" : "📢 Agent 消息" },
        template: waitForReply ? "purple" : "blue",
      },
      elements,
    };
  }

  /**
   * Send a stage result card to the Lark chat
   */
  private async sendStageResultCard(stage: any) {
    // Get the chat context from the latest pending reply
    let chatId: string | undefined;
    for (const [, ctx] of this.pendingReplies.entries()) {
      chatId = ctx.chatId;
      break;
    }
    if (!chatId || !this.larkClient) return;

    const card = this.buildStageCard(stage);
    try {
      await this.larkClient.im.v1.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: chatId,
          content: JSON.stringify(card),
          msg_type: "interactive",
        },
      });
      logger.info(`[LarkBridge:${this.config.name}] Sent stage result card: ${stage.name}`);
    } catch (err) {
      logger.warn(`[LarkBridge:${this.config.name}] Failed to send stage card`, err);
    }
  }

  /**
   * Build a visually appealing Lark Card for a completed stage
   */
  private buildStageCard(stage: any): object {
    const allSuccess = stage.tasks.every((t: any) => t.status === "completed");
    const statusEmoji = allSuccess ? "✅" : "⚠️";
    const headerColor = allSuccess ? "green" : "orange";

    const taskLines = stage.tasks.map((t: any) => {
      const icon = t.status === "completed" ? "✅" : t.status === "failed" ? "❌" : "⏹️";
      const agent = t.assignedTo || "Agent";
      const desc = t.description?.substring(0, 80) || "Task";
      // Truncate output for readability
      let outputLine = "";
      if (t.output) {
        const preview = String(t.output).substring(0, 120).replace(/\n/g, " ");
        outputLine = `\n    > ${preview}${String(t.output).length > 120 ? "..." : ""}`;
      }
      return `${icon} **${agent}**: ${desc}${outputLine}`;
    }).join("\n\n");

    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: `${statusEmoji} 阶段完成: ${stage.name}` },
        template: headerColor,
      },
      elements: [
        {
          tag: "markdown",
          content: taskLines,
        },
        { tag: "hr" },
        {
          tag: "note",
          elements: [
            { tag: "plain_text", content: "Z-One Agent · Real-time Progress" },
          ],
        },
      ],
    };
  }

  /**
   * Upload a base64-encoded image to Lark and get an image_key.
   * @param base64Data - Base64 string (with or without data URI prefix)
   * @returns image_key string or undefined on failure
   */
  async uploadImage(base64Data: string): Promise<string | undefined> {
    if (!this.larkClient) return undefined;

    try {
      // Strip data URI prefix if present (e.g., "data:image/png;base64,...")
      const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(cleanBase64, "base64");

      // Write to temp file and create ReadStream (Lark SDK expects Buffer | ReadStream)
      const tmpPath = require("path").join(require("os").tmpdir(), `z-one-upload-${Date.now()}.png`);
      require("fs").writeFileSync(tmpPath, buffer);
      const imageStream = require("fs").createReadStream(tmpPath);

      const res = await this.larkClient.im.v1.image.create({
        data: {
          image_type: "message",
          image: imageStream,
        },
      });

      // Clean up temp file
      try { require("fs").unlinkSync(tmpPath); } catch {}

      const imageKey = (res as any)?.data?.image_key || (res as any)?.image_key;
      logger.info(`[LarkBridge:${this.config.name}] Uploaded image: ${imageKey}`);
      return imageKey;
    } catch (err) {
      logger.error(`[LarkBridge:${this.config.name}] Failed to upload image`, err);
      return undefined;
    }
  }

  /**
   * Send an image message to a Lark chat
   */
  async sendImageMessage(chatId: string, imageKey: string): Promise<void> {
    if (!this.larkClient) return;

    try {
      await this.larkClient.im.v1.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: chatId,
          content: JSON.stringify({ image_key: imageKey }),
          msg_type: "image",
        },
      });
      logger.info(`[LarkBridge:${this.config.name}] Sent image to ${chatId}`);
    } catch (err) {
      logger.error(`[LarkBridge:${this.config.name}] Failed to send image`, err);
    }
  }

  /**
   * Reply to Lark — auto-selects format based on content
   */
  private async replyToLark(
    messageId: string,
    chatId: string,
    chatType: string,
    content: string,
  ) {
    if (!this.larkClient) return;

    try {
      // Choose format based on content length
      if (content.length < 200 && !content.includes("```") && !content.includes("#")) {
        // Short text → plain text reply
        await this.larkClient.im.v1.message.reply({
          path: { message_id: messageId },
          data: {
            content: JSON.stringify({ text: content }),
            msg_type: "text",
          },
        });
      } else {
        // Long / markdown → interactive card
        const card = this.buildCard(content);
        await this.larkClient.im.v1.message.reply({
          path: { message_id: messageId },
          data: {
            content: JSON.stringify(card),
            msg_type: "interactive",
          },
        });
      }

      logger.info(
        `[LarkBridge:${this.config.name}] Replied to ${chatType}:${chatId}`,
      );
    } catch (err) {
      logger.error(
        `[LarkBridge:${this.config.name}] Failed to reply via Lark API`,
        err,
      );
    }
  }

  /**
   * Build a Lark interactive card from markdown content
   */
  private buildCard(content: string): object {
    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: "Z-One Agent" },
        template: "blue",
      },
      elements: [
        {
          tag: "markdown",
          content: content,
        },
        { tag: "hr" },
        {
          tag: "note",
          elements: [
            { tag: "plain_text", content: "Powered by Z-One Agent" },
          ],
        },
      ],
    };
  }

  /**
   * Add a "thinking" emoji reaction to the user's message for instant feedback.
   * Returns the reaction_id for later removal.
   */
  private async addThinkingReaction(messageId: string): Promise<string | undefined> {
    if (!this.larkClient) return undefined;

    try {
      const res = await this.larkClient.im.v1.messageReaction.create({
        path: { message_id: messageId },
        data: {
          reaction_type: { emoji_type: "THINKING" },
        },
      });

      const reactionId = res?.data?.reaction_id;
      logger.info(
        `[LarkBridge:${this.config.name}] Added thinking reaction: ${reactionId}`,
      );
      return reactionId;
    } catch (err) {
      logger.warn(
        `[LarkBridge:${this.config.name}] Failed to add thinking reaction`,
        err,
      );
      return undefined;
    }
  }

  /**
   * Remove the "thinking" emoji reaction after agent has responded.
   */
  private async removeThinkingReaction(messageId: string, reactionId?: string) {
    if (!this.larkClient || !reactionId) return;

    try {
      await this.larkClient.im.v1.messageReaction.delete({
        path: {
          message_id: messageId,
          reaction_id: reactionId,
        },
      });
      logger.info(
        `[LarkBridge:${this.config.name}] Removed thinking reaction: ${reactionId}`,
      );
    } catch (err) {
      logger.warn(
        `[LarkBridge:${this.config.name}] Failed to remove thinking reaction`,
        err,
      );
    }
  }

  /**
   * Stop the bridge
   */
  async stop() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Lark SDK WSClient doesn't have a clean stop method exposed,
    // but we can null it out
    this.wsClient = null;
    this.larkClient = null;
    this.registered = false;
    this.sessionId = null;
    this.pendingReplies.clear();
    this.reportedStages.clear();

    logger.info(`[LarkBridge:${this.config.name}] Stopped`);
  }
}
