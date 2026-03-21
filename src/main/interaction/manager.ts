import { WebSocketServer, WebSocket } from "ws";
import { BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "crypto";
import {
  ConnectionInfo,
  InteractionMessage,
  RegisterPayload,
  AuthRequestPayload,
  AuthResponsePayload,
} from "./types";
import { userInteractionBridge } from "../execution/tools/native/user-interaction";
import { getDevice, saveDevice, getModels, getAppSettings } from "../db";
import * as workflowStore from "../workflow/store";
import { logger } from "../logger";
import {
  generateDomQueryScript,
  generateElementQueryScript,
  generateClickScript,
  generateTypeScript,
  generateSelectScript,
  generateScrollScript,
  generateFocusScript,
} from "./dom-query";

import { Planner } from "../intelligence/planner";
import { MessageQueue } from "./message-queue";


export class InteractionManager {
  private wss: WebSocketServer | null = null;
  private connections: Map<WebSocket, ConnectionInfo> = new Map();
  private internalToken: string;
  private port: number = 18888;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private planner: Planner | null = null;
  private messageQueue: MessageQueue | null = null;

  constructor() {
    this.internalToken = randomUUID();
    this.initIpc();
  }

  public setPlanner(planner: Planner) {
    this.planner = planner;
    this.messageQueue = new MessageQueue(planner);

    // Wire up the ask_user event bridge:
    // When a SubAgent's ask_user tool emits, forward to the target device
    userInteractionBridge.on("ask_user", (payload) => {
      const { deviceId, requestId, message, imageBase64, waitForReply } = payload;

      // Send to the target device via WebSocket
      const sent = this.sendToDevice(deviceId, {
        type: "message",
        payload: {
          content: message,
          from: "agent",
          isChunk: true,
          details: {
            askUser: {
              requestId,
              message,
              imageBase64,
              waitForReply,
            },
          },
        },
        timestamp: Date.now(),
      });

      if (!sent) {
        // If device not found, broadcast to all active connections
        this.broadcast({
          type: "message",
          payload: {
            content: message,
            from: "agent",
            isChunk: true,
            details: {
              askUser: {
                requestId,
                message,
                imageBase64,
                waitForReply,
              },
            },
          },
          timestamp: Date.now(),
        });
      }

      logger.info(`[InteractionManager] Forwarded ask_user to device ${deviceId}: requestId=${requestId}`);
    });
  }

  // Lifecycle Hooks
  private onInitSuccess() {
    logger.info(
      `Interaction Layer initialized successfully on port ${this.port}`,
    );
    this.startHeartbeat();
  }

  private onInitFail(error: any) {
    logger.error("Interaction Layer initialization failed:", error);
  }

  private onDeviceConnectSuccess(info: ConnectionInfo) {
    logger.info(
      `Device connected successfully: ${info.name} (${info.deviceId})`,
      info,
    );
  }

  private onDeviceConnectFail(info: ConnectionInfo, reason: string) {
    logger.warn(
      `Device connection failed: ${info.name} (${info.deviceId}) - ${reason}`,
      info,
    );
  }

  private onBeforeMessageSend(ws: WebSocket, message: any) {
    // Hook: before sending message
    if (message.type !== "heartbeat") {
      // logger.debug('Sending message:', message);
    }
  }

  private onAfterMessageSend(ws: WebSocket, message: any) {
    // Hook: after sending message
  }

  private onBeforeDisconnect(ws: WebSocket, info?: ConnectionInfo) {
    if (info) {
      logger.info(
        `Preparing to disconnect client: ${info.name} (${info.deviceId})`,
      );
    }
  }

  private onAfterDisconnect(ws: WebSocket, info?: ConnectionInfo) {
    if (info) {
      logger.info(`Client disconnected: ${info.name} (${info.deviceId})`);
      this.broadcastDeviceList();
    }
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.connections.forEach((info, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          // Check if connection is stale?
          // For now, just send ping/heartbeat
          this.sendTo(ws, {
            type: "heartbeat",
            payload: { time: Date.now() },
            timestamp: Date.now(),
          });
        }
      });
    }, 30000); // 30s heartbeat
  }

  public start() {
    try {
      this.wss = new WebSocketServer({ port: this.port });
      this.onInitSuccess();

      this.wss.on("connection", (ws: WebSocket, req) => {
        const ip = req.socket.remoteAddress || "unknown";
        logger.info(`New connection from ${ip}`);
        (ws as any).remoteIp = ip;

        ws.on("message", (data: string) => {
          try {
            const message: InteractionMessage = JSON.parse(data.toString());

            this.handleMessage(ws, message);
          } catch (e) {
            console.error("Failed to parse message", e);
          }
        });

        ws.on("close", () => {
          const info = this.connections.get(ws);
          this.onBeforeDisconnect(ws, info);
          if (info) {
            this.connections.delete(ws);
            this.onAfterDisconnect(ws, info);
          }
        });

        ws.on("error", (err) => {
          console.error("WebSocket error:", err);
        });

        // Send initial hello/instruction?
        // For now, wait for 'register'
      });
    } catch (e) {
      this.onInitFail(e);
    }
  }

  private initIpc() {
    ipcMain.handle("interaction:get-internal-token", () => {
      return this.internalToken;
    });
  }

  // Process message from renderer/internal via IPC
  // Deprecated: Renderer should use WebSocket directly
  /*
  public async handleInternalMessage(deviceId: string, content: any, modelConfig: any): Promise<string> {
    if (!this.planner) {
        throw new Error("Planner not initialized");
    }
    
    // Process input
    const response = await this.planner.processInput(deviceId, content, modelConfig);
    return response;
  }
  */

  private async handleMessage(ws: WebSocket, message: InteractionMessage) {
    logger.info("Received message:", message);
    switch (message.type) {
      case "register":
        this.handleRegister(ws, message.payload as RegisterPayload);
        break;
      case "auth_response":
        this.handleAuthResponse(ws, message.payload as AuthResponsePayload);
        break;
      case "message":
        await this.handleTextMessage(ws, message);
        break;
      case "session_request":
        this.handleSessionRequest(ws, message.payload);
        break;
      case "session_history_request":
        this.handleSessionHistoryRequest(ws, message.payload);
        break;
      case "heartbeat":
        // Keep alive
        break;
      case "cancel_request":
        this.handleCancelRequest(ws);
        break;
      case "user_reply":
        this.handleUserReply(ws, message.payload);
        break;
      case "remote_control":
        await this.handleRemoteControl(ws, message.payload);
        break;
    }
  }

  /**
   * Handle user_reply messages from devices — route to the ask_user tool's
   * pending Promise via the event bridge.
   */
  private handleUserReply(ws: WebSocket, payload: any) {
    const info = this.connections.get(ws);
    const deviceId = info?.deviceId || "unknown";
    const { requestId, reply } = payload || {};

    if (!requestId || !reply) {
      logger.warn(`[InteractionManager] Invalid user_reply: missing requestId or reply`);
      return;
    }

    logger.info(`[InteractionManager] Received user_reply from ${deviceId}: requestId=${requestId}`);
    // Emit to the bridge — the ask_user tool is listening for this event
    userInteractionBridge.emit(`user_reply:${deviceId}:${requestId}`, reply);
  }

  private handleRegister(ws: WebSocket, payload: RegisterPayload) {
    // Check if device is already connected
    for (const [existingWs, info] of this.connections.entries()) {
      if (info.deviceId === payload.deviceId && existingWs !== ws) {
        logger.info(
          `Closing existing connection for device ${payload.deviceId} due to new registration`,
        );
        existingWs.close();
        this.connections.delete(existingWs);
      }
    }

    let info = this.connections.get(ws);
    if (!info) {
      info = {
        id: randomUUID(),
        deviceId: payload.deviceId,
        name: payload.name,
        type: "external",
        status: "pending",
        ip: (ws as any).remoteIp || "unknown",
        connectedAt: Date.now(),
      };
      this.connections.set(ws, info);
    } else {
      info.deviceId = payload.deviceId;
      info.name = payload.name;
    }

    // Check internal token or trusted CLI deviceId
    const isTrustedCli = payload.deviceId === "_zone_cli" && payload.type === "internal";
    if ((payload.type === "internal" && payload.token === this.internalToken) || isTrustedCli) {
      info.type = "internal";
      info.status = "active";

      saveDevice({
        deviceId: info.deviceId,
        name: info.name,
        type: "internal",
        status: "active",
        lastConnected: Date.now(),
      });

      this.onDeviceConnectSuccess(info);
      this.sendTo(ws, {
        type: "register_ack",
        payload: { status: "active" },
        timestamp: Date.now(),
      });
      this.broadcastDeviceList();
    } else {
      info.type = "external";

      // Check if device exists in DB
      const existingDevice = getDevice(payload.deviceId);

      if (existingDevice) {
        // Device known
        if (existingDevice.status === "active") {
          info.status = "active";

          saveDevice({
            ...existingDevice,
            lastConnected: Date.now(),
          });

          this.onDeviceConnectSuccess(info);
          this.sendTo(ws, {
            type: "register_ack",
            payload: { status: "active" },
            timestamp: Date.now(),
          });
          this.broadcastDeviceList();
        } else if (
          existingDevice.status === "blocked" ||
          existingDevice.status === "rejected"
        ) {
          info.status = "rejected";
          this.onDeviceConnectFail(
            info,
            `Device status is ${existingDevice.status}`,
          );
          this.sendTo(ws, {
            type: "register_ack",
            payload: { status: "rejected" },
            timestamp: Date.now(),
          });
          ws.close();
        } else {
          // Pending or other status
          info.status = "pending";
          logger.info(
            `Pending device re-connected: ${info.name}. Waiting approval.`,
          );
          this.requestApproval(info);
        }
      } else {
        // New device
        info.status = "pending";
        logger.info(
          `New external device request: ${info.name}. Waiting approval.`,
        );

        saveDevice({
          deviceId: info.deviceId,
          name: info.name,
          type: "external",
          status: "pending",
          lastConnected: Date.now(),
        });

        // Notify internal terminals (Renderer) to approve
        this.requestApproval(info);
      }
    }

    this.connections.set(ws, info);
  }

  private requestApproval(targetInfo: ConnectionInfo) {
    const request: AuthRequestPayload = {
      requestId: targetInfo.id,
      name: targetInfo.name,
      deviceId: targetInfo.deviceId,
      ip: targetInfo.ip,
    };

    // Send to all active internal terminals
    this.connections.forEach((info, ws) => {
      if (info.type === "internal" && info.status === "active") {
        this.sendTo(ws, {
          type: "auth_request",
          payload: request,
          timestamp: Date.now(),
        });
      }
    });
  }

  private handleAuthResponse(ws: WebSocket, payload: AuthResponsePayload) {
    const senderInfo = this.connections.get(ws);
    // Only internal terminals can approve
    if (
      !senderInfo ||
      senderInfo.type !== "internal" ||
      senderInfo.status !== "active"
    ) {
      return;
    }

    // Find the pending connection
    let targetWs: WebSocket | null = null;
    let targetInfo: ConnectionInfo | null = null;

    for (const [socket, info] of this.connections.entries()) {
      if (info.id === payload.requestId) {
        targetWs = socket;
        targetInfo = info;
        break;
      }
    }

    if (targetWs && targetInfo) {
      if (payload.approved) {
        targetInfo.status = "active";

        saveDevice({
          deviceId: targetInfo.deviceId,
          name: targetInfo.name,
          type: "external",
          status: "active",
          lastConnected: Date.now(),
        });

        this.connections.set(targetWs, targetInfo);
        this.onDeviceConnectSuccess(targetInfo);
        this.sendTo(targetWs, {
          type: "register_ack",
          payload: { status: "active" },
          timestamp: Date.now(),
        });
        logger.info(`Device approved: ${targetInfo.name}`);
        this.broadcastDeviceList();
      } else {
        targetInfo.status = "rejected";

        saveDevice({
          deviceId: targetInfo.deviceId,
          name: targetInfo.name,
          type: "external",
          status: "rejected",
          lastConnected: Date.now(),
        });

        this.connections.set(targetWs, targetInfo);
        this.onDeviceConnectFail(targetInfo, "Rejected by user");
        this.sendTo(targetWs, {
          type: "register_ack",
          payload: { status: "rejected" },
          timestamp: Date.now(),
        });
        targetWs.close();
        logger.info(`Device rejected: ${targetInfo.name}`);
      }
    }
  }

  private handleCancelRequest(ws: WebSocket) {
    const info = this.connections.get(ws);
    if (!info || info.status !== "active") return;

    if (this.messageQueue && this.messageQueue.cancelCurrent(info.deviceId)) {
      logger.info(
        `[InteractionManager] Cancelled active request for device ${info.deviceId}`,
      );

      // Acknowledge cancellation
      this.sendTo(ws, {
        type: "request_cancelled",
        payload: { deviceId: info.deviceId },
        timestamp: Date.now(),
      });
    } else {
      logger.info(
        `[InteractionManager] No active request to cancel for device ${info.deviceId}`,
      );
    }
  }

  private async handleSessionRequest(ws: WebSocket, payload: any) {
    const info = this.connections.get(ws);
    if (!info || info.status !== "active") return;

    // Generate new Session ID
    const newSessionId = randomUUID();

    // Log creation
    logger.info(
      `[SessionManager] Creating new session ${newSessionId} for device ${info.deviceId}`,
    );

    // Create a new file for the session in FileSessionStore
    if (this.planner) {
      // Initialize the session file with a placeholder asynchronously
      // We use a pseudo-message to trigger file creation
      // This ensures the file exists even before the first message is sent
      // No await here to avoid blocking response
      this.planner.sessionStore
        .appendMessage(newSessionId, {
          role: "system",
          content: `Session Created for device: ${info.deviceId}`,
        })
        .catch((e) => {
          logger.error(
            `Failed to initialize session file for ${newSessionId}`,
            e,
          );
        });
    }

    // Respond to device
    this.sendTo(ws, {
      type: "session_response",
      payload: {
        sessionId: newSessionId,
        requestId: payload.requestId, // Correlation ID if needed
        status: "created",
      },
      timestamp: Date.now(),
    });
  }

  private async handleSessionHistoryRequest(ws: WebSocket, payload: any) {
    const info = this.connections.get(ws);
    if (!info || info.status !== "active") return;

    const sessionId = payload.sessionId;
    if (!sessionId) return;

    logger.info(`[SessionManager] Loading history for session ${sessionId}`);

    let messages: any[] = [];
    if (this.planner) {
      try {
        messages = await this.planner.sessionStore.loadSession(sessionId);
      } catch (e) {
        logger.error(`Failed to load session history for ${sessionId}`, e);
      }
    }

    this.sendTo(ws, {
      type: "session_history_response",
      payload: {
        sessionId,
        messages,
      },
      timestamp: Date.now(),
    });
  }

  private async handleTextMessage(ws: WebSocket, message: InteractionMessage) {
    const info = this.connections.get(ws);
    if (!info || info.status !== "active") return;

    logger.debug(
      `[InteractionManager] Processing text message from ${info.deviceId}`,
      { timestamp: message.timestamp },
    );

    logger.info(
      `[InteractionManager] Planner state check: planner=${!!this.planner}, messageQueue=${!!this.messageQueue}`,
    );

    if (this.planner && this.messageQueue) {
      const payload = message.payload as any;
      const sessionId = payload.sessionId;

      // --- Plan Approval Interception ---
      // If there's a pending plan approval, route the user's message to the
      // approval handler instead of processing it as a new task.
      const pendingId = (userInteractionBridge as any).pendingApprovalId;
      if (pendingId) {
        // payload.content may be a string or {content: string, images: []}
        const rawContent = payload.content;
        const userReply = typeof rawContent === "string" ? rawContent : (rawContent?.content || String(rawContent));
        logger.info(`[InteractionManager] Intercepting message as plan approval reply: "${userReply}"`);
        // Emit on both event patterns the orchestrator listens to
        userInteractionBridge.emit(`user_reply:unknown:${pendingId}`, userReply);
        userInteractionBridge.emit(`plan_approval:${pendingId}`, userReply);
        return; // Don't process as a new task
      }

      // Hydrate model config from DB
      let modelConfig: any = {};
      try {
        const allModels = getModels();
        let targetModel;
        const clientModelConfig = payload.modelConfig || {};

        if (clientModelConfig.id) {
          targetModel = allModels.find((m: any) => m.id === clientModelConfig.id);
        } else {
          const settings = getAppSettings();
          if (settings && settings.activeModelId) {
            targetModel = allModels.find((m: any) => m.id === settings.activeModelId);
          }
        }

        if (targetModel) {
          modelConfig = { ...targetModel };
          if (modelConfig.stream === undefined) {
            modelConfig.stream = true;
          }
        } else {
          logger.warn("No valid model configuration found for request");
          // Send an error back to the user immediately — don't let empty config fail silently
          this.sendTo(ws, {
            type: "message",
            payload: {
              content: "❌ 未找到有效的模型配置。请在设置中添加并激活一个模型后重试。\n(No valid model configuration found. Please add and activate a model in Settings.)",
              from: "system",
              to: info.deviceId,
            },
            timestamp: Date.now(),
          });
          return;
        }
      } catch (err) {
        logger.error("Failed to hydrate model config from DB", err);
      }

      // Enqueue the message — the queue handles supervisor triage and processing
      const abortController = new AbortController();

      this.messageQueue.enqueue({
        id: randomUUID(),
        deviceId: info.deviceId,
        ws,
        message,
        abortController,
        status: "pending",
        modelConfig,
        sessionId,
        onStream: (chunk: any) => {
          if (abortController.signal.aborted) return;

          if (typeof chunk === "object" && chunk.stages) {
            this.sendTo(ws, {
              type: "message",
              payload: {
                from: "system",
                to: info.deviceId,
                isChunk: true,
                details: { swarmState: chunk },
              },
              timestamp: Date.now(),
            });
          } else if (typeof chunk === "string") {
            this.sendTo(ws, {
              type: "message",
              payload: {
                content: chunk,
                from: "system",
                to: info.deviceId,
                isChunk: true,
              },
              timestamp: Date.now(),
            });
          }
        },
        onComplete: (response: string) => {
          this.sendTo(ws, {
            type: "message",
            payload: {
              content: response,
              from: "system",
              to: info.deviceId,
            },
            timestamp: Date.now(),
          });
        },
        onError: (error: Error) => {
          logger.error(`[MessageQueue] Error processing message from ${info.deviceId}: ${error.message}`, error);
          this.sendTo(ws, {
            type: "message",
            payload: {
              content: `❌ Error: ${error.message}`,
              from: "system",
              to: info.deviceId,
            },
            timestamp: Date.now(),
          });
        },
      }).catch((err: any) => {
        logger.error(`[MessageQueue] Unhandled error during enqueue for ${info.deviceId}: ${err.message}`, err);
        this.sendTo(ws, {
          type: "message",
          payload: {
            content: `❌ Error: ${err.message}`,
            from: "system",
            to: info.deviceId,
          },
          timestamp: Date.now(),
        });
      });
    } else {
      // Fallback: Broadcast if no planner attached (Legacy mode)
      this.broadcast(message, ws);
    }
  }

  public broadcast(message: any, excludeWs?: WebSocket) {
    const msgString = JSON.stringify(message);
    this.connections.forEach((info, ws) => {
      if (
        ws !== excludeWs &&
        info.status === "active" &&
        ws.readyState === WebSocket.OPEN
      ) {
        ws.send(msgString);
      }
    });
  }

  public sendToDevice(deviceId: string, message: any) {
    for (const [ws, info] of this.connections.entries()) {
      if (info.deviceId === deviceId && info.status === "active") {
        this.sendTo(ws, message);
        return true;
      }
    }
    return false;
  }

  /**
   * Inject a message as if it came from a device.
   * Used by CronScheduler to trigger task execution.
   */
  public injectMessage(deviceId: string, content: string) {
    // Find the device's WS connection
    let targetWs: WebSocket | null = null;
    let targetInfo: ConnectionInfo | null = null;

    for (const [ws, info] of this.connections.entries()) {
      if (info.deviceId === deviceId && info.status === "active") {
        targetWs = ws;
        targetInfo = info;
        break;
      }
    }

    // Fallback to internal web page if target device not connected
    if (!targetWs || !targetInfo) {
      for (const [ws, info] of this.connections.entries()) {
        if (info.deviceId === "_zone_web_page" && info.status === "active") {
          targetWs = ws;
          targetInfo = info;
          break;
        }
      }
    }

    if (!targetWs || !targetInfo) {
      logger.warn(
        `[InteractionManager] Cannot inject message: no active connection for ${deviceId}`,
      );
      return false;
    }

    // Create a synthetic message and handle it as text message
    const syntheticMessage: InteractionMessage = {
      type: "message",
      payload: {
        content: { content, images: [] },
        from: targetInfo.deviceId,
        sessionId: undefined, // New session for each cron execution
      },
      timestamp: Date.now(),
    };

    this.handleTextMessage(targetWs, syntheticMessage);
    logger.info(
      `[InteractionManager] Injected scheduled task message to device ${targetInfo.deviceId}`,
    );
    return true;
  }

  private sendTo(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      this.onBeforeMessageSend(ws, message);
      ws.send(JSON.stringify(message));
      this.onAfterMessageSend(ws, message);
    }
  }

  private broadcastDeviceList() {
    const devices = Array.from(this.connections.values()).map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      type: c.type,
      deviceId: c.deviceId,
    }));

    this.connections.forEach((info, ws) => {
      if (info.status === "active" && ws.readyState === WebSocket.OPEN) {
        this.sendTo(ws, {
          type: "device_list",
          payload: devices,
          timestamp: Date.now(),
        });
      }
    });
  }

  // ─── Remote Control Handler ─────────────────────────────────────────

  private async handleRemoteControl(ws: WebSocket, payload: any) {
    const info = this.connections.get(ws);
    // Only allow internal (trusted) connections to use remote control
    if (!info || info.type !== "internal" || info.status !== "active") {
      this.sendTo(ws, {
        type: "remote_control_response",
        payload: { requestId: payload?.requestId, error: "Unauthorized: only internal devices can use remote control" },
        timestamp: Date.now(),
      });
      return;
    }

    const { requestId, action, params } = payload || {};
    if (!action) {
      this.sendTo(ws, {
        type: "remote_control_response",
        payload: { requestId, error: "Missing action" },
        timestamp: Date.now(),
      });
      return;
    }

    let result: any;

    try {
      const { BrowserWindow } = require("electron");
      const win = BrowserWindow.getAllWindows()[0];

      switch (action) {
        case "screenshot": {
          if (!win) { result = { error: "No window available" }; break; }
          const image = await win.capturePage();
          const png = image.toPNG();
          const base64 = png.toString("base64");
          if (params?.save) {
            const fs = require("fs");
            fs.writeFileSync(params.save, png);
            result = { success: true, savedTo: params.save, size: png.length };
          } else {
            result = { success: true, image: `data:image/png;base64,${base64}`, size: png.length };
          }
          break;
        }

        case "dom": {
          if (!win) { result = { error: "No window available" }; break; }
          const script = generateDomQueryScript(params || {});
          const raw = await win.webContents.executeJavaScript(script);
          result = JSON.parse(raw);
          break;
        }

        case "dom_element": {
          if (!win) { result = { error: "No window available" }; break; }
          if (!params?.selector) { result = { error: "Missing selector" }; break; }
          const elScript = generateElementQueryScript(params.selector);
          const elRaw = await win.webContents.executeJavaScript(elScript);
          result = JSON.parse(elRaw);
          break;
        }

        case "click": {
          if (!win) { result = { error: "No window available" }; break; }
          if (!params?.selector) { result = { error: "Missing selector" }; break; }
          const clickScript = generateClickScript(params.selector);
          const clickRaw = await win.webContents.executeJavaScript(clickScript);
          result = JSON.parse(clickRaw);
          break;
        }

        case "dblclick": {
          if (!win) { result = { error: "No window available" }; break; }
          if (!params?.selector) { result = { error: "Missing selector" }; break; }
          // Double-click: get element rect, then send two mouse events
          const dblScript = `(function() {
            try {
              const el = document.querySelector("${params.selector.replace(/"/g, '\\"')}");
              if (!el) return JSON.stringify({ error: "Element not found" });
              el.scrollIntoView({ block: "center" });
              const rect = el.getBoundingClientRect();
              el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: rect.x + rect.width/2, clientY: rect.y + rect.height/2 }));
              return JSON.stringify({ success: true });
            } catch(e) { return JSON.stringify({ error: e.message }); }
          })()`;
          const dblRaw = await win.webContents.executeJavaScript(dblScript);
          result = JSON.parse(dblRaw);
          break;
        }

        case "type": {
          if (!win) { result = { error: "No window available" }; break; }
          if (!params?.selector || params.text === undefined) {
            result = { error: "Missing selector or text" }; break;
          }
          const typeScript = generateTypeScript(params.selector, params.text);
          const typeRaw = await win.webContents.executeJavaScript(typeScript);
          result = JSON.parse(typeRaw);
          break;
        }

        case "scroll": {
          if (!win) { result = { error: "No window available" }; break; }
          const scrollScript = generateScrollScript(
            params?.selector || null,
            params?.deltaX || 0,
            params?.deltaY || 0
          );
          const scrollRaw = await win.webContents.executeJavaScript(scrollScript);
          result = JSON.parse(scrollRaw);
          break;
        }

        case "select": {
          if (!win) { result = { error: "No window available" }; break; }
          if (!params?.selector || params.value === undefined) {
            result = { error: "Missing selector or value" }; break;
          }
          const selScript = generateSelectScript(params.selector, params.value);
          const selRaw = await win.webContents.executeJavaScript(selScript);
          result = JSON.parse(selRaw);
          break;
        }

        case "focus": {
          if (!win) { result = { error: "No window available" }; break; }
          if (!params?.selector) { result = { error: "Missing selector" }; break; }
          const focScript = generateFocusScript(params.selector);
          const focRaw = await win.webContents.executeJavaScript(focScript);
          result = JSON.parse(focRaw);
          break;
        }

        case "eval": {
          if (!win) { result = { error: "No window available" }; break; }
          if (!params?.code) { result = { error: "Missing code" }; break; }
          const evalResult = await win.webContents.executeJavaScript(params.code);
          result = { success: true, result: evalResult };
          break;
        }

        case "get_app_state": {
          try {
            const settings = getAppSettings();
            const models = getModels();
            const devices = Array.from(this.connections.values()).map(c => ({
              deviceId: c.deviceId, name: c.name, status: c.status, type: c.type,
            }));
            result = { settings, models, devices };
          } catch (e: any) {
            result = { error: e.message };
          }
          break;
        }

        case "get_window_info": {
          if (!win) { result = { error: "No window available" }; break; }
          const bounds = win.getBounds();
          result = {
            bounds,
            title: win.getTitle(),
            focused: win.isFocused(),
            visible: win.isVisible(),
            minimized: win.isMinimized(),
            maximized: win.isMaximized(),
            fullScreen: win.isFullScreen(),
          };
          break;
        }


        // ─── Workflow Actions (via WS remote_control) ──────────────────────

        case "workflow_list": {
          try {
            const workflows = workflowStore.listWorkflows();
            result = {
              workflows: workflows.map((w) => ({
                id: w.id,
                name: w.name,
                description: w.description,
                version: w.version,
                nodeCount: w.nodes.length,
                updatedAt: w.updatedAt,
              })),
            };
          } catch (e: any) {
            result = { error: e.message };
          }
          break;
        }

        case "workflow_status": {
          const wfId = params?.id;
          if (!wfId) { result = { error: "Missing workflow id" }; break; }
          try {
            const workflow = workflowStore.getWorkflow(wfId);
            if (!workflow) { result = { error: `Workflow ${wfId} not found` }; break; }
            const runs = workflowStore.getRunsByWorkflow(wfId);
            result = {
              workflow: {
                id: workflow.id,
                name: workflow.name,
                description: workflow.description,
                version: workflow.version,
                nodeCount: workflow.nodes.length,
                nodes: workflow.nodes.map((n) => ({ id: n.id, type: n.type, label: n.label })),
              },
              runs: runs.map((r) => ({
                id: r.id,
                status: r.status,
                startedAt: r.startedAt,
                completedAt: r.completedAt,
                nodeStates: Object.fromEntries(
                  Object.entries(r.nodeStates).map(([nid, ns]) => [
                    nid,
                    { status: ns.status, iterations: ns.iterations },
                  ]),
                ),
              })),
            };
          } catch (e: any) {
            result = { error: e.message };
          }
          break;
        }

        case "workflow_start": {
          const startId = params?.id;
          if (!startId) { result = { error: "Missing workflow id" }; break; }
          try {
            const engine = this.planner?.getWorkflowEngine();
            if (!engine) { result = { error: "Workflow engine not initialized" }; break; }
            const settings = getAppSettings();
            const models = getModels();
            const modelCfg = models.find((m: any) => m.id === settings?.activeModelId) || {};
            const run = await engine.startWorkflow(startId, modelCfg);
            result = { success: true, runId: run.id, status: run.status };
          } catch (e: any) {
            result = { error: e.message };
          }
          break;
        }

        case "workflow_pause": {
          const pauseRunId = params?.runId;
          if (!pauseRunId) { result = { error: "Missing runId" }; break; }
          try {
            const engine = this.planner?.getWorkflowEngine();
            if (!engine) { result = { error: "Workflow engine not initialized" }; break; }
            engine.pauseWorkflow(pauseRunId);
            result = { success: true };
          } catch (e: any) {
            result = { error: e.message };
          }
          break;
        }

        case "workflow_resume": {
          const resumeRunId = params?.runId;
          if (!resumeRunId) { result = { error: "Missing runId" }; break; }
          try {
            const engine = this.planner?.getWorkflowEngine();
            if (!engine) { result = { error: "Workflow engine not initialized" }; break; }
            const settings = getAppSettings();
            const models = getModels();
            const modelCfg = models.find((m: any) => m.id === settings?.activeModelId) || {};
            await engine.resumeWorkflow(resumeRunId, modelCfg);
            result = { success: true };
          } catch (e: any) {
            result = { error: e.message };
          }
          break;
        }

        case "workflow_inject": {
          const injectRunId = params?.runId;
          const injectNodeId = params?.nodeId;
          const injectMessage = params?.message;
          if (!injectRunId || !injectNodeId || !injectMessage) {
            result = { error: "Missing runId, nodeId, or message" };
            break;
          }
          try {
            const engine = this.planner?.getWorkflowEngine();
            if (!engine) { result = { error: "Workflow engine not initialized" }; break; }
            engine.injectMessage(injectRunId, injectNodeId, injectMessage);
            result = { success: true };
          } catch (e: any) {
            result = { error: e.message };
          }
          break;
        }

        case "workflow_logs": {
          const logsRunId = params?.runId;
          const logsNodeId = params?.nodeId;
          if (!logsRunId) { result = { error: "Missing runId" }; break; }
          try {
            const run = workflowStore.getRun(logsRunId);
            if (!run) { result = { error: `Run ${logsRunId} not found` }; break; }
            if (logsNodeId) {
              const nodeState = run.nodeStates[logsNodeId];
              result = nodeState
                ? { nodeId: logsNodeId, status: nodeState.status, logs: nodeState.logs, output: nodeState.output, iterations: nodeState.iterations }
                : { error: `Node ${logsNodeId} not found in run` };
            } else {
              result = {
                nodeStates: Object.fromEntries(
                  Object.entries(run.nodeStates).map(([nid, ns]) => [
                    nid,
                    { status: ns.status, logs: ns.logs.slice(-10), iterations: ns.iterations },
                  ]),
                ),
              };
            }
          } catch (e: any) {
            result = { error: e.message };
          }
          break;
        }

        case "workflow_delete": {
          const deleteId = params?.id;
          if (!deleteId) { result = { error: "Missing workflow id" }; break; }
          try {
            workflowStore.deleteWorkflow(deleteId);
            result = { success: true };
          } catch (e: any) {
            result = { error: e.message };
          }
          break;
        }

        default:
          result = { error: `Unknown action: ${action}` };
      }
    } catch (err: any) {
      result = { error: err.message };
    }

    this.sendTo(ws, {
      type: "remote_control_response",
      payload: { requestId, action, result },
      timestamp: Date.now(),
    });
  }
}

export const interactionManager = new InteractionManager();
