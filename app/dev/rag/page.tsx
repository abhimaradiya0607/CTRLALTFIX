import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { DevRagPanel } from "./dev-rag-panel";

/** Temporary development page. Production requests get a 404; there is no public API. */
export default async function DevRagPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  const session = await auth();
  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-xl font-semibold">RAG development check</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page only exists in development. Index and retrieve run through the existing server
          actions, which check that the signed-in account owns the playground.
        </p>
      </div>
      <DevRagPanel />
    </main>
  );
}
