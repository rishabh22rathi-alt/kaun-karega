-- Phase 3 dry-run follow-up — high-confidence alias additions only.
--
-- The bulk allocator dry-run flagged 2435 unresolved provider_areas
-- rows. This migration adds ONLY the aliases that are unambiguous
-- spelling variants or landmark synonyms of an existing active
-- canonical area. Everything that requires geographic judgement or
-- a NEW canonical area (e.g. Civil Lines, High Court Colony, Khema
-- Ka Kuan, Vivek Vihar, Chand Pole, Rawat Nagar, Laxmi Nagar,
-- Shikargarh, MIA, Tinwari) is deliberately OUT of this migration
-- and left for explicit admin decision via the AreaTab UI.
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
--        unresolved set) after this patch + a forced canonicalization
--        tick (or a re-run of the bulk allocator dry-run).
--
-- ──────────────────────────────────────────────────────────────────────
-- Safety posture
-- ──────────────────────────────────────────────────────────────────────
--   • Pure INSERT … ON CONFLICT DO NOTHING — second-run safe.
--   • No UPDATE / DELETE / TRUNCATE / DROP.
--   • No change to provider_areas, providers, matching, or any
--     runtime code path.
--   • alias_code values use the existing JOD-NN-AL### format
--     (active aliases, not the JOD-NN-EL### AI-enrichment format).
--     Each new code occupies an AL slot that is provably unused in
--     the matching region per the JOD-25 seed migration.
--   • The (alias, region_code) UNIQUE constraint guards against
--     same-text aliases under the same region; the alias_code PK
--     guards against code collisions.

BEGIN;

INSERT INTO public.service_region_area_aliases
  (alias_code, alias, canonical_area, region_code, city_code, active, notes)
VALUES
  -- JOD-10 Basni Industrial — bare colloquial "Basni" is the common
  -- way providers refer to the Basni Industrial area umbrella.
  ('JOD-10-AL001', 'Basni',         'Basni Industrial', 'JOD-10', 'JOD', true,
   '[inserted 2026-05-24 jod-high-confidence-aliases-patch]'),

  -- JOD-11 Sangariya — "Sangriya" (one-letter spelling drop) is the
  -- only difference from the seeded canonical. Common provider
  -- shorthand seen 85 times in the dry-run unresolved set.
  ('JOD-11-AL001', 'Sangriya',      'Sangariya',        'JOD-11', 'JOD', true,
   '[inserted 2026-05-24 jod-high-confidence-aliases-patch]'),

  -- JOD-04 Paota — "Paota Circle" is the landmark roundabout at the
  -- heart of the Paota canonical area; providers use the landmark
  -- name interchangeably with the area name.
  ('JOD-04-AL001', 'Paota Circle',  'Paota',            'JOD-04', 'JOD', true,
   '[inserted 2026-05-24 jod-high-confidence-aliases-patch]')
ON CONFLICT (alias_code) DO NOTHING;

-- ── In-transaction sanity assertions ──────────────────────────────────
-- Each inserted alias must end up active under the expected region.
-- Failure aborts the transaction so we never commit a partial patch.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.service_region_area_aliases
       WHERE city_code = 'JOD'
         AND active = true
         AND alias_code IN ('JOD-10-AL001', 'JOD-11-AL001', 'JOD-04-AL001')) <> 3
  THEN
    RAISE EXCEPTION
      'jod-high-confidence-aliases-patch: expected 3 newly-active aliases';
  END IF;

  -- (alias, region_code) uniqueness sanity — any collision would have
  -- raised the unique-violation already, but assert explicitly so an
  -- ON CONFLICT path that silently swallowed one of the rows surfaces.
  IF EXISTS (
    SELECT alias, region_code FROM public.service_region_area_aliases
     WHERE city_code = 'JOD'
       AND active = true
     GROUP BY alias, region_code
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'jod-high-confidence-aliases-patch: duplicate (alias, region) detected post-patch';
  END IF;
END $$;

COMMIT;
