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
        this.scheduleReconnect();
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

    // Skip streaming chunks — collect full response only
    if (payload?.isChunk) {
      // For streaming: we could accumulate and update a card, but for now skip
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

    logger.info(`[LarkBridge:${this.config.name}] Stopped`);
  }
}
