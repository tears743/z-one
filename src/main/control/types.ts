
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'retrying';

export interface Task {
  id: string;
  description: string;
  toolName?: string;
  toolArgs?: Record<string, any>;
  status: TaskStatus;
  result?: any;
  error?: string;
  retryCount: number;
  maxRetries: number;
  dependencies?: string[]; // IDs of tasks that must complete first
  parentId?: string; // For subtasks
}

export interface Plan {
  id: string;
  goal: string;
  tasks: Task[];
  status: 'planning' | 'executing' | 'completed' | 'failed';
  createdAt: number;
}
