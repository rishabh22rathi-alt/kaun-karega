-- Admin announcement jobs — Phase 7B (queue + worker cursor table).
--
-- Separate table from admin_announcements so the cursor / claim lease /
-- attempt count can churn without touching the announcement row that the
-- composer + analytics surfaces read. One job per announcement,
-- enforced by the UNIQUE constraint below.
--
-- Worker contract (web/lib/announcements/worker.ts):
--   1. Claim oldest queued|processing job whose claim has expired.
--   2. Send ONE batch (size <= 450, FCM ceiling is 500).
--   3. Advance next_offset; write push_logs; release claim.
--   4. On full completion → status='done'; announcement → 'sent'.
--   5. On observed cancel (announcement.status='canceling') → status='done';
--      announcement → 'canceled'. In-flight FCM calls in the current
--      batch cannot be recalled (documented constraint).

create table public.admin_announcement_jobs (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null
    references public.admin_announcements(id) on delete cascade,

  -- Worker lease so a crashed worker eventually unblocks. claimed_by is
  -- a free-form identifier (env-derived for prod, "manual" for ad-hoc
  -- ticks); the only constraint we enforce is the lease expiry.
  claimed_by text null,
  claimed_at timestamptz null,
  claim_expires_at timestamptz null,

  -- Cursor for resumable batching. native_push_devices is paged by
  -- ORDER BY id LIMIT batch_size OFFSET next_offset. ORDER BY id gives
  -- a stable cursor that survives row insertions during the broadcast.
  next_offset int not null default 0 check (next_offset >= 0),
  batch_size int not null default 450 check (batch_size between 1 and 500),
  total_recipients int null,

  -- Job-side lifecycle. Tracks worker state independent of
  -- announcement.status so a crashed worker can resume without
  -- touching the announcement row.
  status text not null default 'queued' check (
    status in ('queued', 'processing', 'paused', 'done', 'failed')
  ),
  attempts int not null default 0 check (attempts >= 0),
  last_error text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One job per announcement. The queue route relies on this for
  -- idempotency: a double-click on "Queue Send" still produces a
  -- single job row.
  unique (announcement_id)
);

-- Hot path: worker tick scans for the next claimable job. Partial
-- index keeps it small — most jobs after a few weeks are 'done'.
create index if not exists idx_admin_announcement_jobs_queue
  on public.admin_announcement_jobs (status, created_at)
  where status in ('queued', 'processing');

-- Touch updated_at on every UPDATE.
create or replace function public.touch_admin_announcement_jobs_updated_at()
returns trigger language plpgsql as $$
begin
  if new.updated_at is null or new.updated_at = old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_admin_announcement_jobs_touch_updated_at
  on public.admin_announcement_jobs;
create trigger trg_admin_announcement_jobs_touch_updated_at
  before update on public.admin_announcement_jobs
  for each row execute function public.touch_admin_announcement_jobs_updated_at();

alter table public.admin_announcement_jobs enable row level security;
-- No policies — service-role admin client only.

comment on table public.admin_announcement_jobs is
  'Worker cursor for admin announcement broadcasts. One row per announcement, created at queue time, advanced by /api/admin/announcements/worker/tick. Phase 7B: admins-only audience by hard policy.';
