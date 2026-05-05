-- Unmapped Area Review Queue
-- Run this in the Supabase SQL editor before deploying the Unmapped Areas admin migration.
-- Requires the areas and area_aliases tables from admin-slice-areas.sql.

CREATE TABLE IF NOT EXISTS area_review_queue (
  review_id               TEXT        PRIMARY KEY,
  raw_area                TEXT        NOT NULL,
  normalized_key          TEXT        NOT NULL,
  status                  TEXT        NOT NULL DEFAULT 'pending',
  occurrences             INTEGER     NOT NULL DEFAULT 1,
  source_type             TEXT        NOT NULL DEFAULT '',
  source_ref              TEXT        NOT NULL DEFAULT '',
  first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_canonical_area TEXT        NOT NULL DEFAULT '',
  resolved_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS area_review_queue_status_idx          ON area_review_queue (status);
CREATE INDEX IF NOT EXISTS area_review_queue_normalized_key_idx  ON area_review_queue (normalized_key);
CREATE INDEX IF NOT EXISTS area_review_queue_last_seen_at_idx    ON area_review_queue (last_seen_at DESC);

-- Seed pending reviews from GAS AreaReviewQueue sheet:
-- INSERT INTO area_review_queue
--   (review_id, raw_area, normalized_key, status, occurrences, source_type, source_ref,
--    first_seen_at, last_seen_at, resolved_canonical_area, resolved_at)
-- VALUES
--   ('ARQ-1234567890-123', 'Shastri Nagar', 'shastrinagar', 'pending', 3,
--    'provider_register', '', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '', NULL)
-- ON CONFLICT (review_id) DO NOTHING;
