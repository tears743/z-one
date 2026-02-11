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
import { getDevice, saveDevice, getModels, getAppSettings } from "../db";
import { logger } from "../logger";

import { Planner } from "../intelligence/planner";

export class InteractionManager {
  private wss: WebSocketServer | null = null;
  private connections: Map<WebSocket, ConnectionInfo> = new Map();
  private internalToken: string;
  private port: number = 18888;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private planner: Planner | null = null;

  constructor() {
    this.internalToken = randomUUID();
    this.initIpc();
  }

  public setPlanner(planner: Planner) {
    this.planner = planner;
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

        // Temporary connection info until registered
        const tempId = randomUUID();
        this.connections.set(ws, {
          id: tempId,
          deviceId: "unknown",
          name: "Unregistered",
          type: "external",
          status: "pending",
          ip: ip,
          connectedAt: Date.now(),
        });

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
      case "heartbeat":
        // Keep alive
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

    const info = this.connections.get(ws);
    if (!info) return;

    info.deviceId = payload.deviceId;
    info.name = payload.name;

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

  private async handleTextMessage(ws: WebSocket, message: InteractionMessage) {
    const info = this.connections.get(ws);
    if (!info || info.status !== "active") return;

    logger.debug(
      `[InteractionManager] Processing text message from ${info.deviceId}`,
      {
        messageId: message.id,
        timestamp: message.timestamp,
      },
    );

    // Route to Planner/InputAgent
    if (this.planner) {
      try {
        const payload = message.payload as any;
        const content =
          typeof payload.content === "string"
            ? payload.content
            : JSON.stringify(payload.content); // Only stringify content part

        // Hydrate model config strictly from DB
        const clientModelConfig = payload.modelConfig || {};
        let modelConfig: any = {};

        try {
          const allModels = getModels();
          let targetModel;

          if (clientModelConfig.id) {
            targetModel = allModels.find(
              (m: any) => m.id === clientModelConfig.id,
            );
          } else {
            // Fallback to active model in settings
            const settings = getAppSettings();
            if (settings && settings.activeModelId) {
              targetModel = allModels.find(
                (m: any) => m.id === settings.activeModelId,
              );
            }
          }

          if (targetModel) {
            modelConfig = { ...targetModel };
            // Optional: allow client to override non-sensitive params like temperature if needed?
            // For now, strict mode: only DB config.
          } else {
            logger.warn("No valid model configuration found for request");
          }
        } catch (err) {
          logger.error("Failed to hydrate model config from DB", err);
        }

        // Let Planner process the input via Input Agent -> Control -> Output Agent
        const response = await this.planner.processInput(
          info.deviceId,
          content,
          modelConfig,
          (chunk) => {
            // Streaming callback
            this.sendTo(ws, {
              type: "message",
              payload: {
                content: chunk,
                from: "system",
                to: info.deviceId,
                isChunk: true, // Flag to indicate partial content
              },
              timestamp: Date.now(),
            });
          },
        );

        // Send the response back to the device via Interaction Layer (Output Channel)
        this.sendTo(ws, {
          type: "message",
          payload: {
            content: response,
            from: "system",
            to: info.deviceId, // Targeted output
          },
          timestamp: Date.now(),
        });
      } catch (e: any) {
        logger.error(`Error processing message from ${info.deviceId}`, e);
        this.sendTo(ws, {
          type: "message",
          payload: {
            content: `Error: ${e.message}`,
            from: "system",
          },
          timestamp: Date.now(),
        });
      }
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
}

export const interactionManager = new InteractionManager();
