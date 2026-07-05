-- 悄悄話 thank-you cards. One card per LINE user, keyed by the same
-- line_user_id the RSVP flow captured — the couple writes messages in the
-- planning Sheet's ThankYou_Cards tab and a sync script upserts them here
-- before the event. Guests who type the keyword but have no card get a
-- generic thank-you reply (handled in the webhook, not stored here).
CREATE TABLE thankyou_cards (
  line_user_id TEXT PRIMARY KEY,
  guest_name   TEXT NOT NULL,
  message      TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);
