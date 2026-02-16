export interface AuthRequest {
  requestId: string;
  name: string;
  deviceId: string;
  ip: string;
}

export interface DeviceInfo {
  id: string;
  name: string;
  status: "pending" | "active" | "rejected" | "blocked";
  type: "internal" | "external";
  deviceId: string;
}

type AuthCallback = (req: AuthRequest) => void;
type StatusCallback = (
  status: "disconnected" | "connecting" | "connected",
) => void;
type DevicesCallback = (devices: DeviceInfo[]) => void;

class InteractionClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private deviceId: string;
  private deviceName: string;
  private status: "disconnected" | "connecting" | "connected" = "disconnected";
  private authCallback: AuthCallback | null = null;
  private statusCallback: StatusCallback | null = null;
  private devicesCallback: DevicesCallback | null = null;
  private retryCount: number = 0;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_INTERVAL = 1000;

  constructor() {
    this.deviceId = "_zone_web_page";
    this.deviceName = "ZoneWeb";
  }

  public async init(
    onAuthRequest: AuthCallback,
    onStatusChange?: StatusCallback,
    onDevicesUpdate?: DevicesCallback,
  ) {
    this.authCallback = onAuthRequest;
    this.statusCallback = onStatusChange || null;
    this.devicesCallback = onDevicesUpdate || null;
    try {
      if (window.electron && window.electron.ipcRenderer) {
        this.updateStatus("connecting");
        this.token = await window.electron.ipcRenderer.invoke(
          "interaction:get-internal-token",
        );
        this.connect();
      }
    } catch (e) {
      console.error("Failed to get interaction token", e);
      this.updateStatus("disconnected");
    }
  }

  private updateStatus(status: "disconnected" | "connecting" | "connected") {
    this.status = status;
    if (this.statusCallback) {
      this.statusCallback(status);
    }
  }

  public reconnect() {
    if (this.status === "connected") return;
    this.retryCount = 0;
    this.updateStatus("connecting");
    this.connect();
  }

  private connect() {
    if (this.status === "connected") return;
    // this.status = 'connecting'; // Already set in init or retry

    this.ws = new WebSocket("ws://localhost:18888");

    this.ws.onopen = () => {
      console.log("Interaction Layer connected");
      this.updateStatus("connected");
      this.retryCount = 0; // Reset retry count on successful connection
      this.sendRegister();
    };

    this.ws.onmessage = (event) => {
      try {
        console.log("Received interaction message:", event.data);
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (e) {
        console.error("Failed to parse interaction message", e);
      }
    };

    this.ws.onclose = (event) => {
      // 1000: Normal closure (e.g. server shutdown or page close)
      // 1006: Abnormal closure (server died, network error)
      console.log(`Interaction Layer disconnected (Code: ${event.code})`);
      this.updateStatus("disconnected");

      // Only retry if it was an abnormal closure or if we are not manually disconnected?
      // Actually, if we are in 'connected' state and get close, we should retry.
      // But if we called disconnect(), we shouldn't.
      // For simplicity, we retry on any close unless we are blocked or manually stopped.

      // Prevent infinite loops if server is permanently down
      if (this.retryCount < this.MAX_RETRIES) {
        this.retryCount++;
        console.log(
          `Reconnecting attempt ${this.retryCount}/${this.MAX_RETRIES}...`,
        );
        setTimeout(() => {
          this.updateStatus("connecting");
          this.connect();
        }, this.RETRY_INTERVAL * this.retryCount); // Exponential backoff-ish
      } else {
        console.log("Max retries reached. Stopping reconnection.");
        // We stay disconnected. User can manually reconnect via UI button.
      }
    };

    this.ws.onerror = (err) => {
      console.error("Interaction Layer error", err);
      // Status update handled in onclose
    };
  }

  public disconnect() {
    this.retryCount = this.MAX_RETRIES; // Prevent auto-reconnect
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.updateStatus("disconnected");
  }

  private sendRegister() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        type: "register",
        payload: {
          name: this.deviceName,
          type: "internal",
          deviceId: this.deviceId,
          token: this.token,
        },
        timestamp: Date.now(),
      }),
    );
  }

  private handleMessage(message: any) {
    switch (message.type) {
      case "auth_request":
        if (this.authCallback) {
          this.authCallback(message.payload);
        }
        break;
      case "register_ack":
        console.log("Interaction Layer Registered:", message.payload);
        break;
      case "heartbeat":
        // Optional: Send pong back or just log
        // console.log('Heartbeat received:', message.payload);
        break;
      case "device_list":
        if (this.devicesCallback) {
          this.devicesCallback(message.payload);
        }
        break;
      case "message":
        if (this.messageCallback) {
          this.messageCallback(message);
        }
        break;
      case "session_response":
        if (this.sessionCallback) {
          this.sessionCallback(message.payload);
        }
        break;
      case "session_history_response":
        if (this.historyCallback) {
          this.historyCallback(message.payload);
        }
        break;
      // Handle other messages
    }
  }

  public approveRequest(requestId: string, approved: boolean) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        type: "auth_response",
        payload: {
          requestId,
          approved,
        },
        timestamp: Date.now(),
      }),
    );
  }

  public sendMessage(content: any, sessionId?: string, modelConfig?: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Interaction Layer not connected");
    }

    const payload: any = {
      content: content,
      from: this.deviceId,
      sessionId: sessionId, // Add session ID
    };

    if (modelConfig) {
      payload.modelConfig = modelConfig;
    }

    this.ws.send(
      JSON.stringify({
        type: "message",
        payload: payload,
        timestamp: Date.now(),
      }),
    );
  }

  private sessionCallback: ((payload: any) => void) | null = null;
  private historyCallback: ((payload: any) => void) | null = null;

  public requestSession(requestId?: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // If not connected, we can't request session from server.
      // Fallback or Queue?
      // For now, let's assume UI handles connection check.
      console.warn("Cannot request session: Not connected");
      return;
    }

    this.ws.send(
      JSON.stringify({
        type: "session_request",
        payload: {
          requestId: requestId || crypto.randomUUID(),
          deviceId: this.deviceId,
        },
        timestamp: Date.now(),
      }),
    );
  }

  public requestSessionHistory(sessionId: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("Cannot request history: Not connected");
      return;
    }

    this.ws.send(
      JSON.stringify({
        type: "session_history_request",
        payload: {
          sessionId,
          deviceId: this.deviceId,
        },
        timestamp: Date.now(),
      }),
    );
  }

  public onSessionResponse(callback: (payload: any) => void) {
    this.sessionCallback = callback;
  }

  public onSessionHistoryResponse(callback: (payload: any) => void) {
    this.historyCallback = callback;
  }

  public onMessage(callback: (msg: any) => void) {
    this.messageCallback = callback;
  }

  private messageCallback: ((msg: any) => void) | null = null;
}

export const interactionClient = new InteractionClient();
