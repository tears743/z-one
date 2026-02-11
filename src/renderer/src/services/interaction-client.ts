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

    this.ws.onclose = () => {
      console.log("Interaction Layer disconnected");
      this.updateStatus("disconnected");

      if (this.retryCount < this.MAX_RETRIES) {
        this.retryCount++;
        console.log(
          `Reconnecting attempt ${this.retryCount}/${this.MAX_RETRIES}...`,
        );
        setTimeout(() => {
          this.updateStatus("connecting");
          this.connect();
        }, this.RETRY_INTERVAL);
      } else {
        console.log("Max retries reached. Stopping reconnection.");
      }
    };

    this.ws.onerror = (err) => {
      console.error("Interaction Layer error", err);
      // Status update handled in onclose
    };
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

  public sendMessage(content: any, modelConfig?: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Interaction Layer not connected");
    }

    const payload: any = {
      content: content,
      from: this.deviceId,
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

  public onMessage(callback: (msg: any) => void) {
    this.messageCallback = callback;
  }

  private messageCallback: ((msg: any) => void) | null = null;
}

export const interactionClient = new InteractionClient();
