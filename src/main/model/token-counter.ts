
import { encodingForModel, Tiktoken, TiktokenModel } from "js-tiktoken";

// Singleton to reuse encoder
let encoder: Tiktoken | null = null;

// Estimate tokens for a string
// Uses GPT-4 encoding as a safe default for most modern LLMs
export function countTokens(text: string, model: string = "gpt-4"): number {
  try {
    if (!encoder) {
        // Fallback to gpt-4o/gpt-4 compatible encoding
        // js-tiktoken supports cl100k_base which is used by gpt-4, gpt-3.5-turbo, text-embedding-ada-002
        try {
            encoder = encodingForModel(model as TiktokenModel);
        } catch (e) {
            // If model not found (e.g. some obscure model string), fallback to gpt-4
            encoder = encodingForModel("gpt-4");
        }
    }
    return encoder.encode(text).length;
  } catch (e) {
    // Fallback: rough estimation if tiktoken fails
    // English ~4 chars per token, Chinese ~1-2 chars per token.
    // Conservative estimate: length / 2
    return Math.ceil(text.length / 2);
  }
}

export function estimateMessageTokens(message: any): number {
  if (typeof message.content === 'string') {
    return countTokens(message.content);
  } else if (Array.isArray(message.content)) {
    let count = 0;
    for (const part of message.content) {
      if (part.type === 'text') {
        count += countTokens(part.text);
      } else if (part.type === 'image_url') {
        // Rough estimate for images: OpenAI uses fixed tokens for high/low res
        // Low res: 85 tokens. High res: scale dependent.
        // Let's assume a safe upper bound of 1000 tokens per image for now to trigger compression safely
        count += 1000;
      }
    }
    return count;
  }
  return 0;
}
