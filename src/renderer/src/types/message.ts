export interface LogMessage {
  id: string;
  timestamp: number;
  role: "user" | "assistant" | "system";
  sender?: string;
  content: string;
  details?: any;
}

export interface SwarmTaskState {
  id: string;
  assignedTo: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  output?: string;
  logs: string[];
  tools?: string[];
}

export interface SwarmStage {
  id: string;
  name: string;
  tasks: SwarmTaskState[];
}

export interface SwarmState {
  stages: SwarmStage[];
}
