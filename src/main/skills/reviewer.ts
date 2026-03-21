/**
 * SkillReviewer — performs LLM-based security review of skill content
 * before installation. Checks for:
 * - Malicious commands (rm -rf, curl to suspicious URLs, etc.)
 * - Privacy risks (credential harvesting, data exfiltration)
 * - Dangerous operations (system modification, package installation)
 */

import { SkillReviewResult } from "./types";
import { logger } from "../logger";

const REVIEW_SYSTEM_PROMPT = `You are a cybersecurity expert reviewing a skill file (SKILL.md) for an AI agent system.

Skills are instruction files that teach AI agents how to use CLI tools. They are NOT executable code, but contain instructions that an AI will follow, including commands to run.

Your job is to identify security risks in the skill content. Look for:

1. **Data Exfiltration**: Commands that send local data to external servers (curl POST with user data, etc.)
2. **Credential Harvesting**: Instructions to collect API keys, passwords, tokens and transmit them
3. **Destructive Commands**: rm -rf /, format, dd, etc. that could damage the system
4. **Backdoor Installation**: Instructions to download and execute unknown binaries
5. **Privilege Escalation**: sudo usage, permission changes that seem unnecessary
6. **Obfuscation**: Base64 encoded commands, eval of remote content, pipe from URL to shell
7. **Unnecessary Permissions**: Requesting env vars or binaries unrelated to the skill's purpose

Respond with a JSON object:
{
  "safe": boolean,       // true if the skill is safe to install
  "risks": string[],     // list of specific risks found (empty if safe)
  "summary": string      // brief assessment
}

Be strict but fair. A skill that uses curl to call APIs is fine if it's relevant to the skill's purpose. A skill that collects and transmits user data is NOT fine.`;

/**
 * Review a skill's content for security risks using LLM.
 *
 * @param skillContent - Full content of SKILL.md
 * @param skillName - Name of the skill being reviewed
 * @param llmService - LLM service instance for generating review
 * @param modelConfig - Model configuration to use
 * @returns SkillReviewResult with safety assessment
 */
export async function reviewSkill(
  skillContent: string,
  skillName: string,
  llmService: any,
  modelConfig: any,
): Promise<SkillReviewResult> {
  logger.info(`[SkillReviewer] Reviewing skill: ${skillName}`);

  const reviewSchema = {
    name: "skill_review",
    schema: {
      type: "object",
      properties: {
        safe: { type: "boolean", description: "Whether the skill is safe to install" },
        risks: { type: "array", items: { type: "string" }, description: "List of security risks found" },
        summary: { type: "string", description: "Brief security assessment" },
      },
      required: ["safe", "risks", "summary"],
      additionalProperties: false,
    },
  };

  try {
    const response = await llmService.generateCompletion(
      [
        { role: "system", content: REVIEW_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Please review this skill file for security risks:\n\n**Skill Name**: ${skillName}\n\n**Content**:\n\`\`\`\n${skillContent}\n\`\`\``,
        },
      ],
      { ...modelConfig, stream: false },
      true, // jsonMode
      undefined,
      undefined,
      undefined,
      reviewSchema,
    );

    if (!response) {
      return { safe: false, risks: ["LLM returned empty response"], summary: "Review failed" };
    }

    const cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
    const result = JSON.parse(cleanJson);

    return {
      safe: !!result.safe,
      risks: Array.isArray(result.risks) ? result.risks : [],
      summary: result.summary || "No summary",
    };
  } catch (e: any) {
    logger.error(`[SkillReviewer] Review failed for "${skillName}": ${e.message}`);
    return {
      safe: false,
      risks: [`Review error: ${e.message}`],
      summary: "Security review failed — treating as unsafe",
    };
  }
}
