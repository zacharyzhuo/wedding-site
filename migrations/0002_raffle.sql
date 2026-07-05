-- Lucky draw. Entries are one-per-LINE-account (PK enforces it); draws are
-- append-only and double as the audit log — a redraw forfeits the old row
-- and inserts a new one, nothing is ever deleted.
CREATE TABLE raffle_entries (
  line_user_id  TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE raffle_draws (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  prize        TEXT NOT NULL,
  winner_id    TEXT NOT NULL,
  winner_name  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',   -- active | forfeited
  drawn_at     INTEGER NOT NULL
);

CREATE INDEX idx_raffle_draws_recent ON raffle_draws(drawn_at DESC);
