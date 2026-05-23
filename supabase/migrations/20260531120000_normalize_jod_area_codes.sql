-- Normalize JOD service_region_areas.area_code format to the
-- region-prefixed scheme (JOD-NN-{A|E|M}###). The catalog currently
-- holds three mint origins:
--   • JOD-NN-A###  — JOD-25 seed migration (20260527130000)
--   • JOD-NN-E###  — AI-enrichment migration (20260528120000), inactive draft rows
--   • A-####       — Admin "Add Area" UI + recent manual import path
--                    (web/components/admin/AreaTab.tsx:99-113, 965; nextCode
--                    with prefix "A-" mints global counter codes)
--
-- The A-#### rows are functionally fine (area_code is opaque to matching,
-- provider registration, dashboard, and allocation — confirmed by audit)
-- but they break catalog hygiene: admins reading the table see two coding
-- conventions inside the same region. This migration assigns those rows
-- a JOD-NN-M### code, where M = "manually imported / admin-created" so
-- provenance is preserved (A = original seed, E = AI enrichment, M = manual).
--
-- ──────────────────────────────────────────────────────────────────────
-- Scope
-- ──────────────────────────────────────────────────────────────────────
--   Only service_region_areas rows where:
--     • city_code   = 'JOD'
--     • region_code matches '^JOD-[0-9]{2}$' (excludes legacy R-* regions
--       still parked inactive — those are handled by the existing
--       /api/admin/area-intelligence/cleanup-legacy-regions endpoint;
--       renaming them here would produce 'R-XX-M001' which is not a
--       conforming JOD code anyway)
--     • area_code  does NOT already match '^JOD-[0-9]{2}-[AEM][0-9]{3,4}$'
--
-- ──────────────────────────────────────────────────────────────────────
-- What changes / what does NOT change
-- ──────────────────────────────────────────────────────────────────────
--   Changed:
--     • service_region_areas.area_code (PK rename, in place)
--     • service_region_areas.notes     (appended audit string)
--     • service_region_areas.updated_at (default trigger if any)
--   NOT changed:
--     • canonical_area, region_code, city_code, active, created_at
--     • Aliases (service_region_area_aliases reference rows by
--       (canonical_area, region_code), not by area_code — confirmed
--       in 20260525120000_service_regions_init.sql:104-117)
--     • provider_areas (no FK to area_code; matches on area text)
--     • tasks, area_review_queue, find-provider, dashboard logic
--
-- ──────────────────────────────────────────────────────────────────────
-- Numbering algorithm
-- ──────────────────────────────────────────────────────────────────────
--   For each affected region, count the highest M### counter already
--   present (zero if none) and assign successive M codes starting from
--   max + 1. Affected rows are ordered deterministically by
--   (created_at, canonical_area, area_code) so re-runs and diffs are
--   reproducible. lpad to 3 digits; the regex pattern accepts 3-4 digits
--   so overflow past M999 is non-fatal — admins should be alerted by
--   then anyway.
--
-- ──────────────────────────────────────────────────────────────────────
-- CHECK constraint
-- ──────────────────────────────────────────────────────────────────────
--   Deliberately NOT added. Two reasons:
--     1. Legacy R-* regions under city_code='JOD' still hold inactive
--        area rows whose region_code (R-NN) does not match the JOD-NN
--        prefix needed by the pattern. Adding a CHECK that asserts
--        "city_code='JOD' implies area_code ~ '^JOD-...'" would either
--        fail validation on those rows or force us to also rename them
--        (and their parent regions) — out of scope for this migration.
--     2. The single mint site for new area codes (AreaTab.tsx addAreaCore)
--        is being patched in the same change. A behavioural fix at the
--        mint site is sufficient to prevent recurrence; the structural
--        CHECK can be added separately once the legacy R-* rows are
--        cleared via the cleanup-legacy-regions endpoint.
--   Document, don't enforce. The post-rename DO-block assertion below
--   guarantees this migration leaves the JOD-NN regions in a conforming
--   state for the cohort it touched.
--
-- ──────────────────────────────────────────────────────────────────────
-- Safety posture
-- ──────────────────────────────────────────────────────────────────────
--   • Single transaction.
--   • Idempotent: second run finds zero non-conforming rows, performs no
--     writes, assertions still pass.
--   • No DROP, no DELETE, no TRUNCATE.
--   • No NOT NULL change, no schema change.
--   • PK update on service_region_areas is safe because no FK references
--     service_region_areas.area_code (verified against migrations
--     20260525120000, 20260527120200, 20260528120000).
--
-- ──────────────────────────────────────────────────────────────────────
-- Rollback posture
-- ──────────────────────────────────────────────────────────────────────
--   No DOWN migration. The notes column preserves the prior area_code
--   for every renamed row ("area_code normalized from <old_code>"), so
--   an operator can reconstruct the original PK from notes if needed.
--   Supersession only.

BEGIN;

-- ── 1. Compute the new codes in a CTE and apply the UPDATE atomically.
-- to_rename: the cohort that needs a new code (deterministic ordering).
-- existing_m: per-region max of the M counter already in use, so we
-- never collide with a JOD-NN-M### that exists today.
WITH to_rename AS (
  SELECT
    area_code AS old_code,
    region_code,
    row_number() OVER (
      PARTITION BY region_code
      ORDER BY created_at, canonical_area, area_code
    ) AS rn
  FROM public.service_region_areas
  WHERE city_code = 'JOD'
    AND region_code ~ '^JOD-[0-9]{2}$'
    AND area_code !~ '^JOD-[0-9]{2}-[AEM][0-9]{3,4}$'
),
existing_m AS (
  SELECT
    region_code,
    COALESCE(
      MAX(
        CAST(
          substring(area_code FROM '^JOD-[0-9]{2}-M([0-9]+)$') AS INTEGER
        )
      ),
      0
    ) AS max_m
  FROM public.service_region_areas
  WHERE city_code = 'JOD'
    AND region_code ~ '^JOD-[0-9]{2}$'
    AND area_code ~ '^JOD-[0-9]{2}-M[0-9]+$'
  GROUP BY region_code
),
renames AS (
  SELECT
    t.old_code,
    t.region_code,
    t.region_code
      || '-M'
      || lpad(
        (COALESCE(e.max_m, 0) + t.rn)::text,
        3, '0'
      ) AS new_code
  FROM to_rename t
  LEFT JOIN existing_m e USING (region_code)
)
UPDATE public.service_region_areas s
   SET area_code = r.new_code,
       notes = COALESCE(s.notes, '')
               || CASE WHEN COALESCE(s.notes, '') = '' THEN '' ELSE ' ' END
               || '[area_code normalized from ' || r.old_code
               || ' on 2026-05-23 normalize-jod-area-codes]'
  FROM renames r
 WHERE s.area_code = r.old_code;

-- ── 2. Sanity assertions. Each failure aborts the transaction so we
-- never commit a half-applied rename.
DO $$
DECLARE
  remaining_nonconforming INT;
  duplicate_codes INT;
BEGIN
  -- 2a. Every JOD row under a JOD-NN region must now match the pattern.
  -- Excludes legacy R-* regions (out of scope for this migration; the
  -- cleanup-legacy-regions endpoint handles those separately).
  SELECT COUNT(*) INTO remaining_nonconforming
    FROM public.service_region_areas
   WHERE city_code = 'JOD'
     AND region_code ~ '^JOD-[0-9]{2}$'
     AND area_code !~ '^JOD-[0-9]{2}-[AEM][0-9]{3,4}$';

  IF remaining_nonconforming > 0 THEN
    RAISE EXCEPTION
      'normalize-jod-area-codes: % JOD-NN area_code value(s) remain non-conforming after rename',
      remaining_nonconforming;
  END IF;

  -- 2b. PK constraint on area_code already enforces global uniqueness,
  -- but assert explicitly so a logic bug in the CTE surfaces here rather
  -- than as a downstream confusion.
  SELECT COUNT(*) INTO duplicate_codes
    FROM (
      SELECT area_code, COUNT(*) AS n
        FROM public.service_region_areas
       GROUP BY area_code
      HAVING COUNT(*) > 1
    ) d;

  IF duplicate_codes > 0 THEN
    RAISE EXCEPTION
      'normalize-jod-area-codes: % duplicate area_code value(s) detected after rename',
      duplicate_codes;
  END IF;
END $$;

COMMIT;
