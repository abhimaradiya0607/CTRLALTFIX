import * as groq from "@/features/ai/lib/groq-provider";
import * as gemini from "@/features/ai/lib/gemini-provider";

const provider = process.env.AI_PROVIDER?.trim().toLowerCase();

const selected = provider === "groq" ? groq : gemini;

export const generateText = selected.generateText;
export const generateJson = selected.generateJson;
export const enhancedPromptOrOriginal = selected.enhancedPromptOrOriginal;
export const suggestionOrFallback = selected.suggestionOrFallback;
