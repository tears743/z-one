
export interface InteractionMessage {
  type: 'register' | 'register_ack' | 'auth_request' | 'auth_response' | 'message' | 'broadcast' | 'heartbeat' | 'session_request' | 'session_response' | 'session_history_request' | 'session_history_response' | 'device_list' | 'cancel_request' | 'request_cancelled' | 'remote_control' | 'remote_control_response';
  payload: any;
  timestamp: number;
}

export type RemoteControlAction =
  | 'screenshot'
  | 'dom'
  | 'click'
  | 'type'
  | 'scroll'
  | 'eval'
  | 'wait';

export interface RemoteControlPayload {
  requestId: string;
  action: RemoteControlAction;
  /** CSS selector for click/type/scroll */
  selector?: string;
  /** Text to type */
  text?: string;
  /** DOM query mode: skeleton | full | interactive | scoped */
  mode?: 'skeleton' | 'full' | 'interactive' | 'scoped';
  /** Scroll delta in px */
  delta?: number;
  /** JS expression for eval */
  expression?: string;
  /** Duration in ms for wait */
  duration?: number;
  /** File path to save screenshot */
  savePath?: string;
}

export interface RemoteControlResponse {
  requestId: string;
  success: boolean;
  data?: any;
  error?: string;
}

export interface RegisterPayload {
  name: string;
  type: 'internal' | 'external';
  deviceId: string;
  token?: string; // For internal trusted auth
}

export interface AuthRequestPayload {
  requestId: string;
  name: string;
  deviceId: string;
  ip: string;
}

export interface AuthResponsePayload {
  requestId: string;
  approved: boolean;
}

export interface TextMessagePayload {
  content: string;
  from: string; // deviceId
  to?: string; // deviceId, if null/undefined implies broadcast or server processing
}

export interface ConnectionInfo {
  id: string; // internal UUID for the socket
  deviceId: string;
  name: string;
  type: 'internal' | 'external';
  status: 'pending' | 'active' | 'rejected';
  ip: string;
  connectedAt: number;
}
