-- Strict region matching — PR-A: schema foundation.
--
-- Adds a nullable region_code column to public.tasks so a task can be
-- linked directly to a JOD service region (resolved at submit time in
-- a later PR). Mirrors the Phase 1 provider_areas migration
-- (20260601120000) exactly in safety posture and constraint shape so
-- the two columns behave identically across the join.
--
-- ──────────────────────────────────────────────────────────────────────
-- Scope of THIS migration
-- ──────────────────────────────────────────────────────────────────────
--   • Add column public.tasks.region_code TEXT NULL
--   • Add FK tasks_region_code_fkey → service_regions(region_code)
--   • Add partial index tasks_region_code_idx
--       ON public.tasks(region_code) WHERE region_code IS NOT NULL
--
-- Deliberately NOT in this migration (later PRs):
--   • Submit-time area→region resolution in /api/submit-request (PR-B)
--   • Strict matching rewrite in /api/find-provider and
--     /api/process-task-notifications (PR-C)
--   • Any backfill of historical tasks
--   • Any change to provider_task_matches (still stores `area` TEXT
--     for the WhatsApp template)
--   • Any change to WhatsApp message body (still receives task.area
--     human-readable text)
--   • NOT NULL on region_code
--
-- ──────────────────────────────────────────────────────────────────────
-- Why nullable
-- ──────────────────────────────────────────────────────────────────────
--   PR-A is invisible to runtime. PR-B will start populating
--   region_code on new submits via the existing resolveAreaToRegion
--   helper; even after PR-B, the column stays nullable because an
--   unresolved/ambiguous task area must be allowed to land (with
--   region_code = NULL → strict matching returns no providers per
--   PR-C). Setting NOT NULL here would block every existing INSERT
--   site immediately.
--
-- ──────────────────────────────────────────────────────────────────────
-- Why partial index
-- ──────────────────────────────────────────────────────────────────────
--   Strict region matching only ever reads rows whose region_code IS
--   NOT NULL. A partial index avoids indexing the residual NULL set
--   during the PR-A → PR-B → PR-C rollout (and indefinitely for
--   unresolvable tasks) while serving the matching workload at full
--   speed once PR-C lands.
--
-- ──────────────────────────────────────────────────────────────────────
-- Safety posture
-- ──────────────────────────────────────────────────────────────────────
--   • ADD COLUMN IF NOT EXISTS — second-run safe.
--   • FK guarded by DO $$ … pg_constraint lookup — second-run safe.
--   • CREATE INDEX IF NOT EXISTS — second-run safe.
--   • No NOT NULL.
--   • No UPDATE / DELETE / TRUNCATE / DROP.
--   • No backfill — region_code stays NULL on every existing tasks row.
--   • FK uses default NO ACTION on update/delete: if a service_regions
--     row is ever hard-deleted while a task still references it, the
--     DELETE fails loudly. Matches the posture on
--     provider_areas_region_code_fkey.
--
-- ──────────────────────────────────────────────────────────────────────
-- Runtime compatibility
-- ──────────────────────────────────────────────────────────────────────
--   No code change is gated on this migration. /api/submit-request
--   continues to insert tasks WITHOUT region_code, which is allowed
--   (column nullable). /api/find-provider and
--   /api/process-task-notifications continue to ignore the column.
--   /api/admin/kaam/reprocess proxies through process-task-notifications
--   so its behaviour is identical too. WhatsApp template, provider
--   dashboard, plan rules, and matching writes into provider_task_matches
--   are all unaffected.
--
-- ──────────────────────────────────────────────────────────────────────
-- Rollback posture
-- ──────────────────────────────────────────────────────────────────────
--   No DOWN migration. Supersession only. If PR-A needs to be
--   rolled back before PR-B/PR-C land, the column can be left in
--   place — every reader tolerates NULL, no writer is gated on it.


ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS region_code TEXT;


DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tasks_region_code_fkey'
       AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_region_code_fkey
      FOREIGN KEY (region_code) REFERENCES public.service_regions(region_code);
  END IF;
END $$;


CREATE INDEX IF NOT EXISTS tasks_region_code_idx
  ON public.tasks (region_code)
  WHERE region_code IS NOT NULL;


-- NOT NULL deliberately NOT set. PR-B starts populating region_code
-- on new submits; until backfill (if any) completes, every existing
-- row remains NULL. Strict matching in PR-C treats NULL as
-- "no providers eligible" — that's the new business rule, not an error.
