-- Submission snapshot + per-page agent token.
--
-- submission_image is the immutable artifact a grading refers to. It lives in
-- its own BLOB column rather than inside the page row or an object store:
-- only the .png endpoint ever reads it, so every metadata SELECT can skip it,
-- and PNG bytes are already compact — base64 would cost 33% more and a decode
-- on every read.
--
-- grading is the agent's verbatim result (JSON). Nullable: cleared on every
-- re-submission, because feedback attached to a superseded snapshot is worse
-- than no feedback.

ALTER TABLE page ADD COLUMN submitted_at INTEGER;
ALTER TABLE page ADD COLUMN submission_image BLOB;
ALTER TABLE page ADD COLUMN grading TEXT;

-- jti of the current per-page agent token. Null = no valid token, which is
-- also how revocation works: clear this and every previously signed jti dies.
ALTER TABLE page ADD COLUMN token_jti TEXT;
