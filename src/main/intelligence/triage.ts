import { LLMService } from "../model/llm-service";
import { logger } from "../logger";

export interface TriageResult {
  isComplex: boolean;
  mode: "direct" | "single_agent" | "swarm" | "workflow";
  reasoning: string;
  directResponse?: string;
  suggestedTools?: string[];
}

const TRIAGE_SYSTEM_PROMPT = `You are a Triage Officer for an advanced AI Agent System.
Your goal is to analyze the User's Request and classify it into one of four modes:

**Mode 1: "direct" (Simple Direct Response)**
- Casual conversation (Greetings, "How are you?").
- Simple factual questions.
- Requests that don't require external tools.

**Mode 2: "single_agent" (One Agent with Tools)**
- Simple single-tool operations (e.g., one file read/write).
- Tasks achievable by a SINGLE agent with 1-2 tools.
- Suggested tools: "schedule_task" for timed tasks, "read_file"/"write_file" for file ops.

**Mode 3: "swarm" (Multi-Agent Team)**
- Tasks requiring MULTIPLE tools from DIFFERENT domains.
- Multi-step reasoning or planning requiring parallel work.
- Content generation that requires research.
- Complex coding tasks spanning multiple files.

**Mode 4: "workflow" (Long-Running Workflow DAG)**
- Tasks that decompose into ≥3 logically distinct, dependent stages forming a directed graph.
- Tasks requiring structured execution with status tracking, condition branching, or iterations.
- Multi-phase plans where each phase produces output consumed by the next.
- When in doubt between swarm and workflow: if the task has clear sequential stages with data flowing between them, choose workflow.
- Example: "帮我制定一个赚钱计划" → needs research → analysis → decision → execution → report = workflow (5 stages).
- Example: "帮我监控竞品价格" → fetch data → compare → notify = workflow (3+ stages).
- Example: "帮我写一篇文章" → single creative task = NOT workflow.
- The system generates a DAG like: {"nodes":[{"id":"n1","type":"task","label":"调研"},{"id":"n2","type":"condition","label":"判断"}],"edges":[{"source":"n1","target":"n2"}]}

**Output Format (JSON Only):**
\`\`\`json
{
  "isComplex": boolean,
  "mode": "direct" | "single_agent" | "swarm" | "workflow",
  "reasoning": "Brief explanation...",
  "directResponse": "If mode is direct, write the final response here. Otherwise null.",
  "suggestedTools": ["tool_name_1"]
}
\`\`\`
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

Analyze the complexity and classify the mode.
`;

    try {
      const triageSchema = {
        name: "triage_result",
        schema: {
          type: "object",
          properties: {
            isComplex: { type: "boolean" },
            mode: { type: "string", enum: ["direct", "single_agent", "swarm", "workflow"] },
            reasoning: { type: "string" },
            directResponse: { type: ["string", "null"] },
            suggestedTools: {
              type: ["array", "null"],
              items: { type: "string" },
            },
          },
          required: ["isComplex", "mode", "reasoning"],
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
      const result = JSON.parse(cleanJson);

      // Backward compatibility: if no mode, derive from isComplex
      if (!result.mode) {
        result.mode = result.isComplex ? "swarm" : "direct";
      }

      return result;
    } catch (e) {
      logger.error("Triage evaluation failed", e);
      // Fallback to complex to be safe
      return { isComplex: true, mode: "swarm", reasoning: "Error during triage" };
    }
  }
}
