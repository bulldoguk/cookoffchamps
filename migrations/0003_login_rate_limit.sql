-- Rate limits on login emails (SW-19). Each login_tokens row is one email sent,
-- so counting recent rows per address and per requesting IP caps how many links
-- anyone can make the site send. The IP is stored hashed. Older rows predate
-- the limit and simply have NULLs here.
ALTER TABLE login_tokens ADD COLUMN created_at TEXT;
ALTER TABLE login_tokens ADD COLUMN ip_hash TEXT;
CREATE INDEX login_tokens_by_email ON login_tokens(email, created_at);
CREATE INDEX login_tokens_by_ip ON login_tokens(ip_hash, created_at);
CREATE INDEX sessions_by_expiry ON sessions(expires_at);
