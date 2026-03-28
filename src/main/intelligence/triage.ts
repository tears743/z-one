import { LLMService } from "../model/llm-service";
import { logger } from "../logger";

export interface TriageResult {
  isComplex: boolean;
  routeTo: "direct" | "team" | "create_workflow";
  reasoning: string;
  directResponse?: string; // If routeTo is "direct", provide the response here
}

const TRIAGE_SYSTEM_PROMPT = `You are a Triage Officer for an advanced AI Agent System.
Your goal is to analyze the User's Request and determine how to route it.

There are THREE possible routes:

## Route 1: "direct" (Simple Direct Response)
- Casual conversation (Greetings, "How are you?").
- Simple factual questions (General knowledge).
- Requests that don't require external tools, file operations, or complex reasoning.

## Route 2: "create_workflow" (Create a Workflow/Pipeline)
Use this route when the user wants to CREATE a Workflow in the system.

**What is a Workflow?**
A Workflow is a persistent, reusable DAG (Directed Acyclic Graph) execution plan with:
- Multiple nodes, each powered by its own AI Agent with dedicated tools and persona
- Branching (gateway/parallel) nodes for concurrent execution
- Sequential and conditional flows for complex logic
- Designed for COMPLEX, LONG-RUNNING, or RECURRING tasks that are beyond a single-shot team execution

**When to use create_workflow:**
- The task is complex enough to need a structured multi-step pipeline (not just a one-off)
- The user explicitly or implicitly wants a reusable/persistent process
- The task involves long-running operations, scheduled/recurring work, or multi-stage pipelines
- The user mentions "workflow", "工作流", "pipeline", "自动化流程", "自动化任务", or describes wanting to set up a process

**Examples:**
- "帮我创建一个每天收集新闻的工作流" → create_workflow
- "design a workflow to monitor prices" → create_workflow
- "规划一个workflow来完成这个长期任务" → create_workflow
- "我需要一个自动化流程来每天发送报告" → create_workflow
- "这是个超长的任务，你应该需要规划workflow来完成" → create_workflow
- "帮我搭建一个定时爬取数据的工作流" → create_workflow

## Route 3: "team" (Complex Task — Execute Now)
Use this route for tasks that should be EXECUTED IMMEDIATELY (not saved as a reusable workflow).
- One-time tasks requiring tools, file operations, web browsing.
- Coding, research, analysis that the user wants done RIGHT NOW.
- Multi-step reasoning that isn't meant to be a recurring pipeline.

Examples:
- "帮我写个文件" → team
- "搜索一下最新的AI新闻" → team
- "帮我分析这段代码" → team

**Decision Priority**: If the user mentions "workflow", "工作流", "自动化流程", or similar terms indicating they want to SET UP a process, prefer "create_workflow" over "team".

**Output Format (JSON Only):**
\`\`\`json
{
  "isComplex": boolean,
  "routeTo": "direct" | "team" | "create_workflow",
  "reasoning": "Brief explanation of why this route was chosen...",
  "directResponse": "If routeTo is 'direct', write the final response here. Otherwise null."
}
\`\`\`

IMPORTANT: "isComplex" should be false ONLY when routeTo is "direct". For both "team" and "create_workflow", set isComplex to true.
`;

export class TriageAgent {
  private llmService: LLMService;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
  }

  public async evaluate(
    userRequest: string,
    context: string,
    modelConfig: any,
  ): Promise<TriageResult> {
    const prompt = `
User Request: ${userRequest}

Context Summary:
${context}

Analyze the intent and determine the route. Remember: if the user mentions "workflow" or "工作流" or wants to set up an automated pipeline, route to "create_workflow".
`;

    try {
      const triageSchema = {
        name: "triage_result",
        schema: {
          type: "object",
          properties: {
            isComplex: { type: "boolean" },
            routeTo: { type: "string", enum: ["direct", "team", "create_workflow"] },
            reasoning: { type: "string" },
            directResponse: { type: ["string", "null"] },
          },
          required: ["isComplex", "routeTo", "reasoning"],
          additionalProperties: false,
        },
      };

      const response = await this.llmService.generateCompletion(
        [
          { role: "system", content: TRIAGE_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        modelConfig,
        true, // jsonMode
        undefined, // onChunk
        undefined, // tools
        undefined, // signal
        triageSchema,
      );

      if (!response) {
        throw new Error("Triage failed to respond");
      }

      const cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
      const parsed = JSON.parse(cleanJson);

      logger.info(`[Triage] Raw LLM response parsed: ${JSON.stringify(parsed)}`);

      // Ensure routeTo has a valid value; fall back based on isComplex
      if (!parsed.routeTo || !["direct", "team", "create_workflow"].includes(parsed.routeTo)) {
        logger.warn(`[Triage] Invalid or missing routeTo: "${parsed.routeTo}", falling back based on isComplex=${parsed.isComplex}`);
        parsed.routeTo = parsed.isComplex ? "team" : "direct";
      }

      return parsed;
    } catch (e) {
      logger.error("Triage evaluation failed", e);
      // Fallback to team to be safe
      return { isComplex: true, routeTo: "team", reasoning: "Error during triage" };
    }
  }
}
