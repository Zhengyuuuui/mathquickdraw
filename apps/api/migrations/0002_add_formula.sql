-- One LaTeX formula per page, rendered outside the paper in its own column.
-- Nullable: a page with no formula is the common case, and no backfill is
-- needed — SQLite's ADD COLUMN fills existing rows with NULL. Kept as raw
-- LaTeX source (not rendered HTML): KaTeX typesets it on the client, so the
-- column stays small and editable.

ALTER TABLE page ADD COLUMN formula TEXT;
