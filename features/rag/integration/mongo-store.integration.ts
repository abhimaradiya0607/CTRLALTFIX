/**
 * Opt-in integration test for the real Prisma + MongoDB store. It is NOT part of the unit suite.
 *
 * It needs a THROWAWAY MongoDB replica set (Prisma requires one) with this repo's schema pushed:
 *   mongod --replSet rs0 --port 27099 --bind_ip 127.0.0.1 --dbpath /tmp/rag-it-mongo
 *   (initiate the replica set once, then)
 *   DATABASE_URL="mongodb://127.0.0.1:27099/rag_it?replicaSet=rs0&directConnection=true" npx prisma db push
 *   RAG_TEST_DATABASE_URL="<same url>" node --experimental-transform-types --test features/rag/integration/mongo-store.integration.ts
 *
 * It refuses to run against anything that is not localhost, and it deletes only its own rows.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "../../../lib/generated/prisma/client.ts";
import type { TemplateFolder } from "../../playground/types/index.ts";
import type { EmbeddingProvider } from "../lib/embed-chunks.ts";
import { indexProject, type IndexProjectDeps, type ManifestFile } from "../lib/index-project.ts";
import { createPrismaIndexStore } from "../lib/prisma-index-store.ts";

const url = process.env.RAG_TEST_DATABASE_URL ?? "";
const isLocal = /^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url);
const skip = !isLocal ? "set RAG_TEST_DATABASE_URL to a localhost MongoDB to run" : false;

const queries: string[] = [];
const db = new PrismaClient({
  datasourceUrl: isLocal ? url : "mongodb://127.0.0.1:1/unused",
  log: [{ emit: "event", level: "query" }],
});
db.$on("query", (event: { query: string }) => queries.push(event.query));
const store = createPrismaIndexStore(db);

let userId = "";
let playgroundId = "";

function treeOf(files: Record<string, string>): TemplateFolder {
  return {
    folderName: "demo",
    items: [
      {
        folderName: "src",
        items: Object.entries(files).map(([name, content]) => {
          const [filename, fileExtension] = name.split(".");
          return { filename: filename!, fileExtension: fileExtension!, content };
        }),
      },
    ],
  };
}

function fakeEmbedder(dimensions: number): EmbeddingProvider {
  return {
    async embedTexts(texts) {
      return texts.map((text) => Array.from({ length: dimensions }, (_, i) => text.length + i / 7));
    },
  };
}

function depsFor(tree: TemplateFolder, model = "it-model", dimensions = 4): IndexProjectDeps {
  return {
    async getOwnedProject() {
      return { decision: "allowed", project: { id: playgroundId, userId } };
    },
    async loadSavedTree() {
      return tree;
    },
    store,
    createEmbedder: () => ({ embedder: fakeEmbedder(dimensions), model }),
  };
}

function manifest(runId: string, paths: string[]): ManifestFile[] {
  return paths.map((path) => ({ path, contentHash: `hash-${path}`, runId }));
}

async function resetIndex() {
  await db.ragChunk.deleteMany({ where: { playgroundId } });
  await db.ragIndex.deleteMany({ where: { playgroundId } });
}

describe("Prisma + MongoDB RAG store (real database)", { skip }, () => {
  before(async () => {
    const user = await db.user.create({ data: { email: `rag-it-${Date.now()}@example.test`, name: "rag it" } });
    userId = user.id;
    const playground = await db.playground.create({ data: { title: "rag it", userId } });
    playgroundId = playground.id;
  });

  after(async () => {
    await resetIndex();
    await db.playground.deleteMany({ where: { id: playgroundId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  it("indexes end to end: initial, no-op, change + delete, model change, empty project", async () => {
    await resetIndex();

    const initial = await indexProject(playgroundId, depsFor(treeOf({ "a.ts": "const a = 1;\n", "b.ts": "const b = 2;\n" })));
    assert.equal(initial.status, "ok");
    assert.equal(await db.ragChunk.count({ where: { playgroundId } }), 2);
    const v1 = await db.ragIndex.findUniqueOrThrow({ where: { playgroundId } });
    assert.equal(v1.version, 1);
    assert.equal(v1.embeddingDimensions, 4);
    assert.equal(v1.files.length, 2);

    const same = await indexProject(playgroundId, depsFor(treeOf({ "a.ts": "const a = 1;\n", "b.ts": "const b = 2;\n" })));
    assert.equal(same.status === "ok" && same.embeddedFiles, 0);
    assert.equal((await db.ragIndex.findUniqueOrThrow({ where: { playgroundId } })).version, 1);

    const changed = await indexProject(playgroundId, depsFor(treeOf({ "a.ts": "const a = 99;\n" })));
    assert.equal(changed.status === "ok" && changed.embeddedFiles, 1);
    assert.equal(changed.status === "ok" && changed.deletedFiles, 1);
    const v2 = await db.ragIndex.findUniqueOrThrow({ where: { playgroundId } });
    assert.equal(v2.version, 2);
    assert.deepEqual(v2.files.map((f) => f.path), ["src/a.ts"]);
    const afterChange = await db.ragChunk.findMany({ where: { playgroundId } });
    assert.equal(afterChange.length, 1, "stale chunks for changed and deleted files are removed");
    assert.equal(afterChange[0]!.runId, v2.files[0]!.runId);

    const newModel = await indexProject(playgroundId, depsFor(treeOf({ "a.ts": "const a = 99;\n" }), "other-model", 6));
    assert.equal(newModel.status === "ok" && newModel.embeddedFiles, 1);
    const afterModel = await db.ragChunk.findMany({ where: { playgroundId } });
    assert.equal(afterModel.length, 1);
    assert.equal(afterModel[0]!.model, "other-model");
    assert.equal(afterModel[0]!.dimensions, 6);
    assert.equal(afterModel[0]!.embedding.length, 6);

    const empty = await indexProject(playgroundId, depsFor(treeOf({}), "third-model", 6));
    assert.equal(empty.status, "ok");
    const v4 = await db.ragIndex.findUniqueOrThrow({ where: { playgroundId } });
    assert.deepEqual(v4.files, []);
    assert.equal(v4.embeddingModel, "third-model");
    assert.equal(await db.ragChunk.count({ where: { playgroundId } }), 0);
  });

  it("stores and returns vectors exactly, and inserts more than one batch", async () => {
    await resetIndex();
    const vector = Array.from({ length: 1024 }, (_, i) => Math.sin(i) * 1e-3);
    const records = Array.from({ length: 120 }, (_, i) => ({
      path: "src/big.ts", chunkIndex: i, startLine: i + 1, endLine: i + 1, content: `line ${i}`,
      fileHash: "h", embedding: vector, model: "m", dimensions: 1024,
    }));
    await store.insertChunks({ playgroundId, userId, runId: "run-batch", baseVersion: 0, records });

    assert.equal(await db.ragChunk.count({ where: { playgroundId, runId: "run-batch" } }), 120);
    const one = await db.ragChunk.findFirstOrThrow({ where: { playgroundId, chunkIndex: 7 } });
    // Prisma's JSON protocol is not bit-exact for doubles (differs around the 16th digit). That is
    // irrelevant for similarity search, but the length and values must match closely.
    assert.equal(one.embedding.length, vector.length);
    vector.forEach((expected, i) => {
      assert.ok(Math.abs(one.embedding[i]! - expected) <= 1e-12, `component ${i} drifted`);
    });
  });

  it("enforces the unique chunk key so a retried run cannot create duplicates", async () => {
    await resetIndex();
    const record = { path: "src/a.ts", chunkIndex: 0, startLine: 1, endLine: 1, content: "x", fileHash: "h", embedding: [1, 2], model: "m", dimensions: 2 };
    await store.insertChunks({ playgroundId, userId, runId: "dup-run", baseVersion: 0, records: [record] });
    await assert.rejects(() => store.insertChunks({ playgroundId, userId, runId: "dup-run", baseVersion: 0, records: [record] }));
    assert.equal(await db.ragChunk.count({ where: { playgroundId, runId: "dup-run" } }), 1);
  });

  it("first-time commits: exactly one of many concurrent creators wins", async () => {
    for (let round = 0; round < 5; round += 1) {
      await resetIndex();
      const results = await Promise.all(
        Array.from({ length: 15 }, (_, i) =>
          store.commitIndex({
            playgroundId, userId, expectedVersion: null,
            embedding: { model: "m", dimensions: 2 }, files: manifest(`run-${i}`, ["src/a.ts"]),
          }),
        ),
      );
      assert.equal(results.filter(Boolean).length, 1, `round ${round}: exactly one creator must win`);
      assert.equal(await db.ragIndex.count({ where: { playgroundId } }), 1);
    }
  });

  it("version-guarded commits: exactly one of many concurrent writers wins and the version moves by exactly 1", async () => {
    for (let round = 0; round < 10; round += 1) {
      await resetIndex();
      await store.commitIndex({
        playgroundId, userId, expectedVersion: null,
        embedding: { model: "m", dimensions: 2 }, files: manifest("run-0", ["src/a.ts"]),
      });
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          store.commitIndex({
            playgroundId, userId, expectedVersion: 1,
            embedding: { model: "m", dimensions: 2 }, files: manifest(`writer-${i}`, ["src/a.ts"]),
          }),
        ),
      );
      assert.equal(results.filter(Boolean).length, 1, `round ${round}: exactly one writer must win`);
      const index = await db.ragIndex.findUniqueOrThrow({ where: { playgroundId } });
      assert.equal(index.version, 2);
      const winner = results.findIndex(Boolean);
      assert.equal(index.files[0]!.runId, `writer-${winner}`, "the stored manifest belongs to the winner");
    }
  });

  it("a stale version cannot replace a newer manifest", async () => {
    await resetIndex();
    await store.commitIndex({ playgroundId, userId, expectedVersion: null, embedding: { model: "m", dimensions: 2 }, files: manifest("r1", ["a"]) });
    assert.equal(await store.commitIndex({ playgroundId, userId, expectedVersion: 1, embedding: { model: "m", dimensions: 2 }, files: manifest("r2", ["a"]) }), true);
    assert.equal(await store.commitIndex({ playgroundId, userId, expectedVersion: 1, embedding: { model: "stale", dimensions: 9 }, files: manifest("stale", ["a"]) }), false);
    const index = await db.ragIndex.findUniqueOrThrow({ where: { playgroundId } });
    assert.equal(index.version, 2);
    assert.equal(index.embeddingModel, "m");
    assert.equal(index.files[0]!.runId, "r2");
  });

  it("two full indexProject runs racing from the same base: one wins, nothing dangles", async () => {
    await resetIndex();
    await indexProject(playgroundId, depsFor(treeOf({ "a.ts": "const a = 1;\n", "b.ts": "const b = 2;\n" })));

    const results = await Promise.all([
      indexProject(playgroundId, depsFor(treeOf({ "a.ts": "const a = 'A';\n", "b.ts": "const b = 2;\n" }))),
      indexProject(playgroundId, depsFor(treeOf({ "a.ts": "const a = 'B';\n", "b.ts": "const b = 2;\n" }))),
    ]);
    assert.equal(results.filter((r) => r.status === "ok").length >= 1, true);

    const index = await db.ragIndex.findUniqueOrThrow({ where: { playgroundId } });
    const chunks = await db.ragChunk.findMany({ where: { playgroundId }, select: { path: true, runId: true } });
    for (const file of index.files) {
      assert.equal(chunks.some((c) => c.path === file.path && c.runId === file.runId), true, `${file.path} must have chunks`);
    }
  });

  it("deleting a project removes its index and chunks (cascade)", async () => {
    const extra = await db.playground.create({ data: { title: "cascade", userId } });
    await store.insertChunks({
      playgroundId: extra.id, userId, runId: "c", baseVersion: 0,
      records: [{ path: "x", chunkIndex: 0, startLine: 1, endLine: 1, content: "x", fileHash: "h", embedding: [1], model: "m", dimensions: 1 }],
    });
    await store.commitIndex({ playgroundId: extra.id, userId, expectedVersion: null, embedding: { model: "m", dimensions: 1 }, files: manifest("c", ["x"]) });

    await db.playground.delete({ where: { id: extra.id } });

    assert.equal(await db.ragChunk.count({ where: { playgroundId: extra.id } }), 0);
    assert.equal(await db.ragIndex.count({ where: { playgroundId: extra.id } }), 0);
  });

  it("issues the version-guarded commit as a single MongoDB command", async () => {
    await resetIndex();
    await store.commitIndex({ playgroundId, userId, expectedVersion: null, embedding: { model: "m", dimensions: 2 }, files: manifest("r1", ["a"]) });
    queries.length = 0;
    await store.commitIndex({ playgroundId, userId, expectedVersion: 1, embedding: { model: "m", dimensions: 2 }, files: manifest("r2", ["a"]) });
    // Exactly one server command: the version check and the write cannot be separated.
    assert.deepEqual(queries.map((q) => q.replace(/\([\s\S]*$/, "")), ["db.runCommand"]);
  });
});
