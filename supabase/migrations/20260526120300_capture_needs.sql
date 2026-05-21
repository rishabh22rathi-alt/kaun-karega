-- 20260526120300_capture_needs.sql
--
-- Phase 0.4 capture migration. Promotes the needs table from
-- docs/admin-slice-27-needs.sql into a real Supabase migration so
-- fresh environments can reproduce prod.
--
-- IMPORTANT: needs is distinct from tasks. The two tables serve
-- different product surfaces:
--   • tasks: customer-submitted job requests with matching, alerts,
--     and provider replies.
--   • needs: anonymous/public needs feed (separate flow).
-- Both have an `area TEXT` column but are otherwise unrelated.
-- This file captures `needs` only; `tasks` is captured by
-- 20260526120000_capture_runtime_schemas.sql.
--
-- ──────────────────────────────────────────────────────────────────────
-- Source of schema
-- ──────────────────────────────────────────────────────────────────────
--   docs/admin-slice-27-needs.sql (lines 1-24)
--   Promoted verbatim with schema-qualified names (public.) and
--   IF NOT EXISTS guards added. The check constraint
--   needs_status_check is preserved verbatim from the source doc.
--
-- ──────────────────────────────────────────────────────────────────────
-- Safety posture
-- ──────────────────────────────────────────────────────────────────────
--   • Every statement is idempotent (CREATE … IF NOT EXISTS).
--   • No ALTER, DROP, INSERT, UPDATE, DELETE, TRUNCATE.
--   • No RLS changes, no policies, no GRANT / REVOKE.
--   • No triggers, no functions, no extensions.
--   • No cross-file foreign keys.
--   • Production: NO-OP — the table already exists in prod
--     (operators ran the docs script during the needs feature
--     rollout).
--   • Fresh environments: gain a reproducible baseline.
--
-- ──────────────────────────────────────────────────────────────────────
-- Known unknowns (deliberately not declared here)
-- ──────────────────────────────────────────────────────────────────────
--   • Any extra indexes added in prod after the original docs
--     script ran are not captured here. A reconcile migration will
--     close drift after a prod dump.
--   • The needs_status_check CHECK is preserved from the source
--     doc; if prod has since broadened the allowed status set
--     (e.g. added 'expired'), the CHECK as declared here would
--     reject legitimate prod values on fresh envs. Drift watched.
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
--   needs already exists in production. IF NOT EXISTS makes every
--   CREATE a no-op; no row, index, constraint, or policy is
--   touched.
-- ──────────────────────────────────────────────────────────────────────


-- ──────────────────────────────────────────────────────────────────────
-- needs
--
-- Public/anonymous needs feed. Independent of tasks.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.needs (
  need_id       TEXT        PRIMARY KEY,
  user_phone    TEXT        NOT NULL,
  display_name  TEXT        NOT NULL DEFAULT '',
  is_anonymous  BOOLEAN     NOT NULL DEFAULT false,
  category      TEXT        NOT NULL DEFAULT '',
  area          TEXT        NOT NULL DEFAULT '',
  title         TEXT        NOT NULL DEFAULT '',
  description   TEXT        NOT NULL DEFAULT '',
  status        TEXT        NOT NULL DEFAULT 'open',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_days    INTEGER     NOT NULL DEFAULT 7,
  expires_at    TIMESTAMPTZ NULL,
  completed_at  TIMESTAMPTZ NULL,
  closed_at     TIMESTAMPTZ NULL,
  closed_by     TEXT        NOT NULL DEFAULT '',
  is_hidden     BOOLEAN     NOT NULL DEFAULT false,
  CONSTRAINT needs_status_check CHECK (status IN ('open', 'completed', 'closed'))
);


CREATE INDEX IF NOT EXISTS idx_needs_user_phone_created_at
  ON public.needs (user_phone, created_at DESC);
