import { WebSocketServer, WebSocket } from "ws";
import { BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "crypto";
import {
  ConnectionInfo,
  InteractionMessage,
  RegisterPayload,
  AuthRequestPayload,
  AuthResponsePayload,
  RemoteControlPayload,
  RemoteControlResponse,
} from "./types";
import { generateDomQueryScript } from './dom-query';
import * as fs from 'fs';
import { getDevice, saveDevice, getModels, getAppSettings } from "../db";
import { logger } from "../logger";

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
  private mainWindow: BrowserWindow | null = null;

  public setMainWindow(win: BrowserWindow) {
    this.mainWindow = win;
  }

  constructor() {
    this.internalToken = randomUUID();
    this.initIpc();
  }

  public setPlanner(planner: Planner) {
    this.planner = planner;
    this.messageQueue = new MessageQueue(planner);
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

  private handleMessage(ws: WebSocket, message: InteractionMessage) {
    logger.info("Received message:", message);
    switch (message.type) {
      case "register":
        this.handleRegister(ws, message.payload as RegisterPayload);
        break;
      case "auth_response":
        this.handleAuthResponse(ws, message.payload as AuthResponsePayload);
        break;
      case "message":
        this.handleTextMessage(ws, message);
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
      case "remote_control":
        this.handleRemoteControl(ws, message.payload as RemoteControlPayload);
        break;
    }
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

    // Check internal token
    if (payload.type === "internal" && payload.token === this.internalToken) {
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

    if (this.planner && this.messageQueue) {
      const payload = message.payload as any;
      const sessionId = payload.sessionId;

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
          logger.error(`Error processing message from ${info.deviceId}`, error);
          this.sendTo(ws, {
            type: "message",
            payload: {
              content: `Error: ${error.message}`,
              from: "system",
            },
            timestamp: Date.now(),
          });
        },
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

  // ─── Remote Control Handler ─────────────────────────────

  private async handleRemoteControl(ws: WebSocket, payload: RemoteControlPayload) {
    const respond = (success: boolean, data?: any, error?: string) => {
      const resp: RemoteControlResponse = {
        requestId: payload.requestId,
        success,
        data,
        error,
      };
      this.sendTo(ws, {
        type: 'remote_control_response',
        payload: resp,
        timestamp: Date.now(),
      });
    };

    if (!this.mainWindow) {
      respond(false, undefined, 'Main window not available');
      return;
    }

    const webContents = this.mainWindow.webContents;

    try {
      switch (payload.action) {
        case 'screenshot': {
          const image = await this.mainWindow.capturePage();
          const pngBuffer = image.toPNG();
          const base64 = pngBuffer.toString('base64');
          if (payload.savePath) {
            fs.writeFileSync(payload.savePath, pngBuffer);
          }
          respond(true, { base64, size: pngBuffer.length, saved: !!payload.savePath });
          break;
        }
        case 'dom': {
          const script = generateDomQueryScript(payload.mode || 'interactive', payload.selector);
          const result = await webContents.executeJavaScript(script);
          respond(true, result);
          break;
        }
        case 'click': {
          if (!payload.selector) {
            respond(false, undefined, 'selector required for click');
            return;
          }
          const clickScript = `
            (function() {
              const el = document.querySelector(${JSON.stringify(payload.selector)});
              if (!el) return { success: false, error: 'Element not found: ${payload.selector}' };
              el.click();
              return { success: true, tag: el.tagName, text: el.textContent?.slice(0, 50) };
            })()
          `;
          const clickResult = await webContents.executeJavaScript(clickScript);
          respond(clickResult.success, clickResult, clickResult.error);
          break;
        }
        case 'type': {
          if (!payload.selector || payload.text === undefined) {
            respond(false, undefined, 'selector and text required for type');
            return;
          }
          const typeScript = `
            (function() {
              const el = document.querySelector(${JSON.stringify(payload.selector)});
              if (!el) return { success: false, error: 'Element not found: ${payload.selector}' };
              el.focus();
              if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
                  || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                if (nativeInputValueSetter) {
                  nativeInputValueSetter.call(el, ${JSON.stringify(payload.text)});
                } else {
                  el.value = ${JSON.stringify(payload.text)};
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              } else {
                el.textContent = ${JSON.stringify(payload.text)};
              }
              return { success: true };
            })()
          `;
          const typeResult = await webContents.executeJavaScript(typeScript);
          respond(typeResult.success, typeResult, typeResult.error);
          break;
        }
        case 'scroll': {
          const delta = payload.delta || 300;
          const scrollScript = payload.selector
            ? `(function() {
                const el = document.querySelector(${JSON.stringify(payload.selector)});
                if (!el) return { success: false, error: 'Element not found' };
                el.scrollBy(0, ${delta});
                return { success: true, scrollTop: el.scrollTop };
              })()`
            : `(function() {
                window.scrollBy(0, ${delta});
                return { success: true, scrollY: window.scrollY };
              })()`;
          const scrollResult = await webContents.executeJavaScript(scrollScript);
          respond(scrollResult.success, scrollResult, scrollResult.error);
          break;
        }
        case 'eval': {
          if (!payload.expression) {
            respond(false, undefined, 'expression required for eval');
            return;
          }
          const evalResult = await webContents.executeJavaScript(payload.expression);
          respond(true, evalResult);
          break;
        }
        case 'wait': {
          const duration = payload.duration || 1000;
          await new Promise(resolve => setTimeout(resolve, duration));
          respond(true, { waited: duration });
          break;
        }
        default:
          respond(false, undefined, `Unknown action: ${payload.action}`);
      }
    } catch (err: any) {
      respond(false, undefined, err.message);
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
}

export const interactionManager = new InteractionManager();
