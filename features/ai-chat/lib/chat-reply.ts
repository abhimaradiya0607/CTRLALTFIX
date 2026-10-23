/** Local 7B answers for a small project were measured at about 25s. */
export const OLLAMA_CHAT_TIMEOUT_MS = 90_000;

export type ChatFailureCode = "timeout" | "model_error" | "empty";

export function chatFailureCode(error: unknown): ChatFailureCode {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Request timeout:")) return "timeout";
  if (message === "No response from AI model" || message === "Empty response from AI model") {
    return "empty";
  }
  return "model_error";
}

export function assistantReplyFromChatApi(
  ok: boolean,
  data: { response?: unknown; code?: unknown } | null,
): string {
  if (ok && data && typeof data.response === "string" && data.response.trim()) {
    return data.response.trim();
  }
  if (data?.code === "timeout") {
    return "The model took too long to answer. Please try again.";
  }
  if (data?.code === "unauthenticated") {
    return "Sign in to ask about this project.";
  }
  if (data?.code === "not_found") {
    return "This project is not available for your account.";
  }
  if (data?.code === "retrieval_failed") {
    return "Project search failed, so no answer was generated. Please try again.";
  }
  return "Sorry, I could not answer that. Please try again.";
}
