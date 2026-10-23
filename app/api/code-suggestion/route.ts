
import { NextResponse } from "next/server";
import { suggestionOrFallback } from "@/features/ai/lib/ai-provider";
import {
  codeSuggestionFailure,
  codeSuggestionFailureLog,
} from "@/features/ai/lib/suggestion-request";

interface CodeSuggestionRequest {
  fileContent: string;
  cursorLine: number;
  cursorColumn: number;
  suggestionType: string;
  fileName?: string;
}

interface CodeContext {
  language: string;
  framework: string;
  beforeContext: string;
  currentLine: string;
  afterContext: string;
  cursorPosition: { line: number; column: number };
  isInFunction: boolean;
  isInClass: boolean;
  isAfterComment: boolean;
  incompletePatterns: string[];
}

export async function POST(request: Request) {
  try {
    const body: CodeSuggestionRequest = await request.json();

    const { fileContent, cursorLine, cursorColumn, suggestionType, fileName } =
      body;

    // Line and column are 0-based, so 0 is a valid cursor position.
    if (
      typeof fileContent !== "string" ||
      !Number.isFinite(cursorLine) ||
      cursorLine < 0 ||
      !Number.isFinite(cursorColumn) ||
      cursorColumn < 0 ||
      typeof suggestionType !== "string" ||
      suggestionType.length === 0
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // File name is the fourth argument. suggestionType is prompt context, not a filename.
    const context = analyzeCodeContext(
      fileContent,
      cursorLine,
      cursorColumn,
      typeof fileName === "string" ? fileName : undefined,
    );

    //stp-3 Build AI prompt
    const prompt = buildPrompt(context, suggestionType);

    //stp-4 Call ai service
    const suggestion = await generateSuggestion(prompt, request.signal);

    return NextResponse.json(
      {
        suggestion,
        context,
        metadata: {
          language: context.language,
          framework: context.framework,
          position: context.cursorPosition,
          generatedAt: new Date().toISOString(),
        },
      },
      { status: 200 },
    );
  } catch (error) {
    const failure = codeSuggestionFailure();
    console.error(codeSuggestionFailureLog(error));
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

// Analyse code context around cursor position
function analyzeCodeContext(
  content: string,
  line: number,
  column: number,
  fileName?: string,
): CodeContext {
  const lines = content.split("\n");
  const currentLine = lines[line] || "";

  // Get surrounding context (10 lines before and after)
  const contextRadius = 10;
  const startLine = Math.max(0, line - contextRadius);
  const endLine = Math.min(lines.length, line + contextRadius);

  const beforeContext = lines.slice(startLine, line).join("\n");
  const afterContext = lines.slice(line + 1, endLine).join("\n");

  // Detect language and framework
  const language = detectLanguage(content, fileName);
  const framework = detectFramework(content);

  // Analyze code patterns
  const isInFunction = detectInFunction(lines, line);
  const isInClass = detectInClass(lines, line);
  const isAfterComment = detectAfterComment(currentLine, column);
  const incompletePatterns = detectIncompletePatterns(currentLine, column);

  return {
    language,
    framework,
    beforeContext,
    currentLine,
    afterContext,
    cursorPosition: { line, column },
    isInFunction,
    isInClass,
    isAfterComment,
    incompletePatterns,
  };
}

// Helper functions for code analysis
function detectLanguage(content: string, fileName?: string): string {
  if (fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    const extMap: Record<string, string> = {
      ts: "TypeScript",
      tsx: "TypeScript",
      js: "JavaScript",
      jsx: "JavaScript",
      py: "Python",
      java: "Java",
      go: "Go",
      rs: "Rust",
      php: "PHP",
    };

    if (ext && extMap[ext]) return extMap[ext];
  }

  // Content-based detection
  if (content.includes("interface ") || content.includes(": string")) {
    return "TypeScript";
  }

  if (content.includes("def ") || content.includes("import ")) {
    return "Python";
  }

  if (content.includes("func ") || content.includes("package ")) {
    return "Go";
  }

  return "JavaScript";
}

function detectFramework(content: string): string {
  if (content.includes("import React") || content.includes("useState")) {
    return "React";
  }

  if (content.includes("import Vue") || content.includes("<template>")) {
    return "Vue";
  }

  if (content.includes("@angular/") || content.includes("@Component")) {
    return "Angular";
  }

  if (content.includes("next/") || content.includes("getServerSideProps")) {
    return "Next.js";
  }

  return "None";
}

function detectInFunction(lines: string[], currentLine: number): boolean {
  for (let i = currentLine - 1; i >= 0; i--) {
    const line = lines[i];

    if (
      line?.match(/^\s*(function|def|const\s+\w+\s*=|let\s+\w+\s*=)/)
    ) {
      return true;
    }

    if (line?.match(/^\s*}/)) break;
  }

  return false;
}

function detectInClass(lines: string[], currentLine: number): boolean {
  for (let i = currentLine - 1; i >= 0; i--) {
    const line = lines[i];

    if (line?.match(/^\s*(class|interface)\s+/)) {
      return true;
    }
  }

  return false;
}

function detectAfterComment(line: string, column: number): boolean {
  const beforeCursor = line.substring(0, column);
  return /\/\/.*$/.test(beforeCursor) || /#.*$/.test(beforeCursor);
}

function detectIncompletePatterns(line: string, column: number): string[] {
  const beforeCursor = line.substring(0, column);
  const patterns: string[] = [];

  if (/^\s*(if|while|for)\s*\($/.test(beforeCursor.trim())) {
    patterns.push("conditional");
  }

  if (/^\s*(function|def)\s*$/.test(beforeCursor.trim())) {
    patterns.push("function");
  }

  if (/\{\s*$/.test(beforeCursor)) patterns.push("object");
  if (/\[\s*$/.test(beforeCursor)) patterns.push("array");
  if (/=\s*$/.test(beforeCursor)) patterns.push("assignment");
  if (/\.\s*$/.test(beforeCursor)) patterns.push("method-call");

  return patterns;
}

// Build AI prompt based on the context
function buildPrompt(context: CodeContext, suggestionType: string): string {
  return `You are an expert code completion assistant. Generate a ${suggestionType} suggestion.

Language: ${context.language}
Framework: ${context.framework}

Context:
${context.beforeContext}
${context.currentLine.substring(0, context.cursorPosition.column)}|CURSOR|${context.currentLine.substring(context.cursorPosition.column)}
${context.afterContext}

Analysis:
- In Function: ${context.isInFunction}
- In Class: ${context.isInClass}
- After Comment: ${context.isAfterComment}
- Incomplete Patterns: ${context.incompletePatterns.join(", ") || "None"}

Instructions:
1. Provide only the code that should be inserted at the cursor
2. Maintain proper indentation and style
3. Follow ${context.language} best practices
4. Make the suggestion contextually appropriate
5. Keep the completion concise; generate only the next useful code fragment.
6. Do not explain the code or include Markdown fences.
7. Never repeat the surrounding code unless it is needed to complete the current expression.

Generate suggestion:`;
}

async function generateSuggestion(
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  return suggestionOrFallback(prompt, { signal });
}
