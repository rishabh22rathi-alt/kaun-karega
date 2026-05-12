-- Category archive review queue.
--
-- Admin can archive a category to hide it from active user/provider
-- suggestions without destroying its provider mappings. The archive flow:
--   1. Sets categories.active = false for matching rows.
--   2. Sets every category_aliases.canonical_category = name to active=false.
--   3. Snapshots the affected provider_services + category_aliases rows
--      into this table so a future "permanent delete" review still has
--      every row it needs.
--   4. provider_services rows are NOT touched. The snapshot exists so a
--      reviewer can decide later whether to delete them.
--
-- Restore reverses 1-2: flips categories.active back to true (creating
-- the row if it was hard-deleted in between), re-activates each alias
-- from the snapshot (or re-inserts missing ones), and stamps the row as
-- status='restored'. provider_services never needs restoration because
-- archive never deleted from it.
--
-- archived_from_category_id is declared as uuid for forward-compatibility
-- with a future `categories.id` column; today's schema keys categories
-- by name, so this column is always NULL on insert.

CREATE TABLE IF NOT EXISTS public.category_archive_reviews (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name               text NOT NULL,
  archived_from_category_id   uuid DEFAULT NULL,
  provider_count              integer NOT NULL DEFAULT 0,
  alias_count                 integer NOT NULL DEFAULT 0,
  provider_service_rows       jsonb NOT NULL DEFAULT '[]'::jsonb,
  alias_rows                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  archived_by                 text DEFAULT NULL,
  archived_at                 timestamptz NOT NULL DEFAULT now(),
  status                      text NOT NULL DEFAULT 'archived',
  admin_note                  text DEFAULT NULL,
  reviewed_by                 text DEFAULT NULL,
  reviewed_at                 timestamptz DEFAULT NULL,
  review_action               text DEFAULT NULL
);

-- The Archived Categories tab pages by archived_at desc within a status
-- filter (default 'archived', sometimes 'restored').
CREATE INDEX IF NOT EXISTS idx_category_archive_reviews_status_archived_at
  ON public.category_archive_reviews (status, archived_at DESC);

-- Approved-list filtering joins on lower(category_name). Functional
-- index keeps that constant-time even as the table grows.
CREATE INDEX IF NOT EXISTS idx_category_archive_reviews_name_lower
  ON public.category_archive_reviews (lower(category_name));

COMMENT ON TABLE public.category_archive_reviews IS
  'Snapshot table for admin-archived categories. status=archived hides the category from active surfaces and is included in the Archived Categories tab. status=restored means the archive was reverted (categories + aliases re-activated) and the row is kept for audit only.';
