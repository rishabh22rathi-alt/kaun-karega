-- Durable backing store for admin dashboard snapshot caches.
--
-- Stage 1 of the admin-dashboard-snapshot-cache rollout. The first
-- caller is /api/admin/provider-stats (provider tile counts that
-- currently take 4.9-6.5 s on every tab open). Subsequent stages
-- (area stats, category stats, reports, push analytics, users, kaam)
-- share this table verbatim — only the cache_key + ttl_seconds vary.
--
-- Design choice — Supabase row vs in-memory only:
--   In-memory caches are wiped on every Vercel Lambda cold start, so
--   a "6-hour TTL" effectively degrades to whatever the instance
--   lifetime happens to be (~minutes). A persisted row survives cold
--   starts and is shared across instances. The route layer keeps a
--   thin per-instance L1 Map on top (web/lib/admin/snapshotCache.ts)
--   so burst reads from one admin clicking around within a few
--   seconds don't hit the DB repeatedly.
--
-- Why JSONB payload instead of a typed shape:
--   Each cache_key serves a different endpoint with a different
--   response shape (provider stats now, area stats next, reports
--   after that). One generic row schema = one wrapper helper =
--   one place to evolve later. The payload is opaque to this table
--   and validated only by the calling route.
--
-- Safety posture:
--   • CREATE TABLE IF NOT EXISTS — second-run safe.
--   • CREATE INDEX IF NOT EXISTS — second-run safe.
--   • No ALTER on existing tables, no DROP, no DELETE/TRUNCATE.
--   • RLS enabled, no policies — service-role only (mirrors
--     provider_change_log / payment_orders / payment_webhook_events).
--     Every admin API route already uses adminSupabase
--     (web/lib/supabase/admin.ts) which holds the service-role key,
--     so reads and writes both bypass RLS correctly.
--
-- Rollback posture: no DOWN migration. Supersession only. If a key's
-- shape needs to change, write a new key (e.g. provider_stats_v2)
-- alongside and migrate readers; never mutate the JSONB shape in place
-- because stale rows from an older deploy would silently mis-read.
--
-- Production effect:
--   First run: creates table + index. No existing rows touched.
--   Second run: every statement is a no-op (IF NOT EXISTS).
--   No application code change is gated on this migration — the cache
--   helper soft-fails to compute() on any DB error, so a partial
--   deploy where the table doesn't exist yet falls back to the
--   pre-cache behavior (same as today's slow path).

CREATE TABLE IF NOT EXISTS public.admin_cached_snapshots (
  -- Stable identifier for the cached dataset. Conventions:
  --   • Bare key for a singleton snapshot: "provider_stats"
  --   • Dotted suffix for parameterised snapshots:
  --       "area_stats.JOD",
  --       "provider_stats.by_category.verified",
  --       "reports.kaam_demand.20260501.20260531"
  -- Never put PII or admin identity in the key — that lives in
  -- computed_by.
  cache_key             TEXT        PRIMARY KEY,

  -- Opaque per-key. The calling route serialises its `data` block
  -- here and is responsible for re-validating shape on read.
  payload               JSONB       NOT NULL,

  -- When this snapshot was computed. Drives the "Last updated" UI
  -- on each tab. Equals NOW() at insert/update.
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- When the row is considered stale. Calling helper compares
  -- against now() on each read. expires_at = computed_at +
  -- ttl_seconds, written explicitly so any later TTL change is
  -- visible row-by-row instead of inferred.
  expires_at            TIMESTAMPTZ NOT NULL,

  -- Original TTL the row was written with. Surfaced to the client
  -- so the UI can render "Auto refreshes every 6 hours" without
  -- knowing the constant.
  ttl_seconds           INTEGER     NOT NULL,

  -- Admin phone that triggered the most recent refresh. NULL on
  -- automatic-on-miss recomputes; non-null only when a human
  -- clicked Refresh (?refresh=1). Audit trail, no enforcement.
  computed_by           TEXT,

  -- How long compute() took the last time it ran. Useful for the
  -- [admin-perf] log stream and for the eventual "is this cache
  -- still worth keeping?" question.
  computed_duration_ms  INTEGER
);

-- Indexes the helper actually uses: lookup is always by PK
-- (cache_key) which already has the implicit unique index from
-- PRIMARY KEY, so no manual index needed there. expires_at sees
-- range scans only from a future cleanup job (out of scope here)
-- and from any "show all stale snapshots" admin diagnostic, so the
-- index is cheap insurance.
CREATE INDEX IF NOT EXISTS idx_admin_cached_snapshots_expires_at
  ON public.admin_cached_snapshots (expires_at);
