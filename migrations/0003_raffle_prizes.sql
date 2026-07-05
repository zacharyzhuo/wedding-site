-- Pre-defined prize list: prizes are decided before the event, so the admin
-- picks from this list instead of typing at draw time. Draws link back via
-- prize_id while keeping the prize-name snapshot for audit. Placeholder rows
-- seeded below — replace with the real list once the couple finalises
-- prizes (admin page has add/remove).
CREATE TABLE raffle_prizes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  quantity   INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE raffle_draws ADD COLUMN prize_id INTEGER;

INSERT INTO raffle_prizes (name, quantity, sort_order) VALUES
  ('頭獎 iPhone', 1, 1),
  ('二獎 Dyson 吹風機', 2, 2),
  ('三獎 星巴克禮券', 3, 3),
  ('護手霜', 5, 4);
