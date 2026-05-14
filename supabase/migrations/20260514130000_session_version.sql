-- Single-active-session enforcement.
--
-- Adds profiles.session_version (integer, default 0) and a transactional
-- RPC bump_session_version(p_phone) that atomically increments and
-- returns the new counter for a given phone.
--
-- How the app uses it:
--   1. /api/verify-otp completes OTP check, upserts profiles, then calls
--      bump_session_version(phone). The returned integer is baked into
--      the signed kk_auth_session cookie as `sver`.
--   2. Every protected server read (getAuthSession with validateVersion)
--      compares the cookie's `sver` against the row's session_version.
--      A mismatch means a newer login has happened on another device,
--      so the cookie is treated as stale and the request is unauthorized.
--   3. Normal logout DOES NOT bump the counter — it only clears cookies
--      on the calling browser, so other devices the user authorised
--      stay logged in.
--
-- Why a SECURITY DEFINER function:
--   - The service-role key already has UPDATE on profiles, so the
--     function's privilege need is satisfied by callers using the service
--     role. Defining it SECURITY DEFINER keeps the door open for a future
--     anon-key path (e.g. signed RPC from an Edge Function) without a
--     second migration.
--   - The function does its own upsert-style guard so a phone that has
--     never had a profiles row (extreme race during a brand-new signup)
--     still gets a deterministic version >= 1 returned.
--
-- Rollout safety:
--   - Default 0 means existing rows are valid baseline. Cookies issued
--     before this migration carry no `sver` field; the application
--     treats missing-`sver` as the legacy compatibility case (still
--     accepted) so no one is auto-logged-out by the deploy itself.
--   - The next time a user re-authenticates with OTP, their cookie
--     picks up a real `sver` (>= 1) and the new-device invalidation
--     rule applies from then on.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.session_version IS
  'Monotonic counter bumped on each successful OTP login. The signed kk_auth_session cookie carries a snapshot; mismatches invalidate the cookie.';

-- Atomic bump-and-return. Always succeeds for a phone that has a
-- profiles row (the /api/verify-otp flow upserts before calling this).
-- The COALESCE guards the unlikely race where the upsert and the bump
-- interleave such that the row appears here without the new version
-- yet — in that case we treat the baseline as 0 and return 1.
CREATE OR REPLACE FUNCTION public.bump_session_version(p_phone text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new integer;
BEGIN
  IF p_phone IS NULL OR length(btrim(p_phone)) = 0 THEN
    RAISE EXCEPTION 'bump_session_version: phone is required';
  END IF;

  UPDATE public.profiles
     SET session_version = COALESCE(session_version, 0) + 1
   WHERE phone = p_phone
  RETURNING session_version INTO v_new;

  IF v_new IS NULL THEN
    -- Row didn't exist yet (race with the profile upsert in
    -- /api/verify-otp). Create it with version 1 so the caller still
    -- gets a deterministic, monotonic value to embed in the cookie.
    INSERT INTO public.profiles (phone, role, session_version, last_login_at)
    VALUES (p_phone, 'user', 1, now())
    ON CONFLICT (phone) DO UPDATE
       SET session_version = COALESCE(public.profiles.session_version, 0) + 1
    RETURNING session_version INTO v_new;
  END IF;

  RETURN v_new;
END;
$$;

COMMENT ON FUNCTION public.bump_session_version(text) IS
  'Atomically increments profiles.session_version for the given phone and returns the new value. Used by /api/verify-otp to issue cookies that invalidate older device sessions.';

GRANT EXECUTE ON FUNCTION public.bump_session_version(text) TO service_role;
