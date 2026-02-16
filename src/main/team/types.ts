export type TaskStatus =
  | "pending"
  | "in_progress"
  | "task_update"
  | "task_complete"
  | "task_fail";

export interface TaskUpdate {
  status: TaskStatus;
  data: any;
  timestamp: number;
}

export interface TeammateRole {
  name: string;
  persona: string; // detailed personality/role description
  capabilities: string[]; // description of what they can do
  tools: string[]; // specific tool names allowed
}

export interface TeamTask {
  id: string;
  description: string;
  assignedTo: string;
  dependencies: string[];
}

export interface SwarmStage {
  name: string;
  tasks: TeamTask[]; // Tasks in this stage run in parallel
}

export interface TeamPlan {
  isComplex: boolean; // Triage result
  thoughts: string;
  roster: TeammateRole[];
  mission: SwarmStage[]; // Stages are sequential
}
