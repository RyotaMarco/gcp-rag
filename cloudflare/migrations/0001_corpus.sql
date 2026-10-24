CREATE TABLE IF NOT EXISTS corpus_versions (
  version TEXT PRIMARY KEY,
  embedding_model TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions = 1024),
  chunk_count INTEGER NOT NULL CHECK (chunk_count BETWEEN 1 AND 750),
  page_count INTEGER NOT NULL CHECK (page_count BETWEEN 1 AND 30),
  created_at TEXT NOT NULL,
  manifest_sha TEXT NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1))
);
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL REFERENCES corpus_versions(version),
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  product TEXT NOT NULL,
  section TEXT NOT NULL,
  crawled_at TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_version ON chunks(version);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  id UNINDEXED, version UNINDEXED, text, title, product,
  tokenize = 'unicode61 remove_diacritics 2'
);
