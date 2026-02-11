
import { randomUUID } from 'crypto';
import { McpHub } from './mcp-hub';
import { Task, Plan, TaskStatus } from './types';
import { logger } from '../logger';

export class TaskManager {
  private currentPlan: Plan | null = null;
  private mcpHub: McpHub;
  private isExecuting: boolean = false;

  constructor(mcpHub: McpHub) {
    this.mcpHub = mcpHub;
  }

  public createPlan(goal: string): Plan {
    this.currentPlan = {
      id: randomUUID(),
      goal,
      tasks: [],
      status: 'planning',
      createdAt: Date.now()
    };
    return this.currentPlan;
  }

  public addTask(description: string, toolName?: string, toolArgs?: Record<string, any>, maxRetries: number = 3): Task {
    if (!this.currentPlan) {
      throw new Error("No active plan");
    }

    const task: Task = {
      id: randomUUID(),
      description,
      toolName,
      toolArgs,
      status: 'pending',
      retryCount: 0,
      maxRetries
    };

    this.currentPlan.tasks.push(task);
    return task;
  }

  public async executePlan(): Promise<any[]> {
    if (!this.currentPlan) return [];
    if (this.isExecuting) return [];

    this.isExecuting = true;
    this.currentPlan.status = 'executing';
    logger.info(`Starting execution of plan: ${this.currentPlan.goal}`);
    
    const results: any[] = [];

    try {
      // Simple sequential execution for now
      // TODO: Implement DAG execution based on dependencies
      for (const task of this.currentPlan.tasks) {
        if (task.status === 'pending') {
          await this.executeTask(task);
          if (task.status === 'failed') {
            this.currentPlan.status = 'failed';
            logger.error(`Plan failed at task: ${task.description}`);
            break;
          }
          if (task.result) {
            results.push(task.result);
          }
        }
      }

      if (this.currentPlan.status === 'executing') {
        this.currentPlan.status = 'completed';
        logger.info(`Plan completed successfully: ${this.currentPlan.goal}`);
      }
    } catch (e) {
      this.currentPlan.status = 'failed';
      logger.error(`Plan execution error: ${e}`);
    } finally {
      this.isExecuting = false;
    }
    
    return results;
  }

  private async executeTask(task: Task): Promise<void> {
    task.status = 'running';
    logger.info(`Executing task: ${task.description}`);

    try {
      if (task.toolName) {
        // Expectation Loop: Execute -> Validate -> Retry
        await this.expectationLoop(task);
      } else {
        // Just a logical step or manual intervention
        task.status = 'completed';
      }
    } catch (e: any) {
      task.status = 'failed';
      task.error = e.message;
      logger.error(`Task failed: ${task.description}`, e);
    }
  }

  private async expectationLoop(task: Task): Promise<void> {
    while (task.retryCount <= task.maxRetries) {
      try {
        // 1. Execute
        const result = await this.mcpHub.callTool(
            "unknown", // Hub will find the server
            task.toolName!, 
            task.toolArgs
        );

        // 2. Validate (Simplified: if no exception, assume success)
        // TODO: Add explicit validation logic/tool calls here
        
        task.result = result;
        task.status = 'completed';
        logger.info(`Task completed: ${task.description}`);
        return;

      } catch (e: any) {
        task.retryCount++;
        logger.warn(`Task execution failed (Attempt ${task.retryCount}/${task.maxRetries}): ${e.message}`);
        
        if (task.retryCount > task.maxRetries) {
          throw e; // Exhausted retries
        }
        
        // Wait before retry (exponential backoff?)
        await new Promise(resolve => setTimeout(resolve, 1000 * task.retryCount));
      }
    }
  }
}
