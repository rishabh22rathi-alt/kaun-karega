-- 20260526120000_capture_runtime_schemas.sql
--
-- Phase 0.4 capture migration. Mirrors prod schema for three tables
-- that have been in production use for months but have no CREATE TABLE
-- in this repository:
--
--   • tasks
--   • provider_areas
--   • provider_task_matches
--
-- This is the same trap the 20260525120000_service_regions_init.sql
-- preamble describes for the service_regions / *_areas / *_aliases
-- tables. The fix for the catalog tables landed there; this file
-- closes the equivalent gap for the runtime/matching tables.
--
-- ──────────────────────────────────────────────────────────────────────
-- Source of schema
-- ──────────────────────────────────────────────────────────────────────
--   No prod pg_dump was available when this file was drafted. The
--   shapes below are derived ONLY from what application/test code
--   provably reads or writes:
--
--     web/e2e/chat-notification-logs.spec.ts:200-207    (tasks insert)
--     web/e2e/full-system-core-flow.spec.ts:286-302     (provider_areas, provider_task_matches)
--     web/app/api/find-provider/route.ts:181-189        (provider_areas.area read)
--     web/app/api/process-task-notifications/route.ts:219-223, 405-416
--                                                       (matching + upsert)
--     web/lib/admin/adminAreaMappings.ts:231-313        (provider_areas insert)
--     web/lib/admin/adminProviderReads.ts:257-268       (provider_areas delete+insert)
--
--   The (task_id, provider_id) UNIQUE on provider_task_matches is
--   proven by the runtime upsert call:
--
--     .upsert(..., { onConflict: "task_id,provider_id", ignoreDuplicates: true })
--
--   No prod constraint can be inferred from `ilike` on `area` columns,
--   so no UNIQUE / CHECK is declared on free-text area fields.
--
-- ──────────────────────────────────────────────────────────────────────
-- Safety posture
-- ──────────────────────────────────────────────────────────────────────
--   • Every statement is idempotent (CREATE … IF NOT EXISTS).
--   • No ALTER, DROP, INSERT, UPDATE, DELETE, TRUNCATE.
--   • No RLS changes, no policies, no GRANT / REVOKE.
--   • No triggers, no functions, no extensions.
--   • No cross-file foreign keys (provider_task_matches does NOT
--     declare an FK to tasks(task_id) or providers(provider_id) here,
--     even though those FKs likely exist in prod; declaring them
--     here would couple capture files and is deferred to a future
--     reconcile migration once a prod schema dump is available).
--   • Production: every statement is a NO-OP because the three
--     tables already exist. Postgres skips the entire CREATE TABLE
--     when the table is present — no column, constraint, or index
--     is added.
--   • Fresh environments: this is the only place these three tables
--     get created. The declared shape is the conservative minimum
--     that supports the runtime code that already exists in repo.
--
-- ──────────────────────────────────────────────────────────────────────
-- Known unknowns (deliberately not declared here)
-- ──────────────────────────────────────────────────────────────────────
--   tasks
--     • Additional columns almost certainly exist in prod
--       (created_at, updated_at, expires_at, closed_at, …). They
--       cannot be confirmed from the audited code paths and are
--       therefore omitted. A follow-up reconcile migration will
--       ADD COLUMN IF NOT EXISTS each one after a prod dump.
--     • A CHECK on status is plausible — observed values include
--       'submitted', 'matched', 'responded' — but the full enum is
--       unknown. No CHECK is declared.
--     • Indexes on tasks (status, created_at, phone, …) are unknown
--       and not declared.
--
--   provider_areas
--     • Whether prod has UNIQUE(provider_id, area) is unknown.
--       Runtime canonicalization at adminProviderReads.ts:257-268
--       does delete-then-insert, which is consistent with either
--       presence or absence. We deliberately do NOT declare the
--       UNIQUE here; a reconcile migration will add it
--       ADD CONSTRAINT IF NOT EXISTS once the prod posture is
--       confirmed.
--     • Additional timestamp columns and indexes are unknown.
--
--   provider_task_matches
--     • Whether (task_id, provider_id) is the PRIMARY KEY in prod
--       or merely a secondary UNIQUE cannot be proven from upsert
--       semantics alone. We declare it as a UNIQUE CONSTRAINT
--       (named pkmatches_task_provider_uq). No PRIMARY KEY is
--       declared here.
--     • A CHECK on match_status is plausible — observed values
--       include 'matched', 'responded' — but the full enum is
--       unknown. No CHECK is declared.
--     • FKs to tasks(task_id) and providers(provider_id) likely
--       exist in prod; not declared here per the no-cross-file-FK
--       rule.
--     • Additional columns (notified_at, last_response_at, …) are
--       unknown.
--
-- ──────────────────────────────────────────────────────────────────────
-- Rollback posture
-- ──────────────────────────────────────────────────────────────────────
--   These three tables are not rollback-able from prod because this
--   migration never wrote to prod. The only meaningful "rollback"
--   is supersession: if a declaration here is later found to be
--   wrong, a new migration named <timestamp>_reconcile_<table>.sql
--   adds the correct shape via ALTER … IF NOT EXISTS. This file is
--   never amended in place once merged.
--
--   No DOWN migration exists. A DROP statement landing in prod via
--   a misconfigured migration runner is the worst-case failure
--   mode for capture work; this file deliberately provides no
--   such statement.
--
-- ──────────────────────────────────────────────────────────────────────
-- Production no-op guarantee
-- ──────────────────────────────────────────────────────────────────────
--   The three tables already exist in production. CREATE TABLE IF
--   NOT EXISTS skips the entire statement when the table is
--   present, including every column, constraint, and default
--   inside it. No prod row, index, constraint, or policy is
--   touched by applying this migration.
-- ──────────────────────────────────────────────────────────────────────


-- ──────────────────────────────────────────────────────────────────────
-- tasks
--
-- Customer-submitted job requests. Matching writes provider rows in
-- provider_task_matches; outbound notifications, chats, and reviews
-- all key off tasks.task_id.
--
-- Columns declared here are the minimum proven set. Prod almost
-- certainly has more (see "Known unknowns" above).
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  task_id   TEXT PRIMARY KEY,
  category  TEXT,
  area      TEXT,
  details   TEXT,
  phone     TEXT,
  status    TEXT
);


-- ──────────────────────────────────────────────────────────────────────
-- provider_areas
--
-- Flat (provider_id, area) coverage list. Matching joins this table
-- against tasks via `ilike` on the area column.
--
-- No UNIQUE constraint is declared. Whether prod has UNIQUE
-- (provider_id, area) is one of the open questions for the
-- follow-up reconcile migration.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.provider_areas (
  provider_id  TEXT NOT NULL,
  area         TEXT NOT NULL
);


-- ──────────────────────────────────────────────────────────────────────
-- provider_task_matches
--
-- Derived join rows produced by process-task-notifications. Each row
-- represents a (task, provider) pairing that survived the area +
-- category filter.
--
-- The UNIQUE on (task_id, provider_id) is the one constraint we can
-- prove from runtime code, via:
--   .upsert(..., { onConflict: "task_id,provider_id", ignoreDuplicates: true })
-- — Supabase upsert is a no-op without a matching unique key in
-- prod, so this constraint must exist there. We declare it as a
-- named UNIQUE rather than a PRIMARY KEY because we cannot prove
-- which it is in prod.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.provider_task_matches (
  task_id       TEXT NOT NULL,
  provider_id   TEXT NOT NULL,
  category      TEXT,
  area          TEXT,
  match_status  TEXT,
  CONSTRAINT pkmatches_task_provider_uq UNIQUE (task_id, provider_id)
);
