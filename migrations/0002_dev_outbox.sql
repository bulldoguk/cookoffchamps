-- Emails "sent" while EMAIL_MODE is "log". Lets local dev and the end-to-end
-- tests read magic links. Never written in production (EMAIL_MODE "resend"), and
-- only readable from a localhost APP_ORIGIN (see src/worker/email.ts).
CREATE TABLE dev_outbox (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr  TEXT NOT NULL,
  subject  TEXT NOT NULL,
  body     TEXT NOT NULL,
  sent_at  TEXT NOT NULL
);
