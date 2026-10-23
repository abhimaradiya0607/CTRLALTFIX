import { type NextRequest, NextResponse } from "next/server";
import {
  chatGroundingErrorMessage,
  groundingFromRetrieval,
  parsePlaygroundId,
} from "@/features/ai-chat/lib/chat-grounding";
import { chatFailureCode } from "@/features/ai-chat/lib/chat-reply";
import {
  enhancedPromptOrOriginal,
  generateJson,
  generateText,
} from "@/features/ai/lib/ai-provider";
import {
  buildChatPrompt,
  contextFromRequest,
  normalizeChatHistory,
  PROJECT_CONTEXT_LIMITS,
} from "@/features/ai-chat/lib/project-context";
import { retrievePlaygroundContext } from "@/features/rag/actions";
import { db } from "@/lib/db";
import {
  applyEditPatch,
  asProjectTree,
  assessEditTarget,
  buildEditPrompt,
  isEditChatAction,
  parseEditPatch,
  type EditPatchProblem,
} from "@/features/ai-chat/lib/edit-proposal";

interface EnhancePromptRequest {
  prompt: string;
  context?: {
    fileName?: string;
    codeContent?: string;
    language?: string;
  };
}

async function generateEditReplacement(prompt: string, signal?: AbortSignal): Promise<string> {
  return generateJson({
    prompt,
    temperature: 0.2,
    maxOutputTokens: 4096,
    signal,
  });
}

async function generateAIResponse(prompt: string, signal?: AbortSignal) {
  return generateText({
    prompt,
    temperature: 0.7,
    topP: 0.9,
    maxOutputTokens: 1000,
    signal,
  });
}

async function enhancePrompt(request: EnhancePromptRequest, signal?: AbortSignal) {
  return enhancedPromptOrOriginal(request, { signal });
}

const EDIT_TARGET_MESSAGES = {
  invalid: "Choose one saved project file to edit.",
  excluded: "That file cannot be edited.",
  missing: "That file is not in this saved project. Save it, then ask again.",
  "too-large": "That file is too large to replace in one proposal.",
} as const;

const EDIT_PATCH_MESSAGES: Record<EditPatchProblem, string> = {
  malformed: "The model did not return a usable patch. Ask for a narrower change.",
  oversized: "That edit is too large. Ask for a narrower change.",
  "missing-anchor": "The edit did not match this file. Ask for a narrower change.",
  ambiguous: "That edit matches more than one place. Ask for a narrower change.",
  destructive: "That edit would remove too much of the file. Ask for a narrower change.",
};

/** Edit path: one owned file, one JSON replacement. The model never writes storage. */
async function proposeFileEdit(
  body: {
    message?: unknown;
    playgroundId?: unknown;
    file?: { path?: unknown; content?: unknown };
  },
  signal?: AbortSignal,
) {
  if (typeof body.message !== "string" || body.message.trim().length === 0) {
    return NextResponse.json({ error: "Message is required and must be a string" }, { status: 400 });
  }
  if (body.message.length > PROJECT_CONTEXT_LIMITS.maxMessageChars) {
    return NextResponse.json({ error: "Message is too long" }, { status: 400 });
  }

  const playgroundId = parsePlaygroundId(body.playgroundId);
  if (!playgroundId) {
    return NextResponse.json(
      { error: chatGroundingErrorMessage("invalid_playground"), code: "invalid_playground" },
      { status: 400 },
    );
  }

  const grounding = groundingFromRetrieval(
    await retrievePlaygroundContext(playgroundId, body.message.trim()),
  );
  if (grounding.kind !== "answer") {
    return NextResponse.json(
      { error: chatGroundingErrorMessage(grounding.code), code: grounding.code },
      { status: grounding.status },
    );
  }

  const saved = await db.templateFile.findUnique({
    where: { playgroundId },
    select: { content: true },
  });
  const tree = asProjectTree(saved?.content);
  if (!tree) {
    return NextResponse.json(
      { error: EDIT_TARGET_MESSAGES.missing, code: "edit_target" },
      { status: 400 },
    );
  }

  const path = body.file?.path;
  const baseContent = body.file?.content;
  const target = assessEditTarget({ path, baseContent, tree });
  if (target !== "ok") {
    return NextResponse.json(
      { error: EDIT_TARGET_MESSAGES[target], code: "edit_target" },
      { status: 400 },
    );
  }

  const prompt = buildEditPrompt({
    path: (path as string).trim(),
    baseContent: baseContent as string,
    instruction: body.message.trim(),
  });
  const raw = await generateEditReplacement(prompt, signal);
  const patch = parseEditPatch(raw);
  if (typeof patch === "string") {
    return NextResponse.json(
      { error: EDIT_PATCH_MESSAGES[patch], code: "edit_invalid" },
      { status: 502 },
    );
  }
  const applied = applyEditPatch(baseContent as string, patch);
  if (typeof applied === "string") {
    return NextResponse.json(
      { error: EDIT_PATCH_MESSAGES[applied], code: "edit_invalid" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    proposal: {
      path: (path as string).trim(),
      baseContent,
      content: applied.content,
    },
  });
}

export async function POST(req: NextRequest) {
  let promptChars = 0;
  try {
    const body = await req.json();

    if (body.action === "enhance") {
      const enhancedPrompt = await enhancePrompt(body as EnhancePromptRequest, req.signal);
      return NextResponse.json({ enhancedPrompt });
    }

    if (isEditChatAction(body.action)) {
      return proposeFileEdit(body, req.signal);
    }

    const { message } = body;
    if (typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json(
        { error: "Message is required and must be a string" },
        { status: 400 },
      );
    }
    if (message.length > PROJECT_CONTEXT_LIMITS.maxMessageChars) {
      return NextResponse.json({ error: "Message is too long" }, { status: 400 });
    }

    const projectContext = contextFromRequest(body.context);
    if (projectContext === "invalid") {
      return NextResponse.json({ error: "Invalid project context" }, { status: 400 });
    }

    const playgroundId = parsePlaygroundId(body.playgroundId);
    if (!playgroundId) {
      return NextResponse.json(
        { error: chatGroundingErrorMessage("invalid_playground"), code: "invalid_playground" },
        { status: 400 },
      );
    }

    // Retrieval checks the session and project ownership. A client id is not proof of either.
    const grounding = groundingFromRetrieval(await retrievePlaygroundContext(playgroundId, message.trim()));
    if (grounding.kind !== "answer") {
      return NextResponse.json(
        { error: chatGroundingErrorMessage(grounding.code), code: grounding.code },
        { status: grounding.status },
      );
    }

    const prompt = buildChatPrompt({
      message: message.trim(),
      history: normalizeChatHistory(body.history),
      context: projectContext,
      retrieved: grounding.snippets,
    });
    promptChars = prompt.length;
    const aiResponse = await generateAIResponse(prompt, req.signal);

    if (!aiResponse) {
      throw new Error("Empty response from AI model");
    }

    return NextResponse.json({
      response: aiResponse,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    console.error("Error in AI chat route:", errorMessage, "promptChars:", promptChars);
    return NextResponse.json(
      {
        error: "Failed to generate AI response",
        code: chatFailureCode(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "AI Chat API is running",
    timestamp: new Date().toISOString(),
    info: "Use POST method to send chat messages or enhance prompts",
  });
}
