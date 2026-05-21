-- 20260526120200_capture_unmapped_areas.sql
--
-- Phase 0.4 capture migration. Promotes the area review queue
-- (area_review_queue) from docs/admin-slice-unmapped-areas.sql into
-- a real Supabase migration so fresh environments can reproduce prod.
--
-- This table backs the admin "pending areas" surface and the
-- provider self-service unmapped-area request flow. It is read by:
--   web/app/api/admin/areas/route.ts:131-138
--   web/lib/admin/adminUnmappedAreas.ts:108-114
--   supabase/migrations/20260524120000_provider_approval_reconcile_backfill.sql:129-134
--
-- ──────────────────────────────────────────────────────────────────────
-- Source of schema
-- ──────────────────────────────────────────────────────────────────────
--   docs/admin-slice-unmapped-areas.sql (lines 5-21)
--   Promoted verbatim with schema-qualified names (public.) and
--   IF NOT EXISTS guards on every CREATE statement.
--
-- ──────────────────────────────────────────────────────────────────────
-- Safety posture
-- ──────────────────────────────────────────────────────────────────────
--   • Every statement is idempotent (CREATE … IF NOT EXISTS).
--   • No ALTER, DROP, INSERT, UPDATE, DELETE, TRUNCATE.
--   • No RLS changes, no policies, no GRANT / REVOKE.
--   • No triggers, no functions, no extensions.
--   • No cross-file foreign keys (source_ref is plain TEXT in prod
--     by design — see the comment in
--     20260524120000_provider_approval_reconcile_backfill.sql:36-39
--     which explicitly documents why source_ref has no FK to
--     providers.provider_id).
--   • Production: every statement is a NO-OP — the table already
--     exists in prod (operators ran the docs script during the
--     Unmapped Areas admin rollout).
--   • Fresh environments: gain a reproducible baseline.
--
-- ──────────────────────────────────────────────────────────────────────
-- Known unknowns (deliberately not declared here)
-- ──────────────────────────────────────────────────────────────────────
--   • Any extra indexes added in prod after the original docs
--     script ran are not captured here. A reconcile migration will
--     close drift after a prod dump.
--   • Whether prod has a CHECK constraint on status (e.g.
--     status IN ('pending','approved','rejected','resolved')) is
--     not knowable from runtime code alone; not declared.
--
-- ──────────────────────────────────────────────────────────────────────
-- Rollback posture
-- ──────────────────────────────────────────────────────────────────────
--   No DOWN migration. The table already exists in prod; this
--   migration never wrote to prod. Supersession via a later
--   reconcile migration is the only correction path.
--
-- ──────────────────────────────────────────────────────────────────────
-- Production no-op guarantee
-- ──────────────────────────────────────────────────────────────────────
--   area_review_queue already exists in production. IF NOT EXISTS
--   makes every CREATE a no-op; no row, index, constraint, or
--   policy is touched.
-- ──────────────────────────────────────────────────────────────────────


-- ──────────────────────────────────────────────────────────────────────
-- area_review_queue
--
-- Pending area requests awaiting admin review. raw_area is the
-- exact text submitted by user/provider; normalized_key is a
-- case+whitespace folded form used for dedup; resolved_canonical_area
-- gets populated when an admin approves the request and maps it to
-- a canonical area.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.area_review_queue (
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


CREATE INDEX IF NOT EXISTS area_review_queue_status_idx          ON public.area_review_queue (status);
CREATE INDEX IF NOT EXISTS area_review_queue_normalized_key_idx  ON public.area_review_queue (normalized_key);
CREATE INDEX IF NOT EXISTS area_review_queue_last_seen_at_idx    ON public.area_review_queue (last_seen_at DESC);
