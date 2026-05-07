-- Alias review + provider notifications
--
-- Two changes:
-- 1. ALTER TABLE category_aliases ADD COLUMN submitted_by_provider_id text
--    Lets us scope alias_approved / alias_rejected notifications to the
--    actual submitter, not all providers in the canonical category.
--    Existing rows stay NULL — admin actions on legacy rows fall back to a
--    canonical-wide broadcast (see /api/admin/aliases).
--
-- 2. CREATE TABLE provider_notifications
--    Durable backing store for the bell UI. Read by
--    /api/provider/notifications, written by admin alias approve/reject and
--    eventually any future event types (job, chat, etc.) that want
--    persistent rather than derived notifications.

-- 1. Track who submitted each alias.
ALTER TABLE public.category_aliases
  ADD COLUMN IF NOT EXISTS submitted_by_provider_id text DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_category_aliases_submitted_by
  ON public.category_aliases (submitted_by_provider_id)
  WHERE submitted_by_provider_id IS NOT NULL;

-- Speeds the admin "pending review" listing.
CREATE INDEX IF NOT EXISTS idx_category_aliases_active
  ON public.category_aliases (active, created_at DESC);

-- 2. Provider notifications backing store.
CREATE TABLE IF NOT EXISTS public.provider_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   text NOT NULL,
  type          text NOT NULL,                  -- e.g. 'alias_approved', 'alias_rejected'
  title         text NOT NULL,
  message       text NOT NULL DEFAULT '',
  href          text DEFAULT NULL,              -- deep-link for tap-through
  payload_json  jsonb DEFAULT NULL,             -- structured event data
  seen_at       timestamptz DEFAULT NULL,       -- NULL = unseen, contributes to badge
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Most queries are "rows for this provider, newest first."
CREATE INDEX IF NOT EXISTS idx_provider_notifications_provider_created
  ON public.provider_notifications (provider_id, created_at DESC);

-- Partial index for unseen-count queries.
CREATE INDEX IF NOT EXISTS idx_provider_notifications_unseen
  ON public.provider_notifications (provider_id)
  WHERE seen_at IS NULL;

COMMENT ON TABLE public.provider_notifications IS
  'Durable provider notifications. Bell UI reads from here. seen_at NULL = unseen.';
