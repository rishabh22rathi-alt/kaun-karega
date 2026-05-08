-- One-time repair: normalize tasks.phone to the canonical 10-digit form.
--
-- Background: the post-A1 cookie carried session.phone as "91XXXXXXXXXX",
-- and submit-request / submit-approval-request inserted that string
-- directly. The /api/my-requests filter normalizes the session phone to
-- 10 digits before the equality check, so newly-created tasks did not
-- appear in the user's dashboard. The application code now writes the
-- 10-digit form. This script repairs rows written before that fix.
--
-- Safe to run more than once: rows already in 10-digit form are skipped
-- by the WHERE clause. Idempotent.
--
-- Recommended sequence:
--   1) Deploy the application fix that stores 10-digit phone on insert.
--   2) Run a dry SELECT to count affected rows:
--        SELECT count(*) FROM tasks WHERE length(phone) = 12 AND phone LIKE '91%';
--   3) Run this UPDATE during a low-traffic window.
--   4) Confirm zero rows match the WHERE clause after the run.

BEGIN;

-- Convert any 12-digit '91XXXXXXXXXX' value to its trailing 10-digit form.
-- Only touches rows that match the migration shape exactly — leaves
-- already-normalized 10-digit rows, NULLs, and other unexpected shapes
-- untouched.
UPDATE tasks
SET    phone = right(phone, 10)
WHERE  phone IS NOT NULL
  AND  length(phone) = 12
  AND  phone LIKE '91%'
  AND  phone ~ '^91[0-9]{10}$';

-- Sanity check: report how many rows still look unnormalised after the
-- update. Expected zero for the migration shape; any non-zero rows are
-- pre-existing irregularities (e.g. 11-digit, leading zeros) the audit
-- should review separately.
SELECT count(*) AS rows_still_non_10_digit
FROM   tasks
WHERE  phone IS NOT NULL
  AND  phone !~ '^[0-9]{10}$';

COMMIT;
