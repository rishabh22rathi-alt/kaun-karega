-- Duplicate-name review columns on public.providers
-- Apply once via Supabase SQL editor. Safe to re-run (IF NOT EXISTS guards).
-- Added columns are nullable — existing rows become NULL meaning "not flagged".

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS duplicate_name_review_status text,
  ADD COLUMN IF NOT EXISTS duplicate_name_matches text[],
  ADD COLUMN IF NOT EXISTS duplicate_name_flagged_at timestamptz,
  ADD COLUMN IF NOT EXISTS duplicate_name_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS duplicate_name_admin_phone text,
  ADD COLUMN IF NOT EXISTS duplicate_name_reason text;

-- Values duplicate_name_review_status can take (enforced application-side):
--   NULL        = never flagged
--   'pending'   = awaiting admin decision; badge suppressed
--   'cleared'   = admin Approved
--   'separate'  = admin Marked Legit Separate
--   'rejected'  = admin Rejected (paired with providers.status='Blocked')

-- Partial index keeps the admin queue load cheap.
CREATE INDEX IF NOT EXISTS providers_duplicate_name_review_pending_idx
  ON public.providers (duplicate_name_review_status)
  WHERE duplicate_name_review_status = 'pending';
