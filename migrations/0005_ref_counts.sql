-- Where new organisers come from (SW-59). The "run your own cookoff" links on the
-- results page and the reveal open /?ref=results or /?ref=reveal. Cloudflare Web
-- Analytics drops query strings, so the Worker counts them here, one row per
-- source per UTC day. Nothing about the visitor is stored.
CREATE TABLE ref_counts (
  ref   TEXT NOT NULL,
  day   TEXT NOT NULL,
  hits  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ref, day)
);
