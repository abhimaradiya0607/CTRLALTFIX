export function editorFileName(
  filename: string | null | undefined,
  fileExtension: string | null | undefined,
): string | null {
  const name = typeof filename === "string" ? filename : "";
  const extension = typeof fileExtension === "string" ? fileExtension : "";
  if (name.length === 0) return null;
  if (extension.length === 0) return name;
  return `${name}.${extension}`;
}

export function buildSuggestionRequest(input: {
  fileContent: string;
  cursorLine: number;
  cursorColumn: number;
  suggestionType: string;
  fileName: string | null;
}): {
  fileContent: string;
  cursorLine: number;
  cursorColumn: number;
  suggestionType: string;
  fileName?: string;
} {
  const body: {
    fileContent: string;
    cursorLine: number;
    cursorColumn: number;
    suggestionType: string;
    fileName?: string;
  } = {
    fileContent: input.fileContent,
    cursorLine: input.cursorLine,
    cursorColumn: input.cursorColumn,
    suggestionType: input.suggestionType,
  };

  if (typeof input.fileName === "string" && input.fileName.length > 0) {
    body.fileName = input.fileName;
  }

  return body;
}

/** Client body for an unexpected suggestion failure. The exception stays on the server. */
export function codeSuggestionFailure(): {
  status: 500;
  body: { error: string; message: string };
} {
  return {
    status: 500,
    body: {
      error: "Internal server error",
      message: "Failed to generate code suggestion",
    },
  };
}

/** Server log line. Uses the error type only, never the message. */
export function codeSuggestionFailureLog(error: unknown): string {
  const kind = error instanceof Error ? error.name : "UnknownError";
  return `Code suggestion failed: ${kind}`;
}
