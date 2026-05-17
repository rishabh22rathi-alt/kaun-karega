-- Phase 7D.1: in-app announcement banner foundation. Migration only —
-- no application code reads or writes these columns yet. Existing
-- rows default to send_push=true, show_as_banner=false, so every
-- previously-authored announcement keeps its Phase 7B/7C behavior
-- unchanged (push-only, no banner surface).
--
-- Banner emission is independent of push emission, gated by two new
-- booleans on the same admin_announcements row:
--   send_push      — when true, the worker fan-out runs (existing path)
--   show_as_banner — when true, the banner reader API surfaces this row
--
-- A future code change will read these fields. Today nothing does —
-- this migration is purely additive at the schema layer.

-- ───────────────────────────────────────────────────────────────────
-- 1. New columns on admin_announcements
-- ───────────────────────────────────────────────────────────────────

alter table public.admin_announcements
  add column if not exists send_push boolean not null default true;

alter table public.admin_announcements
  add column if not exists show_as_banner boolean not null default false;

alter table public.admin_announcements
  add column if not exists banner_priority integer not null default 0;

alter table public.admin_announcements
  add column if not exists banner_starts_at timestamptz null;

alter table public.admin_announcements
  add column if not exists banner_expires_at timestamptz null;

alter table public.admin_announcements
  add column if not exists banner_dismissible boolean not null default true;

alter table public.admin_announcements
  add column if not exists banner_cta_label text null
    check (
      banner_cta_label is null
      or char_length(banner_cta_label) between 1 and 40
    );

-- ───────────────────────────────────────────────────────────────────
-- 2. Cross-column CHECK constraints
--
-- Added as separate named constraints so they can be diagnosed
-- individually if a future write violates one of them.
-- ───────────────────────────────────────────────────────────────────

-- 2a. At least one emission surface must be enabled. An announcement
--     that neither pushes nor banners is pointless and was likely a
--     bug in whatever code path produced it.
alter table public.admin_announcements
  add constraint admin_announcements_emission_at_least_one
  check (send_push = true OR show_as_banner = true);

-- 2b. Banner timing fields are meaningful only when the banner is on.
--     Prevents a future code path from accidentally leaking timing
--     values into push-only rows.
alter table public.admin_announcements
  add constraint admin_announcements_banner_timing_requires_banner
  check (
    show_as_banner = true
    OR (banner_starts_at is null AND banner_expires_at is null)
  );

-- 2c. Time window sanity. If both timing fields are set, the start
--     must be strictly earlier than the expiry.
alter table public.admin_announcements
  add constraint admin_announcements_banner_time_window
  check (
    banner_starts_at is null
    OR banner_expires_at is null
    OR banner_starts_at < banner_expires_at
  );

-- 2d. A CTA button can only be rendered when there is a destination
--     to navigate to. If banner_cta_label is set, deep_link must
--     also be set.
alter table public.admin_announcements
  add constraint admin_announcements_banner_cta_requires_deep_link
  check (
    banner_cta_label is null
    OR deep_link is not null
  );

-- ───────────────────────────────────────────────────────────────────
-- 3. Partial index for the banner read API
--
-- The banner reader will run a query like:
--   SELECT ... FROM admin_announcements
--   WHERE show_as_banner = true
--     AND status IN ('approved','queued','sending','sent','failed')
--     AND (banner_starts_at IS NULL OR banner_starts_at <= now())
--     AND (banner_expires_at IS NULL OR banner_expires_at > now())
--   ORDER BY banner_priority DESC, created_at DESC;
--
-- Partial index keeps the index tiny — most rows have show_as_banner
-- false and are irrelevant to banner queries.
-- ───────────────────────────────────────────────────────────────────

create index if not exists idx_admin_announcements_banner_active
  on public.admin_announcements (banner_priority desc, created_at desc)
  where show_as_banner = true;

-- ───────────────────────────────────────────────────────────────────
-- 4. Per-actor dismissal table
--
-- One row per (announcement, actor) pair. Composite PK provides
-- idempotency on the dismiss POST (ON CONFLICT DO NOTHING).
-- ON DELETE CASCADE on the FK keeps the table self-maintaining when
-- an announcement is hard-deleted in admin tooling.
--
-- actor_key convention mirrors notification_preferences:
--   actor_type='user'     → canonical phone "91XXXXXXXXXX"
--   actor_type='provider' → providers.provider_id
--   actor_type='admin'    → canonical phone "91XXXXXXXXXX"
-- ───────────────────────────────────────────────────────────────────

create table if not exists public.announcement_dismissals (
  announcement_id uuid not null
    references public.admin_announcements(id) on delete cascade,
  actor_type text not null
    check (actor_type in ('user', 'provider', 'admin')),
  actor_key text not null check (char_length(actor_key) > 0),
  dismissed_at timestamptz not null default now(),
  primary key (announcement_id, actor_type, actor_key)
);

-- Hot path: "what has this actor already dismissed?" — used by the
-- banner reader as a NOT EXISTS subquery on every page load.
create index if not exists idx_announcement_dismissals_actor
  on public.announcement_dismissals (actor_type, actor_key);

alter table public.announcement_dismissals enable row level security;
-- No policies — service-role admin client only. Same pattern as
-- push_logs / native_push_devices / notification_preferences /
-- admin_announcements / admin_announcement_jobs.

-- ───────────────────────────────────────────────────────────────────
-- 5. Doc comments
-- ───────────────────────────────────────────────────────────────────

comment on column public.admin_announcements.send_push is
  'Phase 7D.1: when true, the worker fan-out emits FCM pushes for this announcement (existing Phase 7B/7C behavior). When false, push is skipped and only the banner surface (if enabled) is used. Default true for backwards compatibility with all existing rows.';

comment on column public.admin_announcements.show_as_banner is
  'Phase 7D.1: when true, the banner read API surfaces this announcement to actors who match the audience and have not dismissed it. Default false — existing rows are push-only.';

comment on column public.admin_announcements.banner_priority is
  'Phase 7D.1: higher value wins when multiple banners match the same actor. Ties broken by created_at DESC.';

comment on column public.admin_announcements.banner_starts_at is
  'Phase 7D.1: banner becomes visible at this time. NULL = visible immediately when status is post-approval. Doubles as the future scheduling primitive.';

comment on column public.admin_announcements.banner_expires_at is
  'Phase 7D.1: banner disappears after this time. NULL = no expiry. Read API filters on banner_expires_at > now().';

comment on column public.admin_announcements.banner_dismissible is
  'Phase 7D.1: when false, the banner renders without a close button. Reserve for critical announcements only.';

comment on column public.admin_announcements.banner_cta_label is
  'Phase 7D.1: optional CTA button text rendered on the banner. Requires deep_link to be non-null (CHECK enforced). Max 40 chars.';

comment on table public.announcement_dismissals is
  'Phase 7D.1: per-actor banner dismissal log. Used by the banner read API as a NOT EXISTS filter so dismissed banners stop appearing for the same actor. Composite PK makes the dismiss POST idempotent.';
