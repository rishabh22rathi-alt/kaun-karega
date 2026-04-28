-- =============================================================================
-- Local Needs (experimental "Jodhpur Needs" bulletin) — initial schema.
--
-- Apply ONCE via Supabase SQL editor before the /local-needs feature can run.
-- Idempotent — safe to re-run (every CREATE / ALTER / INDEX uses IF NOT EXISTS).
--
-- Independent of the existing public.needs / public.need_chat_* tables. The
-- old /i-need flow continues to use those — this experiment lives alongside.
-- =============================================================================

-- ─── Needs (bulletin posts) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.local_needs (
  jneed_id              text PRIMARY KEY,                  -- "LN-0001"
  poster_phone          text NOT NULL,                     -- 10-digit; never exposed unless show_contact_publicly = true and is_anonymous = false (and viewer is not poster/admin override)
  display_name          text NOT NULL DEFAULT '',          -- empty when is_anonymous = true
  is_anonymous          boolean NOT NULL DEFAULT false,    -- masks display_name + phone unconditionally for non-poster/non-admin viewers
  show_contact_publicly boolean NOT NULL DEFAULT false,    -- exposes phone only when also non-anonymous
  body                  text NOT NULL,                     -- "What do you need?"
  areas                 text[] NOT NULL,                   -- 1..5 canonical area names (validated app-side)
  category              text NOT NULL DEFAULT '',          -- optional
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','hidden')),
  valid_days            integer NOT NULL DEFAULT 7 CHECK (valid_days BETWEEN 1 AND 30),
  expires_at            timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Feed query selects open + non-expired rows ordered by created_at DESC. The
-- partial index covers the only hot path; expires_at is the second column so
-- the planner can range-scan it when filtering "now() < expires_at".
CREATE INDEX IF NOT EXISTS local_needs_open_expires_idx
  ON public.local_needs (created_at DESC, expires_at)
  WHERE status = 'open';

-- "My posts" lookups + admin queries by poster.
CREATE INDEX IF NOT EXISTS local_needs_poster_phone_idx
  ON public.local_needs (poster_phone);

-- Areas filter uses `areas && ARRAY['Sardarpura']` — GIN is the right index for
-- text[] containment checks. Without it the planner does a sequential scan.
CREATE INDEX IF NOT EXISTS local_needs_areas_gin_idx
  ON public.local_needs USING GIN (areas);

-- ─── Comments (public + private replies) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.local_need_comments (
  comment_id    text PRIMARY KEY,                          -- "LNC-0001"
  jneed_id      text NOT NULL REFERENCES public.local_needs(jneed_id) ON DELETE CASCADE,
  author_phone  text NOT NULL,
  author_name   text NOT NULL DEFAULT '',
  is_private    boolean NOT NULL DEFAULT false,            -- true => visible to poster, author, admin only
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS local_need_comments_jneed_created_idx
  ON public.local_need_comments (jneed_id, created_at);

-- =============================================================================
-- Notes for application code (not enforced in DB):
--   - Phone visibility:
--       admin viewer            -> always sees poster_phone
--       viewer.phone == poster  -> always sees poster_phone
--       is_anonymous = true     -> phone hidden regardless of show_contact_publicly
--       show_contact_publicly   -> phone exposed only when above are false AND is_anonymous = false
--   - Anonymous masking:
--       display_name and poster_phone are stripped before serialization for
--       non-poster, non-admin viewers when is_anonymous = true.
--   - Expiry:
--       feed endpoints MUST filter expires_at > now() AND status = 'open'.
--   - Private comments:
--       returned only to poster of the need, author of the comment, or admin.
-- =============================================================================
