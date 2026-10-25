-- Cookoff Champs schema. See the spec's data model: one event holds categories,
-- each category holds numbered entries, and a device holds one vote per category.

CREATE TABLE events (
  id          TEXT PRIMARY KEY,            -- unguessable, used in every link
  code        TEXT NOT NULL UNIQUE,        -- short typed fallback for the QR code
  name        TEXT NOT NULL,
  event_date  TEXT,                        -- YYYY-MM-DD, optional
  status      TEXT NOT NULL DEFAULT 'setup'
              CHECK (status IN ('setup', 'open', 'closed', 'revealed')),
  created_by  TEXT NOT NULL,               -- creator's email, lower-cased
  created_at  TEXT NOT NULL
);

CREATE TABLE organizers (
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  email     TEXT NOT NULL,                 -- lower-cased
  role      TEXT NOT NULL CHECK (role IN ('creator', 'co')),
  PRIMARY KEY (event_id, email)
);
CREATE INDEX organizers_by_email ON organizers(email);

CREATE TABLE categories (
  id        TEXT PRIMARY KEY,
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  position  INTEGER NOT NULL
);

CREATE TABLE entries (
  id           TEXT PRIMARY KEY,
  category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  number       INTEGER NOT NULL,           -- "Entry N", matches the tent card
  cook_name    TEXT NOT NULL,              -- hidden from guests until the reveal
  dish_name    TEXT NOT NULL,
  photo_key    TEXT,                       -- R2 object key
  UNIQUE (category_id, number)
);

-- One row per device per category: voting again replaces the row (decision 14).
CREATE TABLE votes (
  category_id   TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  device_token  TEXT NOT NULL,
  entry_id      TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (category_id, device_token)
);

-- Magic-link tokens are stored hashed and are single-use.
CREATE TABLE login_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);

CREATE TABLE sessions (
  id_hash     TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
