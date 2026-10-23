"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { indexPlayground, retrievePlaygroundContext } from "@/features/rag/actions";
import type { IndexProjectResult } from "@/features/rag/lib/index-project";
import type { RetrieveResult } from "@/features/rag/lib/retrieve";

type Busy = "index" | "retrieve" | null;

function indexSummary(result: IndexProjectResult): string {
  if (result.status === "error") return result.message;
  return `Indexed ${result.embeddedFiles} files (${result.embeddedChunks} chunks). Skipped ${result.skippedFiles}. Removed ${result.deletedFiles}.`;
}

export function DevRagPanel() {
  const [playgroundId, setPlaygroundId] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [indexMessage, setIndexMessage] = useState<string | null>(null);
  const [indexOk, setIndexOk] = useState(false);
  const [retrieveResult, setRetrieveResult] = useState<RetrieveResult | null>(null);
  const [retrieveFailed, setRetrieveFailed] = useState(false);

  const id = playgroundId.trim();
  const asked = question.trim();

  async function onIndex() {
    setBusy("index");
    setIndexMessage(null);
    try {
      const result = await indexPlayground(id);
      setIndexOk(result.status === "ok");
      setIndexMessage(indexSummary(result));
    } catch {
      setIndexOk(false);
      setIndexMessage("The request failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onRetrieve() {
    setBusy("retrieve");
    setRetrieveResult(null);
    setRetrieveFailed(false);
    try {
      setRetrieveResult(await retrievePlaygroundContext(id, asked));
    } catch {
      setRetrieveFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        Playground ID
        <Input
          value={playgroundId}
          onChange={(event) => setPlaygroundId(event.target.value)}
          placeholder="Saved playground id"
          autoComplete="off"
          disabled={busy !== null}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Question
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What should retrieval look for?"
          disabled={busy !== null}
        />
      </label>
      <div className="flex gap-2">
        <Button type="button" onClick={onIndex} disabled={busy !== null || id.length === 0}>
          {busy === "index" ? "Indexing…" : "Index project"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onRetrieve}
          disabled={busy !== null || id.length === 0 || asked.length === 0}
        >
          {busy === "retrieve" ? "Searching…" : "Retrieve context"}
        </Button>
      </div>

      {indexMessage ? (
        <p className={indexOk ? "text-sm" : "text-sm text-destructive"}>{indexMessage}</p>
      ) : null}

      {retrieveFailed ? <p className="text-sm text-destructive">The request failed.</p> : null}

      {retrieveResult?.status === "error" ? (
        <p className="text-sm text-destructive">{retrieveResult.message}</p>
      ) : null}

      {retrieveResult?.status === "ok" ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">
            {retrieveResult.matches.length === 0
              ? "No matching chunks."
              : `${retrieveResult.matches.length} matching chunks`}
          </h2>
          {retrieveResult.matches.map((match, index) => (
            <article key={`${match.path}:${match.startLine}:${index}`} className="rounded-lg border p-3">
              <p className="text-sm font-medium">{match.path}</p>
              <p className="text-xs text-muted-foreground">
                Lines {match.startLine}–{match.endLine} · score {match.score.toFixed(3)}
              </p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">{match.content}</pre>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
