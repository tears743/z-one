import { LLMService } from "../model/llm-service";
import { logger } from "../logger";

export interface TriageResult {
  isComplex: boolean;
  reasoning: string;
  directResponse?: string; // If simple, provide the response here
}

const TRIAGE_SYSTEM_PROMPT = `You are a Triage Officer for an advanced AI Agent System.
Your goal is to analyze the User's Request and determine if it requires a "Swarm" (Multi-Agent Team) to solve, or if it's a simple query that can be answered directly.

**Criteria for "Simple" (Direct Response):**
- Casual conversation (Greetings, "How are you?").
- Simple factual questions (General knowledge, "What is the capital of France?").
- Requests that don't require external tools, file operations, or complex reasoning.
- Clarifications of previous context.

**Criteria for "Complex" (Swarm Mode):**
- Tasks requiring File I/O (Read/Write code, analyze files).
- Tasks requiring Web Search or Browser Automation.
- Multi-step reasoning or planning.
- Content generation that requires research (e.g., "Write a report about Gold trends").
- Coding tasks.

**Output Format (JSON Only):**
\`\`\`json
{
  "isComplex": boolean,
  "reasoning": "Brief explanation...",
  "directResponse": "If isComplex is false, write the final response to the user here. If true, leave null."
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

Analyze the complexity.
`;

    try {
      const response = await this.llmService.generateCompletion(
        [
          { role: "system", content: TRIAGE_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        modelConfig,
        true, // jsonMode
      );

      if (!response) {
        throw new Error("Triage failed to respond");
      }

      const cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
      return JSON.parse(cleanJson);
    } catch (e) {
      logger.error("Triage evaluation failed", e);
      // Fallback to complex to be safe
      return { isComplex: true, reasoning: "Error during triage" };
    }
  }
}
