// Embedding cron configuration and constants.
// Pinned per spec — not configurable per-component.

export const EMBEDDING_BATCH_SIZE = 32
export const EMBEDDING_MAX_ATTEMPTS = 5
export const EMBEDDING_CIRCUIT_BREAKER_THRESHOLD = 3
// Stale processing timeout: if a row is in 'processing' for longer than this,
// it's assumed the previous cron run crashed and the row should be reclaimed.
// 5 minutes is conservative: allows time for a slow embedding API call, but short enough
// to avoid the failure mode where crashed runs leave rows permanently orphaned.
export const STALE_PROCESSING_MINUTES = 5

// Token estimation: word count × ~1.3 gives a rough token approximation.
export const TOKEN_PER_WORD_RATIO = 1.3

// Chunk size targets per spec §1.7
export const CHUNK_TARGET_MIN_TOKENS = 200
export const CHUNK_TARGET_MAX_TOKENS = 500
export const CHUNK_OVERLAP_TOKENS = 50

// Single-chunk threshold: under this many tokens → one chunk, no splitting
export const SINGLE_CHUNK_THRESHOLD_TOKENS = 500
