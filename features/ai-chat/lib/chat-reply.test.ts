import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OLLAMA_CHAT_TIMEOUT_MS,
  assistantReplyFromChatApi,
  chatFailureCode,
} from "./chat-reply.ts";

describe("chat failure path", () => {
  it("keeps a real model answer", () => {
    assert.equal(
      assistantReplyFromChatApi(true, { response: "  The entry point is index.js.  " }),
      "The entry point is index.js.",
    );
  });

  it("does not treat an empty or failed payload as an answer", () => {
    assert.equal(
      assistantReplyFromChatApi(true, { response: "   " }),
      "Sorry, I could not answer that. Please try again.",
    );
    assert.equal(
      assistantReplyFromChatApi(false, { error: "Failed to generate AI response" }),
      "Sorry, I could not answer that. Please try again.",
    );
  });

  it("shows access and retrieval failures instead of a normal answer", () => {
    assert.equal(
      assistantReplyFromChatApi(false, { code: "unauthenticated" }),
      "Sign in to ask about this project.",
    );
    assert.equal(
      assistantReplyFromChatApi(false, { code: "not_found" }),
      "This project is not available for your account.",
    );
    assert.equal(
      assistantReplyFromChatApi(false, { code: "retrieval_failed" }),
      "Project search failed, so no answer was generated. Please try again.",
    );
  });

  it("shows a timeout when the route aborted the model call", () => {
    const error = new Error("Request timeout: AI model took too long to respond");
    assert.equal(chatFailureCode(error), "timeout");
    assert.equal(
      assistantReplyFromChatApi(false, { code: "timeout" }),
      "The model took too long to answer. Please try again.",
    );
  });

  it("classifies a model HTTP failure separately from a timeout", () => {
    assert.equal(chatFailureCode(new Error("AI model API error: 500")), "model_error");
    assert.equal(chatFailureCode(new Error("No response from AI model")), "empty");
  });

  it("waits long enough for a local answer that exceeds 15 seconds", () => {
    assert.ok(OLLAMA_CHAT_TIMEOUT_MS >= 60_000);
  });
});
