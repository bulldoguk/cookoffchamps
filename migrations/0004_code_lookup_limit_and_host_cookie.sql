-- Rate limit on typed-code lookups (SW-19). The six-character code is short
-- enough to guess at, so failed lookups are counted per client (IP hashed) over
-- a short window. Successful lookups aren't counted, so a room of guests on one
-- wifi typing the right code is never turned away.
CREATE TABLE code_misses (
  ip_hash  TEXT NOT NULL,
  at       TEXT NOT NULL
);
CREATE INDEX code_misses_by_ip ON code_misses(ip_hash, at);
CREATE INDEX code_misses_by_at ON code_misses(at);

-- The session cookie is now __Host-cc_session. Sessions issued under the old
-- name can never be presented again, so drop them rather than leave them live.
DELETE FROM sessions;
