"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { assistantReplyFromChatApi } from "./lib/chat-reply";
import { claimEditApply, editPreview, releaseEditApply, type EditApplyStatus } from "./lib/edit-proposal";
import {
  PROJECT_CONTEXT_LIMITS,
  type ChatTurn,
  type ProjectContext,
} from "./lib/project-context";

interface FileEditProposal {
  fileId: string;
  path: string;
  baseContent: string;
  content: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  id: string;
  contextNote?: string;
  proposal?: FileEditProposal;
  proposalStatus?: EditApplyStatus | "save-failed" | "preview-unrestored" | "pending";
}

interface AIChatSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  playgroundId: string;
  loadContext: () => ProjectContext;
  getEditTarget: () => { fileId: string; path: string; content: string } | null;
  onApplyEdit: (proposal: FileEditProposal) => Promise<Exclude<ChatMessage["proposalStatus"], "pending" | undefined>>;
}

const AIChatSidePanel = ({
  isOpen,
  onClose,
  playgroundId,
  loadContext,
  getEditTarget,
  onApplyEdit,
}: AIChatSidePanelProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const applyLock = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, isLoading]);

  if (!isOpen) return null;

  const sendMessage = async () => {
    const content = input.trim();
    if (!content || isLoading) return;
    if (content.length > PROJECT_CONTEXT_LIMITS.maxMessageChars) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Ask a shorter question. The limit is ${PROJECT_CONTEXT_LIMITS.maxMessageChars} characters.`,
          id: `${Date.now()}-limit`,
        },
      ]);
      return;
    }

    const context = loadContext();
    const history: ChatTurn[] = messages.slice(-PROJECT_CONTEXT_LIMITS.maxHistoryMessages).map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const userMessage: ChatMessage = {
      role: "user",
      content,
      id: `${Date.now()}-user`,
      contextNote: context.note,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          playgroundId,
          history,
          context: context.available
            ? {
                files: context.included,
                omittedForLimit: context.omittedForLimit,
                truncated: context.truncated,
              }
            : null,
        }),
      });
      const data = await response.json();
      const reply = assistantReplyFromChatApi(response.ok, data);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: reply, id: `${Date.now()}-assistant` },
      ]);
    } catch (error) {
      console.error("Error sending chat message:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I could not reach the chat service. Please try again.",
          id: `${Date.now()}-error`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const proposeEdit = async () => {
    const content = input.trim();
    if (!content || isLoading) return;
    if (content.length > PROJECT_CONTEXT_LIMITS.maxMessageChars) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Ask a shorter question. The limit is ${PROJECT_CONTEXT_LIMITS.maxMessageChars} characters.`,
          id: `${Date.now()}-edit-limit`,
        },
      ]);
      return;
    }
    const target = getEditTarget();
    if (!target) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Open a saved project file before requesting an edit.",
          id: `${Date.now()}-no-file`,
        },
      ]);
      return;
    }

    setMessages((prev) => [
      ...prev.map((message) =>
        message.proposalStatus === "pending" ? { ...message, proposalStatus: "rejected" as const } : message,
      ),
      {
        role: "user",
        content,
        id: `${Date.now()}-user`,
      },
    ]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit",
          message: content,
          playgroundId,
          file: { path: target.path, content: target.content },
        }),
      });
      const data = await response.json();
      const proposal = data?.proposal;
      if (
        response.ok &&
        proposal &&
        proposal.path === target.path &&
        proposal.baseContent === target.content &&
        typeof proposal.content === "string"
      ) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Proposed a replacement for ${proposal.path}. Nothing is saved until you apply it.`,
            id: `${Date.now()}-proposal`,
            proposal: {
              fileId: target.fileId,
              path: proposal.path,
              baseContent: proposal.baseContent,
              content: proposal.content,
            },
            proposalStatus: "pending",
          },
        ]);
        return;
      }
      const reply =
        typeof data?.error === "string" ? data.error : assistantReplyFromChatApi(response.ok, data);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: reply, id: `${Date.now()}-edit-error` },
      ]);
    } catch (error) {
      console.error("Error requesting an edit:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I could not reach the chat service. Please try again.",
          id: `${Date.now()}-edit-network`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const resolveProposal = async (messageId: string, action: "apply" | "reject") => {
    if (applyLock.current !== null) return;
    const message = messages.find((item) => item.id === messageId);
    if (!message?.proposal || message.proposalStatus !== "pending") return;
    if (action === "reject") {
      setMessages((prev) =>
        prev.map((item) => (item.id === messageId ? { ...item, proposalStatus: "rejected" } : item)),
      );
      return;
    }
    if (!claimEditApply(applyLock, messageId)) return;
    setApplying(true);
    try {
      const status = await onApplyEdit(message.proposal);
      setMessages((prev) =>
        prev.map((item) => (item.id === messageId ? { ...item, proposalStatus: status } : item)),
      );
    } finally {
      releaseEditApply(applyLock, messageId);
      setApplying(false);
    }
  };

  return (
    <aside className="fixed top-0 right-0 z-40 flex h-full w-[min(100%,24rem)] flex-col border-l bg-background shadow-xl">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-4">
        <div>
          <h2 className="text-sm font-medium">Chat</h2>
          <p className="text-xs text-muted-foreground">Ask about this project</p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close chat" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ask a question about the code in this project.
          </p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {message.role === "user" ? "You" : "Assistant"}
              </p>
              {message.role === "assistant" ? (
                <div className="text-sm leading-6 [&_pre]:mt-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs [&_code]:font-mono">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              )}
              {message.contextNote ? (
                <p className="text-xs text-muted-foreground">{message.contextNote}</p>
              ) : null}
              {message.proposal && message.proposalStatus ? (
                <div className="rounded-md border p-2">
                  <p className="text-xs font-medium">{message.proposal.path}</p>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs">
                    {editPreview(message.proposal.baseContent, message.proposal.content)}
                  </pre>
                  {message.proposalStatus === "pending" ? (
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={applying}
                        onClick={() => void resolveProposal(message.id, "apply")}
                      >
                        Apply
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={applying}
                        onClick={() => void resolveProposal(message.id, "reject")}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {message.proposalStatus === "applied"
                        ? "Applied and saved."
                        : message.proposalStatus === "rejected"
                          ? "Rejected. The file was not changed."
                          : message.proposalStatus === "stale"
                            ? "The file changed. Generate a fresh proposal."
                            : message.proposalStatus === "missing"
                              ? "That file is no longer the open tab."
                              : message.proposalStatus === "preview-unrestored"
                                ? "Saving failed, and the preview could not be restored. Reload the preview before continuing."
                                : "Saving failed. The editor was restored."}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          ))
        )}
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Thinking...
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <form
        className="shrink-0 border-t p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}
      >
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          }}
          placeholder="Ask a question"
          disabled={isLoading}
          className="max-h-32 min-h-20 resize-none overflow-y-auto"
          aria-label="Chat message"
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button type="submit" size="icon" disabled={isLoading || input.trim().length === 0} aria-label="Send">
            <Send className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isLoading || input.trim().length === 0}
            onClick={() => void proposeEdit()}
          >
            Propose edit
          </Button>
        </div>
      </form>
    </aside>
  );
};

export default AIChatSidePanel;
