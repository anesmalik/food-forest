-- T1.5: HNSW vector index on embeddings.embedding for cosine-similarity search.
-- Pinned values per spec: m = 16, ef_construction = 64, vector_cosine_ops.
-- HNSW chosen over ivfflat: needs no training pass, works on empty tables,
-- and outperforms ivfflat on small corpora — all relevant here.

create index embeddings_embedding_hnsw_idx on embeddings
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);