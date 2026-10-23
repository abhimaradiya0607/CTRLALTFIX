import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OLLAMA_VECTOR_INDEX_NAME,
  VOYAGE_VECTOR_INDEX_NAME,
  chunkCollectionForModel,
  selectEmbeddingTarget,
  vectorIndexForModel,
} from "./embedding-target.ts";

describe("selectEmbeddingTarget", () => {
  it("keeps an Ollama project on the Ollama provider and index", () => {
    const target = selectEmbeddingTarget({
      storedModel: "qwen3-embedding",
      storedDimensions: 1024,
      env: {
        OLLAMA_EMBED_MODEL: "qwen3-embedding",
        VOYAGE_API_KEY: "present",
        RAG_EMBED_PROVIDER: "voyage",
      },
    });
    assert.equal(target.ok, true);
    if (target.ok) {
      assert.equal(target.provider, "ollama");
      assert.equal(target.model, "qwen3-embedding");
      assert.equal(target.collection, "ollama");
      assert.equal(target.indexName, OLLAMA_VECTOR_INDEX_NAME);
    }
    assert.equal(chunkCollectionForModel("qwen3-embedding"), "ollama");
    assert.equal(vectorIndexForModel("qwen3-embedding"), "rag_chunk_vector");
  });

  it("keeps a Voyage project on the Voyage collection and index", () => {
    const target = selectEmbeddingTarget({
      storedModel: "voyage-code-4",
      storedDimensions: 1024,
      env: { VOYAGE_API_KEY: "present", OLLAMA_EMBED_MODEL: "qwen3-embedding", RAG_EMBED_PROVIDER: "ollama" },
    });
    assert.equal(target.ok, true);
    if (target.ok) {
      assert.equal(target.provider, "voyage");
      assert.equal(target.model, "voyage-code-4");
      assert.equal(target.collection, "voyage");
      assert.equal(target.indexName, VOYAGE_VECTOR_INDEX_NAME);
      assert.equal(target.outputDimension, 1024);
    }
    assert.equal(vectorIndexForModel("voyage-code-4"), "rag_chunk_vector_voyage");
  });

  it("does not call Voyage for a new project unless embedding is explicitly enabled", () => {
    const staying = selectEmbeddingTarget({
      storedModel: null,
      storedDimensions: null,
      env: { VOYAGE_API_KEY: "present", OLLAMA_EMBED_MODEL: "qwen3-embedding" },
    });
    assert.equal(staying.ok && staying.provider, "ollama");

    const missingKey = selectEmbeddingTarget({
      storedModel: null,
      storedDimensions: null,
      env: { RAG_EMBED_PROVIDER: "voyage", OLLAMA_EMBED_MODEL: "qwen3-embedding" },
    });
    assert.deepEqual(missingKey, { ok: false, reason: "not-configured" });
  });

  it("refuses a Voyage project when the key or stored dimension is missing", () => {
    assert.equal(
      selectEmbeddingTarget({
        storedModel: "voyage-code-4",
        storedDimensions: 1024,
        env: {},
      }).ok,
      false,
    );
    assert.equal(
      selectEmbeddingTarget({
        storedModel: "voyage-code-4",
        storedDimensions: 768,
        env: { VOYAGE_API_KEY: "present" },
      }).ok,
      false,
    );
  });
});
