import { NativeTool } from "../../tool-registry";
import { EventEmitter } from "events";
import { logger } from "../../../logger";

/**
 * Global event bridge for SubAgent ↔ User communication.
 *
 * Events:
 *   "ask_user" (payload) → emitted when agent needs user input, routed to device
 *   "user_reply:{deviceId}:{requestId}" (reply) → emitted when user responds
 */
export const userInteractionBridge = new EventEmitter();

// Increase max listeners since multiple concurrent tasks may use this
userInteractionBridge.setMaxListeners(50);

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * ask_user tool — allows SubAgents to send a message to the user and
 * optionally wait for a reply. Supports text and image (base64).
 *
 * Use cases:
 *   - Request login credentials, verification codes, confirmations
 *   - Send screenshots or QR codes for user action
 *   - Report intermediate results requiring human decision
 */
export const AskUserTool: NativeTool = {
  name: "ask_user",
  description:
    "Send a message to the user and optionally wait for their reply. " +
    "Use this when you need user input (login info, verification codes, confirmations) " +
    "or want to share images/screenshots. Set waitForReply=true to block until user responds.",
  inputSchema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The message to send to the user",
      },
      imageBase64: {
        type: "string",
        description:
          "Optional base64-encoded image to send (with or without data URI prefix)",
      },
      waitForReply: {
        type: "boolean",
        description:
          "If true, wait for user reply before returning. Default: true",
      },
      timeoutMs: {
        type: "number",
        description: `Timeout in ms for waiting. Default: ${DEFAULT_TIMEOUT_MS}ms (5 min)`,
      },
    },
    required: ["message"],
  },
  execute: async (args: any, context?: any) => {
    const {
      message,
      imageBase64,
      waitForReply = true,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    } = args;

    const deviceId = context?.deviceId || "unknown";
    const requestId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    logger.info(
      `[ask_user] Sending to device ${deviceId}: "${message.substring(0, 50)}..." (waitForReply=${waitForReply})`,
    );

    // Emit the ask_user event — InteractionManager will route to the device
    userInteractionBridge.emit("ask_user", {
      requestId,
      deviceId,
      message,
      imageBase64,
      waitForReply,
    });

    if (!waitForReply) {
      return JSON.stringify({
        status: "sent",
        message: "Message sent to user (not waiting for reply)",
      });
    }

    // Wait for user reply with timeout
    return new Promise<string>((resolve) => {
      const replyEvent = `user_reply:${deviceId}:${requestId}`;
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        userInteractionBridge.removeAllListeners(replyEvent);
        logger.info(`[ask_user] Timeout waiting for reply: ${requestId}`);
        resolve(
          JSON.stringify({
            status: "timeout",
            message: "用户未在规定时间内回复",
          }),
        );
      }, timeoutMs);

      userInteractionBridge.once(replyEvent, (reply: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        logger.info(
          `[ask_user] Received reply for ${requestId}: "${reply.substring(0, 50)}..."`,
        );
        resolve(
          JSON.stringify({
            status: "replied",
            reply,
          }),
        );
      });
    });
  },
};
