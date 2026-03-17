import { WebSocket } from "ws";
import { logger } from "../logger";
import { Planner } from "../intelligence/planner";
import { InteractionMessage } from "./types";

export interface QueueItem {
  id: string;
  deviceId: string;
  ws: WebSocket;
  message: InteractionMessage;
  abortController: AbortController;
  status: "pending" | "processing" | "completed" | "cancelled";
  modelConfig: any;
  sessionId: string;
  onStream: (chunk: any) => void;
  onComplete: (response: string) => void;
  onError: (error: Error) => void;
}

export type SupervisorDecision =
  | { action: "interrupt"; reason: string }
  | { action: "queue"; reason: string }
  | { action: "direct_reply"; reason: string; response: string };

const SUPERVISOR_SYSTEM_PROMPT = `You are a Supervisor Agent that monitors the message queue.
A team of agents is currently executing a task. A new message has arrived from the user.
Your job is to decide how to handle this new message.

**Decision Options:**

1. **interrupt** — The new message fundamentally changes the user's goal or makes the current task obsolete.
   Examples: "Stop that, do X instead", "I changed my mind, build Y not Z", "Cancel and redo with different approach"

2. **queue** — The new message adds supplementary information to the current task and should be processed after the current task completes.
   Examples: "Also add dark mode", "Use blue color for that", "Make sure to include error handling"

3. **direct_reply** — The new message is unrelated to the current task or is a simple question that can be answered immediately without affecting the current execution.
   Examples: "What time is it?", "Hello", "What's the capital of France?", "How's the current task going?"

**Output Format (JSON Only):**
\`\`\`json
{
  "action": "interrupt" | "queue" | "direct_reply",
  "reason": "Brief explanation of why this decision was made",
  "response": "If action is direct_reply, write the response here. Otherwise null."
}
\`\`\`
`;

export class MessageQueue {
  private queues: Map<string, QueueItem[]> = new Map();
  private processing: Map<string, QueueItem | null> = new Map();
  private planner: Planner;

  constructor(planner: Planner) {
    this.planner = planner;
  }

  /**
   * Enqueue a message for a device. If no task is running for this device,
   * process immediately. Otherwise, run Supervisor Triage.
   */
  public async enqueue(item: QueueItem): Promise<void> {
    const { deviceId } = item;

    // Ensure queue exists for this device
    if (!this.queues.has(deviceId)) {
      this.queues.set(deviceId, []);
    }

    const currentItem = this.processing.get(deviceId);

    if (!currentItem) {
      // No active task → process immediately
      this.processItem(item);
    } else {
      // Active task → Supervisor Triage
      logger.info(
        `[MessageQueue] Device ${deviceId} has active task. Running supervisor triage...`,
      );

      try {
        const decision = await this.supervisorTriage(
          item,
          currentItem,
        );

        switch (decision.action) {
          case "interrupt":
            logger.info(
              `[MessageQueue] Supervisor: INTERRUPT — ${decision.reason}`,
            );
            // Notify the device about interruption
            item.onStream(
              `\n⚡ *Supervisor: Interrupting current task — ${decision.reason}*\n`,
            );
            // Abort current task
            currentItem.abortController.abort();
            currentItem.status = "cancelled";
            // Process new item immediately
            this.processItem(item);
            break;

          case "direct_reply":
            logger.info(
              `[MessageQueue] Supervisor: DIRECT_REPLY — ${decision.reason}`,
            );
            // Reply directly, don't affect the queue
            item.onStream(decision.response);
            item.onComplete(decision.response);
            item.status = "completed";
            break;

          case "queue":
          default:
            logger.info(
              `[MessageQueue] Supervisor: QUEUE — ${decision.reason}`,
            );
            // Add to queue
            const queue = this.queues.get(deviceId)!;
            queue.push(item);
            const position = queue.length;
            item.onStream(
              `\n⏳ *Your message is queued (#${position}). Current task still running...*\n`,
            );
            break;
        }
      } catch (e) {
        // If supervisor triage fails, default to queueing
        logger.error("[MessageQueue] Supervisor triage failed, defaulting to queue", e);
        const queue = this.queues.get(deviceId)!;
        queue.push(item);
      }
    }
  }

  /**
   * Process a single queue item. Called when no other task is active for the device.
   */
  private async processItem(item: QueueItem): Promise<void> {
    const { deviceId } = item;
    item.status = "processing";
    this.processing.set(deviceId, item);

    try {
      // Normalize content for Planner.processInput
      // Frontend sends {content: string, images: string[]},
      // but processInput expects string | Array<{type,text}|{type,image_url}>
      const rawContent = item.message.payload.content;
      let normalizedContent: string | Array<any>;

      if (typeof rawContent === "string") {
        normalizedContent = rawContent;
      } else if (rawContent && typeof rawContent === "object" && "content" in rawContent) {
        // Object form: {content: string, images?: string[]}
        const textContent = (rawContent as any).content || "";
        const images = (rawContent as any).images || [];

        if (images.length > 0) {
          // Build multimodal array
          normalizedContent = [
            { type: "text", text: textContent },
            ...images.map((img: string) => ({
              type: "image_url",
              image_url: { url: img },
            })),
          ];
        } else {
          normalizedContent = textContent;
        }
      } else if (Array.isArray(rawContent)) {
        normalizedContent = rawContent;
      } else {
        normalizedContent = String(rawContent);
      }

      const response = await this.planner.processInput(
        deviceId,
        normalizedContent,
        item.modelConfig,
        (chunk: any) => {
          // Check abort before forwarding
          if (item.abortController.signal.aborted) return;
          item.onStream(chunk);
        },
        item.sessionId,
        item.abortController.signal,
      );

      if (!item.abortController.signal.aborted) {
        item.status = "completed";
        item.onComplete(response);
      }
    } catch (e: any) {
      if (item.abortController.signal.aborted) {
        logger.info(`[MessageQueue] Task aborted for device ${deviceId}`);
        return;
      }
      item.status = "cancelled";
      item.onError(e);
    } finally {
      this.processing.set(deviceId, null);
      // Process next item in queue
      this.processNext(deviceId);
    }
  }

  /**
   * Process the next pending item in the device's queue.
   */
  private processNext(deviceId: string): void {
    const queue = this.queues.get(deviceId);
    if (!queue || queue.length === 0) return;

    const nextItem = queue.shift()!;
    this.processItem(nextItem);
  }

  /**
   * Cancel the current task for a device.
   */
  public cancelCurrent(deviceId: string): boolean {
    const currentItem = this.processing.get(deviceId);
    if (currentItem) {
      logger.info(`[MessageQueue] Cancelling current task for device ${deviceId}`);
      currentItem.abortController.abort();
      currentItem.status = "cancelled";
      return true;
    }
    return false;
  }

  /**
   * Get the current execution state for a device (used by supervisor triage).
   */
  private getCurrentExecutionContext(item: QueueItem): string {
    // The current task's content
    const payload = item.message.payload as any;
    const content =
      typeof payload.content === "string"
        ? payload.content
        : JSON.stringify(payload.content);

    return `Current Task: ${content}\nStatus: Processing\nDevice: ${item.deviceId}`;
  }

  /**
   * Supervisor Triage: evaluate whether a new message should
   * interrupt, queue, or be answered directly.
   */
  private async supervisorTriage(
    newItem: QueueItem,
    currentItem: QueueItem,
  ): Promise<SupervisorDecision> {
    const currentContext = this.getCurrentExecutionContext(currentItem);
    const newPayload = newItem.message.payload as any;
    const newContent =
      typeof newPayload.content === "string"
        ? newPayload.content
        : JSON.stringify(newPayload.content);

    const prompt = `
**Currently Executing Task:**
${currentContext}

**New Message from User:**
${newContent}

Decide: interrupt, queue, or direct_reply?
`;

    try {
      const supervisorSchema = {
        name: "supervisor_decision",
        schema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["interrupt", "queue", "direct_reply"] },
            reason: { type: "string" },
            response: { type: ["string", "null"] },
          },
          required: ["action", "reason"],
          additionalProperties: false,
        },
      };

      const response = await this.planner.llmService.generateCompletion(
        [
          { role: "system", content: SUPERVISOR_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        { ...newItem.modelConfig, stream: false },
        true, // jsonMode
        undefined, // onChunk
        undefined, // tools
        undefined, // signal
        supervisorSchema,
      );

      if (!response) {
        return { action: "queue", reason: "Supervisor returned empty response" };
      }

      const cleanJson = response.replace(/\`\`\`json\n?|\n?\`\`\`/g, "").trim();
      const decision = JSON.parse(cleanJson);

      // Validate
      if (
        decision.action === "interrupt" ||
        decision.action === "queue" ||
        decision.action === "direct_reply"
      ) {
        return decision as SupervisorDecision;
      }

      return { action: "queue", reason: "Invalid supervisor decision format" };
    } catch (e) {
      logger.error("[MessageQueue] Failed to parse supervisor decision", e);
      return { action: "queue", reason: "Supervisor triage error - defaulting to queue" };
    }
  }

  /**
   * Get queue length for a device.
   */
  public getQueueLength(deviceId: string): number {
    return this.queues.get(deviceId)?.length || 0;
  }

  /**
   * Check if a device has an active task.
   */
  public isProcessing(deviceId: string): boolean {
    return !!this.processing.get(deviceId);
  }
}
