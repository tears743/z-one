import * as cron from "node-cron";
import { randomUUID } from "crypto";
import { logger } from "../logger";
import {
  getScheduledTasks,
  saveScheduledTask,
  deleteScheduledTask,
  updateScheduledTaskLastRun,
  toggleScheduledTask,
  ScheduledTaskRecord,
} from "../db";
import { addMemory } from "../memory/manager";

// Will be set by init()
let sendTaskMessage: ((deviceId: string, taskDescription: string) => void) | null = null;

/**
 * CronScheduler — manages periodic and one-time scheduled tasks.
 * Tasks are persisted in DB and restored on startup.
 */
class CronScheduler {
  private cronJobs: Map<string, ReturnType<typeof cron.schedule>> = new Map();
  private timeouts: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Initialize: provide a callback to send task messages to devices,
   * then restore all enabled tasks from DB.
   */
  init(messageSender: (deviceId: string, taskDescription: string) => void) {
    sendTaskMessage = messageSender;
    this.restoreFromDB();
    logger.info("[CronScheduler] Initialized");
  }

  /**
   * Restore all enabled tasks from DB
   */
  private restoreFromDB() {
    const tasks = getScheduledTasks();
    let restored = 0;

    for (const task of tasks) {
      if (!task.enabled) continue;

      if (task.type === "cron" && task.cronExpression) {
        this.registerCronJob(task);
        restored++;
      } else if (task.type === "once" && task.runAt) {
        const remaining = task.runAt - Date.now();
        if (remaining > 0) {
          this.registerOnceJob(task, remaining);
          restored++;
        } else {
          // Expired one-time task, remove from DB
          deleteScheduledTask(task.id);
          logger.info(
            `[CronScheduler] Removed expired one-time task: ${task.name}`,
          );
        }
      }
    }

    logger.info(`[CronScheduler] Restored ${restored} task(s) from DB`);
  }

  /**
   * Add a new scheduled task
   */
  addTask(params: {
    name: string;
    taskDescription: string;
    cronExpression?: string;
    delayMinutes?: number;
    deviceId: string;
  }): ScheduledTaskRecord {
    const id = `task-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const now = Date.now();

    let task: ScheduledTaskRecord;

    if (params.cronExpression) {
      // Validate cron expression
      if (!cron.validate(params.cronExpression)) {
        throw new Error(
          `Invalid cron expression: ${params.cronExpression}. Use standard format: "minute hour day month weekday"`,
        );
      }

      task = {
        id,
        name: params.name,
        taskDescription: params.taskDescription,
        cronExpression: params.cronExpression,
        type: "cron",
        deviceId: params.deviceId,
        enabled: true,
        createdAt: now,
      };

      saveScheduledTask(task);
      this.registerCronJob(task);
    } else if (params.delayMinutes && params.delayMinutes > 0) {
      const runAt = now + params.delayMinutes * 60 * 1000;

      task = {
        id,
        name: params.name,
        taskDescription: params.taskDescription,
        runAt,
        type: "once",
        deviceId: params.deviceId,
        enabled: true,
        createdAt: now,
      };

      saveScheduledTask(task);
      this.registerOnceJob(task, params.delayMinutes * 60 * 1000);
    } else {
      throw new Error(
        "Must provide either cronExpression or delayMinutes",
      );
    }

    logger.info(
      `[CronScheduler] Added task: ${task.name} (${task.type}: ${task.cronExpression || task.runAt})`,
    );

    return task;
  }

  /**
   * Remove a task
   */
  removeTask(id: string): boolean {
    // Stop cron job
    const job = this.cronJobs.get(id);
    if (job) {
      job.stop();
      this.cronJobs.delete(id);
    }

    // Clear timeout
    const timeout = this.timeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(id);
    }

    deleteScheduledTask(id);
    logger.info(`[CronScheduler] Removed task: ${id}`);
    return true;
  }

  /**
   * Toggle a task enabled/disabled
   */
  toggle(id: string, enabled: boolean) {
    toggleScheduledTask(id, enabled);

    if (!enabled) {
      // Stop the job
      const job = this.cronJobs.get(id);
      if (job) {
        job.stop();
        this.cronJobs.delete(id);
      }
      const timeout = this.timeouts.get(id);
      if (timeout) {
        clearTimeout(timeout);
        this.timeouts.delete(id);
      }
    } else {
      // Re-register
      const tasks = getScheduledTasks();
      const task = tasks.find((t) => t.id === id);
      if (task) {
        if (task.type === "cron" && task.cronExpression) {
          this.registerCronJob(task);
        } else if (task.type === "once" && task.runAt) {
          const remaining = task.runAt - Date.now();
          if (remaining > 0) {
            this.registerOnceJob(task, remaining);
          }
        }
      }
    }

    logger.info(`[CronScheduler] Task ${id} ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * List all tasks
   */
  listTasks(): ScheduledTaskRecord[] {
    return getScheduledTasks();
  }

  /**
   * Register a cron job
   */
  private registerCronJob(task: ScheduledTaskRecord) {
    if (!task.cronExpression) return;

    // Stop existing job if any
    const existing = this.cronJobs.get(task.id);
    if (existing) existing.stop();

    const job = cron.schedule(task.cronExpression, () => {
      this.executeTask(task);
    });

    this.cronJobs.set(task.id, job);
  }

  /**
   * Register a one-time delayed job
   */
  private registerOnceJob(task: ScheduledTaskRecord, delayMs: number) {
    // Clear existing
    const existing = this.timeouts.get(task.id);
    if (existing) clearTimeout(existing);

    const timeout = setTimeout(() => {
      this.executeTask(task);
      // Clean up after execution
      this.timeouts.delete(task.id);
      deleteScheduledTask(task.id);
      logger.info(
        `[CronScheduler] One-time task completed and removed: ${task.name}`,
      );
    }, delayMs);

    this.timeouts.set(task.id, timeout);
  }

  /**
   * Execute a task — send to device via InteractionManager
   */
  private async executeTask(task: ScheduledTaskRecord) {
    logger.info(
      `[CronScheduler] Executing task: ${task.name} → device: ${task.deviceId}`,
    );

    try {
      // Update last run
      const now = Date.now();
      updateScheduledTaskLastRun(task.id, now);

      // Send task to device via InteractionManager
      if (sendTaskMessage) {
        sendTaskMessage(task.deviceId, task.taskDescription);
      } else {
        logger.error(
          "[CronScheduler] No message sender configured, cannot execute task",
        );
      }
    } catch (err) {
      logger.error(
        `[CronScheduler] Failed to execute task: ${task.name}`,
        err,
      );
    }
  }

  /**
   * Stop all jobs
   */
  stopAll() {
    for (const [, job] of this.cronJobs) {
      job.stop();
    }
    this.cronJobs.clear();

    for (const [, timeout] of this.timeouts) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();

    logger.info("[CronScheduler] All jobs stopped");
  }
}

export const cronScheduler = new CronScheduler();
