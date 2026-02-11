
export interface InteractionMessage {
  type: 'register' | 'auth_request' | 'auth_response' | 'message' | 'broadcast' | 'heartbeat';
  payload: any;
  timestamp: number;
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
