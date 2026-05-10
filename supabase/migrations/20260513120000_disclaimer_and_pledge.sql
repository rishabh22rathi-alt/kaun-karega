-- Disclaimer + Provider Pledge — Phase 1 (schema only)
--
-- Adds 4 nullable columns and 1 partial index. No backfill, no enum, no
-- trigger. Existing rows keep NULL for the new columns; the application
-- treats NULL as "not yet accepted" and any version mismatch / age > 15
-- days as "expired".
--
-- Why two tables, not a single junction table:
--   - profiles.phone is the natural key for "this human accepted the
--     user disclaimer at time T". Versioning lives on the row so a future
--     v2 invalidates v1 rows by string mismatch with the app constant.
--   - providers.provider_id is the natural key for "this provider signed
--     the pledge once at registration". The pledge is a one-time signing
--     event; nothing in the app re-prompts an existing provider. A
--     dedicated table would be over-modelled for one row per provider.
--
-- Submit-request gate (added in the same release) reads profiles by
-- phone and rejects with 403 DISCLAIMER_REQUIRED when the row is missing
-- / version-mismatched / older than 15 days. The gate is the trusted
-- source of truth; the client modal is the UX surface, never the
-- enforcement point.
--
-- Rollback: every statement is `ADD COLUMN IF NOT EXISTS` /
-- `CREATE INDEX IF NOT EXISTS` so re-running this migration is a no-op.
-- A separate forward-only migration would drop the columns if reversal
-- is ever required.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS disclaimer_version     text,
  ADD COLUMN IF NOT EXISTS disclaimer_accepted_at timestamptz;

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS pledge_version     text,
  ADD COLUMN IF NOT EXISTS pledge_accepted_at timestamptz;

-- Partial index speeds the "fetch the freshest acceptance row by phone"
-- lookup the submit-request gate runs on every authenticated submission.
-- WHERE clause keeps the index small — rows that never accepted (NULL
-- timestamp) are not indexed.
CREATE INDEX IF NOT EXISTS idx_profiles_disclaimer_phone
  ON public.profiles (phone)
  WHERE disclaimer_accepted_at IS NOT NULL;

COMMENT ON COLUMN public.profiles.disclaimer_version IS
  'App-side version string of the user disclaimer last accepted (e.g. "v1"). NULL = never accepted.';
COMMENT ON COLUMN public.profiles.disclaimer_accepted_at IS
  'When the user accepted disclaimer_version. Combined with the app constant DISCLAIMER_MAX_AGE_MS to compute freshness.';
COMMENT ON COLUMN public.providers.pledge_version IS
  'App-side version string of the provider pledge accepted at registration. NULL on legacy rows registered before this column existed.';
COMMENT ON COLUMN public.providers.pledge_accepted_at IS
  'When the provider accepted the pledge during registration. One-time signing event; not re-prompted on edits.';
