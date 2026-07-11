-- Party (團) = one RSVP-leader's group. guest_identity = per-adult identity
-- keyed by LINE userId. Children are counts on party only (no identity row).
CREATE TABLE party (
  party_id         TEXT PRIMARY KEY,      -- 8-char Crockford base32, non-expiring
  leader_user_id   TEXT NOT NULL,
  side             TEXT NOT NULL,          -- 男方 | 女方
  relationship     TEXT NOT NULL,          -- 家長 | 親戚 | 朋友
  attending        TEXT NOT NULL,          -- 出席 | 不克出席
  adult_count      INTEGER NOT NULL DEFAULT 1,
  child_count      INTEGER NOT NULL DEFAULT 0,
  child_seat_count INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX idx_party_leader ON party(leader_user_id);

CREATE TABLE guest_identity (
  line_user_id  TEXT PRIMARY KEY,
  real_name     TEXT NOT NULL,
  diet          TEXT,
  party_id      TEXT,                      -- nullable; solo guests have none
  role          TEXT NOT NULL,             -- leader | member | solo
  display_name  TEXT,                      -- LINE displayName snapshot
  avatar_url    TEXT,
  source        TEXT NOT NULL,             -- rsvp | join | raffle | manual
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_identity_party ON guest_identity(party_id);
