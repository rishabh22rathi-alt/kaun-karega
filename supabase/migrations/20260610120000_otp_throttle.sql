-- OTP throttle / lockout state (Launch Fix — Blocker 2).
--
-- Additive only. Does NOT touch the existing (out-of-band) otp_requests
-- table or the verify_otp_and_get_phone RPC. This migration adds a
-- dedicated per-phone throttle table plus atomic RPCs that the canonical
-- routes call ONLY when their guard flag is on:
--   /api/send-whatsapp-otp  → otp_note_send            (KK_OTP_SEND_GUARD_ENABLED)
--   /api/verify-otp         → otp_check_locked,
--                             otp_note_verify_failure,
--                             otp_clear_verify          (KK_OTP_VERIFY_GUARD_ENABLED)
--
-- Thresholds (phone-only; no per-IP):
--   Send:   >= 30s between sends; <= 5 sends / rolling 60 min.
--   Verify: <= 5 failed attempts / rolling 10 min -> lock 15 min;
--           a successful verify clears the counter + lock.
--
-- All RPCs are atomic (single-statement upserts / row locks) so concurrent
-- serverless invocations cannot race past a limit. Functions never raise on
-- normal input; the route layer additionally fails OPEN if a call errors.

create table if not exists public.otp_throttle (
  phone               text primary key,
  send_count          integer     not null default 0,
  send_window_start   timestamptz,
  last_send_at        timestamptz,
  verify_fail_count   integer     not null default 0,
  verify_window_start timestamptz,
  locked_until        timestamptz,
  updated_at          timestamptz not null default now()
);

comment on table public.otp_throttle is
  'Per-phone OTP send/verify throttle + lockout state. Written only by the otp_* RPCs in this migration. Independent of otp_requests.';

-- ── Tunables (kept inline; change here if thresholds ever move) ──────────────
--   send:   MIN_INTERVAL=30s, WINDOW=60min, MAX=5
--   verify: WINDOW=10min, MAX_FAILURES=5, LOCK=15min

-- otp_note_send: records a send attempt and returns whether it is allowed.
create or replace function public.otp_note_send(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now        timestamptz := now();
  v_row        public.otp_throttle;
  v_retry      integer := 0;
begin
  if p_phone is null or length(trim(p_phone)) = 0 then
    -- Defensive: never block on bad input (route normalizes first).
    return jsonb_build_object('allowed', true, 'retry_after_seconds', 0, 'reason', 'no_phone');
  end if;

  select * into v_row from public.otp_throttle where phone = p_phone for update;

  if not found then
    insert into public.otp_throttle (phone, send_count, send_window_start, last_send_at, updated_at)
    values (p_phone, 1, v_now, v_now, v_now);
    return jsonb_build_object('allowed', true, 'retry_after_seconds', 0, 'reason', 'allowed');
  end if;

  -- Minimum interval between sends (30s).
  if v_row.last_send_at is not null and v_row.last_send_at + interval '30 seconds' > v_now then
    v_retry := ceil(extract(epoch from (v_row.last_send_at + interval '30 seconds' - v_now)))::int;
    return jsonb_build_object('allowed', false, 'retry_after_seconds', greatest(v_retry, 1), 'reason', 'min_interval');
  end if;

  -- Roll the 60-minute window if it has elapsed.
  if v_row.send_window_start is null or v_row.send_window_start < v_now - interval '60 minutes' then
    update public.otp_throttle
      set send_count = 1, send_window_start = v_now, last_send_at = v_now, updated_at = v_now
      where phone = p_phone;
    return jsonb_build_object('allowed', true, 'retry_after_seconds', 0, 'reason', 'allowed');
  end if;

  -- Hourly cap (5 per window).
  if v_row.send_count >= 5 then
    v_retry := ceil(extract(epoch from (v_row.send_window_start + interval '60 minutes' - v_now)))::int;
    return jsonb_build_object('allowed', false, 'retry_after_seconds', greatest(v_retry, 1), 'reason', 'hourly_cap');
  end if;

  update public.otp_throttle
    set send_count = v_row.send_count + 1, last_send_at = v_now, updated_at = v_now
    where phone = p_phone;
  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0, 'reason', 'allowed');
end;
$$;

-- otp_check_locked: read-only lock check (does not mutate counters).
create or replace function public.otp_check_locked(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now   timestamptz := now();
  v_row   public.otp_throttle;
  v_retry integer := 0;
begin
  if p_phone is null or length(trim(p_phone)) = 0 then
    return jsonb_build_object('locked', false, 'retry_after_seconds', 0);
  end if;

  select * into v_row from public.otp_throttle where phone = p_phone;
  if not found or v_row.locked_until is null or v_row.locked_until <= v_now then
    return jsonb_build_object('locked', false, 'retry_after_seconds', 0);
  end if;

  v_retry := ceil(extract(epoch from (v_row.locked_until - v_now)))::int;
  return jsonb_build_object('locked', true, 'retry_after_seconds', greatest(v_retry, 1));
end;
$$;

-- otp_note_verify_failure: records a failed verify; locks after 5 / 10 min.
create or replace function public.otp_note_verify_failure(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    timestamptz := now();
  v_row    public.otp_throttle;
  v_count  integer;
  v_locked boolean := false;
  v_retry  integer := 0;
begin
  if p_phone is null or length(trim(p_phone)) = 0 then
    return jsonb_build_object('locked', false, 'retry_after_seconds', 0);
  end if;

  select * into v_row from public.otp_throttle where phone = p_phone for update;

  if not found then
    insert into public.otp_throttle (phone, verify_fail_count, verify_window_start, updated_at)
    values (p_phone, 1, v_now, v_now);
    return jsonb_build_object('locked', false, 'retry_after_seconds', 0);
  end if;

  -- Roll the 10-minute failure window if it has elapsed.
  if v_row.verify_window_start is null or v_row.verify_window_start < v_now - interval '10 minutes' then
    v_count := 1;
    update public.otp_throttle
      set verify_fail_count = 1, verify_window_start = v_now, updated_at = v_now
      where phone = p_phone;
  else
    v_count := v_row.verify_fail_count + 1;
    update public.otp_throttle
      set verify_fail_count = v_count, updated_at = v_now
      where phone = p_phone;
  end if;

  -- Lock for 15 minutes once the threshold (5) is reached.
  if v_count >= 5 then
    update public.otp_throttle
      set locked_until = v_now + interval '15 minutes', updated_at = v_now
      where phone = p_phone;
    v_locked := true;
    v_retry := 15 * 60;
  end if;

  return jsonb_build_object('locked', v_locked, 'retry_after_seconds', v_retry);
end;
$$;

-- otp_clear_verify: clears failure counter + lock after a successful verify.
create or replace function public.otp_clear_verify(p_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_phone is null or length(trim(p_phone)) = 0 then
    return;
  end if;
  update public.otp_throttle
    set verify_fail_count = 0, verify_window_start = null, locked_until = null, updated_at = now()
    where phone = p_phone;
end;
$$;
