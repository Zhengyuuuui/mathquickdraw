-- One row per whiteboard page. `snapshot` is the whole Quickdraw document
-- (JSON) — it is never queried into, only read/written whole, so a TEXT
-- column is the right shape. `style` stays JSON on purpose: theme × grid is
-- 12 combinations today, and paper tint / page size / margins are coming —
-- four columns would mean an ALTER TABLE for every new knob.
CREATE TABLE page (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  style       TEXT NOT NULL DEFAULT '{}',
  camera      TEXT,
  snapshot    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE INDEX idx_page_updated ON page(updated_at DESC)
  WHERE deleted_at IS NULL;
