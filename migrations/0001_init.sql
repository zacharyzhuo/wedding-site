-- Initial schema for the day-of interactive layer.
-- See: ~/.claude/skills/wedding-planning/references/interactive-features.md
--
-- Apply: `npx wrangler d1 migrations apply wedding-live --remote`
-- (drop --remote for the local SQLite during dev)

CREATE TABLE IF NOT EXISTS danmaku (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id  TEXT    NOT NULL,
  display_name  TEXT    NOT NULL,
  message       TEXT    NOT NULL,
  -- Set when the row was inserted as the auto-caption side-effect of a
  -- photo upload. Lets the screen client tag the danmaku with the photo.
  photo_id      INTEGER,
  -- approved | pending | deleted. 'pending' = keyword filter hit or
  -- global mode is 'manual'; admin LIFF promotes to approved.
  status        TEXT    NOT NULL DEFAULT 'approved',
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (photo_id) REFERENCES photos(id)
);

CREATE TABLE IF NOT EXISTS photos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- R2 object key, e.g. uploads/2027-06-05/<uuid>.jpg
  r2_key        TEXT    NOT NULL UNIQUE,
  uploader_id   TEXT    NOT NULL,
  uploader_name TEXT    NOT NULL,
  caption       TEXT,
  -- visible | hidden. Hidden photos are skipped by the screen carousel.
  status        TEXT    NOT NULL DEFAULT 'visible',
  created_at    INTEGER NOT NULL
);

-- Key-value settings. Currently used for the global moderation mode flag
-- ('auto' | 'manual'). Overkill for one row but cheap, and saves wiring KV
-- for the same purpose.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('moderation_mode', 'auto');

-- Screen polling pulls "rows newer than `since`". DESC indexes match the
-- ORDER BY in feed queries.
CREATE INDEX IF NOT EXISTS idx_danmaku_feed ON danmaku(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_feed  ON photos(status,  created_at DESC);
