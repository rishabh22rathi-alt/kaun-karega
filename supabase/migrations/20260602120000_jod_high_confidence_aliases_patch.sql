-- Phase 3 dry-run follow-up — high-confidence alias additions only.
--
-- The bulk allocator dry-run flagged 2435 unresolved provider_areas
-- rows. This migration adds ONLY the aliases that are unambiguous
-- spelling variants or landmark synonyms of an existing active
-- canonical area. Everything that requires geographic judgement or
-- a NEW canonical area (e.g. Civil Lines, High Court Colony, Khema
-- Ka Kuan, Vivek Vihar, Chand Pole, Rawat Nagar, Laxmi Nagar,
-- Shikargarh, MIA, Tinwari) is deliberately OUT of this migration
-- and left for explicit admin decision via the AreaTab UI or the
-- Provider Area Resolution Center.
--
-- Also out of scope:
--   • JOD-26 — created via admin UI after the JOD-25 seed; needs
--     explicit operator decision (keep / merge / deactivate) before
--     any catalog change touches it.
--   • Pal Road / Mahamandir / Banar — these are ALREADY seeded as
--     ACTIVE canonical areas (JOD-11-A001, JOD-19-A001, JOD-12-A002).
--     If the allocator dry-run reports them as unresolved, they were
--     deactivated post-seed by an admin action. Reactivating them is
--     a one-row UPDATE (not an INSERT) and belongs in a separate
--     audit-trail change, not a bulk additive patch.
--
-- ──────────────────────────────────────────────────────────────────────
-- Estimated coverage gain
-- ──────────────────────────────────────────────────────────────────────
--   Based on the dry-run counts the operator quoted:
--     Basni        → Basni Industrial / JOD-10  ≈ 217 rows
--     Sangriya     → Sangariya         / JOD-11 ≈  85 rows
--     Paota Circle → Paota             / JOD-04 ≈  31 rows
--     ── total ≈ 333 rows immediately resolvable (~14% of the
--        unresolved set) after this patch + a re-run of the bulk
--        allocator dry-run / the Provider Area Resolution Center.
--
-- ──────────────────────────────────────────────────────────────────────
-- Idempotency contract
-- ──────────────────────────────────────────────────────────────────────
--   Each alias has TWO uniqueness gates in the live schema:
--     1. service_region_area_aliases_pkey on alias_code (PK).
--     2. uniq_service_region_alias_per_region on (lower(alias),
--        region_code) — discovered the hard way during the first
--        db push attempt when admin had pre-created "Paota Circle"
--        under JOD-04 via the AreaTab UI.
--
--   Each INSERT uses INSERT … SELECT … WHERE NOT EXISTS (twice) so
--   re-running this migration — and applying it on a database where
--   an admin pre-created any of these aliases via any path — is a
--   no-op for the affected row. Neither uniqueness constraint can
--   trip.
--
--   The post-insert assertion checks (alias, region_code) PRESENCE
--   only, not the binding to a specific canonical_area or a specific
--   alias_code. Reason: an admin-created row may have used a
--   different alias_code (e.g., JOD-04-AL002 minted by the Resolution
--   Center's nextAliasCode), or — for the canonical_area field — may
--   have chosen a different binding. Either way the resolver still
--   resolves the alias to its region, which is the only thing the
--   bulk allocator and PR-C strict matcher care about.
--
-- ──────────────────────────────────────────────────────────────────────
-- Safety posture
-- ──────────────────────────────────────────────────────────────────────
--   • Pure INSERT … SELECT … WHERE NOT EXISTS — second-run safe.
--   • No UPDATE / DELETE / TRUNCATE / DROP.
--   • No change to provider_areas, providers, matching, or any
--     runtime code path.
--   • alias_code values use the existing JOD-NN-AL### format
--     (active aliases, not the JOD-NN-EL### AI-enrichment format).
--     Each new code occupies an AL slot that is provably unused in
--     the matching region per the JOD-25 seed migration.
--   • If an admin pre-created the same (alias, region) with a
--     different alias_code, this migration skips the insert.

BEGIN;

-- ── JOD-10 · "Basni" → "Basni Industrial" ─────────────────────────────
INSERT INTO public.service_region_area_aliases
  (alias_code, alias, canonical_area, region_code, city_code, active, notes)
SELECT
  'JOD-10-AL001', 'Basni', 'Basni Industrial', 'JOD-10', 'JOD', true,
  '[inserted 2026-05-24 jod-high-confidence-aliases-patch]'
WHERE NOT EXISTS (
  SELECT 1 FROM public.service_region_area_aliases
   WHERE region_code = 'JOD-10' AND lower(alias) = lower('Basni')
)
AND NOT EXISTS (
  SELECT 1 FROM public.service_region_area_aliases
   WHERE alias_code = 'JOD-10-AL001'
);


-- ── JOD-11 · "Sangriya" → "Sangariya" (spelling variant) ──────────────
INSERT INTO public.service_region_area_aliases
  (alias_code, alias, canonical_area, region_code, city_code, active, notes)
SELECT
  'JOD-11-AL001', 'Sangriya', 'Sangariya', 'JOD-11', 'JOD', true,
  '[inserted 2026-05-24 jod-high-confidence-aliases-patch]'
WHERE NOT EXISTS (
  SELECT 1 FROM public.service_region_area_aliases
   WHERE region_code = 'JOD-11' AND lower(alias) = lower('Sangriya')
)
AND NOT EXISTS (
  SELECT 1 FROM public.service_region_area_aliases
   WHERE alias_code = 'JOD-11-AL001'
);


-- ── JOD-04 · "Paota Circle" → "Paota" (landmark synonym) ──────────────
INSERT INTO public.service_region_area_aliases
  (alias_code, alias, canonical_area, region_code, city_code, active, notes)
SELECT
  'JOD-04-AL001', 'Paota Circle', 'Paota', 'JOD-04', 'JOD', true,
  '[inserted 2026-05-24 jod-high-confidence-aliases-patch]'
WHERE NOT EXISTS (
  SELECT 1 FROM public.service_region_area_aliases
   WHERE region_code = 'JOD-04' AND lower(alias) = lower('Paota Circle')
)
AND NOT EXISTS (
  SELECT 1 FROM public.service_region_area_aliases
   WHERE alias_code = 'JOD-04-AL001'
);


-- ── In-transaction sanity assertion ───────────────────────────────────
-- For each target (alias, region), assert at least one ACTIVE row
-- exists. The row may have been inserted by this migration OR pre-
-- existed (admin-created via AreaTab / Resolution Center). Either
-- way, the resolver can map the alias text to its region, which is
-- the only invariant the downstream allocator + PR-C strict matcher
-- depend on.
--
-- A failure here means the alias exists but is INACTIVE — admin must
-- decide whether to reactivate it (UPDATE … SET active = true via the
-- AreaTab UI) rather than this migration silently flipping the flag.
DO $$
DECLARE
  expected RECORD;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('Basni',        'JOD-10'),
      ('Sangriya',     'JOD-11'),
      ('Paota Circle', 'JOD-04')
    ) AS t(alias, region_code)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.service_region_area_aliases
       WHERE city_code = 'JOD'
         AND active = true
         AND region_code = expected.region_code
         AND lower(alias) = lower(expected.alias)
    ) THEN
      RAISE EXCEPTION
        'jod-high-confidence-aliases-patch: expected an ACTIVE alias (%, %) but none found. '
        'A row may exist but is inactive — reactivate via AreaTab rather than rerunning this migration.',
        expected.alias, expected.region_code;
    END IF;
  END LOOP;
END $$;

COMMIT;
