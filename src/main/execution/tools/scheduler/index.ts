import { NativeTool, ToolContext } from "../../tool-registry";
import { cronScheduler } from "../../../scheduler";
import { ScheduledTaskRecord } from "../../../db";

export const ScheduleTaskTool: NativeTool = {
  name: "schedule_task",
  description: `Create a scheduled task that runs periodically (cron) or once after a delay.
For cron tasks, use standard cron expressions: "minute hour day month weekday".
Examples: "0 9 * * *" (daily 9am), "0 */2 * * *" (every 2 hours), "30 14 * * 1-5" (weekdays 2:30pm).
For one-time tasks, specify delay_minutes (e.g., 30 for "remind me in 30 minutes").
The task result will be sent to the device where this task was created.`,
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Short name for the task, e.g. '每日科技新闻' or '30分钟后提醒开会'",
      },
      task: {
        type: "string",
        description:
          "The instruction for the AI to execute when triggered. Be specific and self-contained.",
      },
      cron: {
        type: "string",
        description:
          'Cron expression for periodic tasks. Format: "minute hour day month weekday". Leave empty for one-time tasks.',
      },
      delay_minutes: {
        type: "number",
        description:
          "Delay in minutes for one-time tasks. Leave empty for cron tasks.",
      },
    },
    required: ["name", "task"],
  },
  execute: async (args: any, context?: ToolContext) => {
    const deviceId = context?.deviceId || "_zone_web_page";

    if (!args.cron && !args.delay_minutes) {
      return {
        error:
          "Must provide either 'cron' (for periodic) or 'delay_minutes' (for one-time) task.",
      };
    }

    try {
      const task = cronScheduler.addTask({
        name: args.name,
        taskDescription: args.task,
        cronExpression: args.cron,
        delayMinutes: args.delay_minutes,
        deviceId,
      });

      return {
        success: true,
        task: {
          id: task.id,
          name: task.name,
          type: task.type,
          cron: task.cronExpression,
          runAt: task.runAt
            ? new Date(task.runAt).toLocaleString()
            : undefined,
          deviceId: task.deviceId,
        },
        message:
          task.type === "cron"
            ? `定时任务已创建：${task.name}，周期：${task.cronExpression}`
            : `延时任务已创建：${task.name}，将在 ${args.delay_minutes} 分钟后执行`,
      };
    } catch (err: any) {
      return { error: err.message };
    }
  },
};

export const ListScheduledTasksTool: NativeTool = {
  name: "list_scheduled_tasks",
  description:
    "List all scheduled tasks (both periodic cron tasks and one-time delayed tasks). Shows task name, schedule, status, and last run time.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  execute: async () => {
    const tasks = cronScheduler.listTasks();

    if (tasks.length === 0) {
      return { tasks: [], message: "暂无定时任务。" };
    }

    return {
      tasks: tasks.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        cron: t.cronExpression,
        runAt: t.runAt ? new Date(t.runAt).toLocaleString() : undefined,
        enabled: t.enabled,
        lastRun: t.lastRun
          ? new Date(t.lastRun).toLocaleString()
          : "从未运行",
        deviceId: t.deviceId,
        taskDescription: t.taskDescription,
      })),
      count: tasks.length,
    };
  },
};

export const CancelScheduledTaskTool: NativeTool = {
  name: "cancel_scheduled_task",
  description:
    "Cancel and remove a scheduled task by its ID. Use list_scheduled_tasks first to get task IDs.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "The ID of the task to cancel.",
      },
    },
    required: ["task_id"],
  },
  execute: async (args: any) => {
    try {
      const removed = cronScheduler.removeTask(args.task_id);
      if (removed) {
        return {
          success: true,
          message: `定时任务 ${args.task_id} 已取消。`,
        };
      }
      return { error: `未找到任务: ${args.task_id}` };
    } catch (err: any) {
      return { error: err.message };
    }
  },
};

export const SchedulerTools = [
  ScheduleTaskTool,
  ListScheduledTasksTool,
  CancelScheduledTaskTool,
];
