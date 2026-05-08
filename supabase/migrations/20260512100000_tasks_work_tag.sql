-- Activate specialization-aware matching by recording the original alias
-- the user typed when it resolved to a different canonical category.
--
-- Background: today, submit-request resolves a typed alias ("dentist",
-- "dance teacher") to its canonical category ("doctor", "hobby classes")
-- and persists ONLY the canonical on the tasks row. The alias is lost,
-- so process-task-notifications cannot narrow the fan-out to providers
-- who have actually claimed that specialty. This column captures the
-- alias so downstream matching can use it.
--
-- Semantics:
--   - NULL  → user typed a canonical directly, or an unknown term, or a
--             pre-migration row. Matching falls back to broad
--             category + area (current behaviour, no regression).
--   - non-NULL → user typed an alias that resolved to a different
--             canonical. Matching first attempts a three-way intersection
--             of provider_services × provider_areas × provider_work_terms
--             (filtered by alias = work_tag AND canonical_category =
--             tasks.category). If that yields zero providers, matching
--             falls back to broad category + area, exactly as if work_tag
--             were NULL — no specialist available is not the same as
--             no provider available.
--
-- Read by:
--   - web/app/api/process-task-notifications/route.ts
--   - web/app/api/find-provider/route.ts (via task lookup when taskId is
--     supplied; otherwise the route reads work_tag from the request
--     body/query directly).
-- Written by:
--   - web/app/api/submit-request/route.ts (via resolveCategoryAliasDetailed)
--
-- Nullable, no default — rows existing before this migration read as NULL
-- and degrade gracefully to the current broad behaviour.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS work_tag text NULL;

COMMENT ON COLUMN public.tasks.work_tag IS
  'Original alias / work_tag the user typed when it resolved to a different canonical category (e.g. "dentist" -> doctor, "dance teacher" -> hobby classes). NULL means the user typed the canonical directly, an unknown term, or pre-dates this column — broad category+area matching is used in that case. Read by find-provider and process-task-notifications to filter providers whose provider_work_terms includes this alias under the same canonical_category. Falls back to broad matching when no specialist provider exists.';
