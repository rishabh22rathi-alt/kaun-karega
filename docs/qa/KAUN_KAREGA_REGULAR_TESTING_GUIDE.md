# Kaun Karega — Regular Testing Guide

> **This file is the entrypoint for all Kaun Karega QA.**
> When the operator says **"Run Kaun Karega regular tests"**, open this file,
> follow §2 step-by-step, run the packs in the order in §9, diagnose failures
> with §11, and produce the report in §13.

> ⚠️ **Validation status (pending): live seed/reset/data/health have NOT yet been
> run against a real database.** Staging DB runtime validation is pending because
> the Supabase staging DB connection/auth was not completed. The framework is
> type-checked and lint-clean, and the prod write-guard is verified, but the
> seeder/reset and integrity SQL are not yet proven against a live schema.
> **Do not seed/reset production.** Use only a local or staging database for
> seed/reset (the baked-in guard hard-blocks the production URL regardless).

---

## 1. Purpose

A single, repeatable testing system for every critical Kaun Karega operation —
used both for **pre-launch certification** and **ongoing regression**. It gives
us:

- One canonical set of fixed test actors (**KKTEST personas**, §7).
- An idempotent **seed/reset** framework that can never touch real data (§5, §7).
- **Test packs** (§8) wired to the existing ~120 Playwright specs without
  rewriting them, plus new critical-gap coverage.
- A **production-safe read-only** health/diagnostics mode (§8: Operational
  Health + Data Integrity).
- A standard **operations health report** (§13).

This guide replaces the old, broken `pw-e2e-audit.config.ts` entrypoint. The
single canonical config is **`web/pw-kk.config.ts`**.

> All commands run from the **`web/`** directory (scripts live in
> `web/package.json`). Use `cd web` first, or prefix with `npm --prefix web`.

---

## 2. How Claude Should Use This File

When asked to "run Kaun Karega regular tests":

1. **Read this file** end-to-end.
2. **Check env (§4).** Decide what is runnable:
   - No Supabase creds → only **mocked** packs run; live/integrity packs skip.
   - Creds present but no `KK_ALLOW_LIVE_SEED` / non-prod `KK_TARGET` → seeding
     is blocked; read-only integrity still runs.
3. **Confirm target safety (§5).** Never seed/reset unless `KK_TARGET` is a
   non-prod value AND `KK_ALLOW_LIVE_SEED=1`.
4. **Seed if needed:** `npm run test:kk:reset` (purge + reseed) or
   `npm run test:kk:seed` (idempotent ensure).
5. **Run packs in order (§9).** Prefer `npm run test:kk:all` for the full
   regression set, or individual `test:kk:*` packs.
6. **Diagnose failures (§11)** — classify each as env / seed / mock-vs-live /
   flake / **real regression**. Do not silently pass.
7. **Emit the report (§13).** List what passed, failed, skipped, and what
   remains manual (§12).
8. Never push or change production logic as part of "running tests."

---

## 3. When To Run

| Trigger | Run |
|---|---|
| Pre-launch certification | `test:kk:release` structure + full `test:kk:all` + manual §12 |
| Before merging a PR | `test:kk:all` (or the affected pack) |
| Nightly | `test:kk:all` against staging |
| After a deploy | `test:kk:health` (prod-safe read-only) |
| Before changing payments/plans | `test:kk:revenue` + `test:kk:data` |
| Production spot-check | `test:kk:health` only (read-only) |

---

## 4. Required Env Vars

| Var | Purpose | Needed for |
|---|---|---|
| `PLAYWRIGHT_BASE_URL` | App URL (default `http://127.0.0.1:3000`) | UI packs |
| `PLAYWRIGHT_HEADLESS` | `0` to show the browser | optional |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | DB endpoint | live + integrity packs |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key | live + integrity packs |
| `KK_TARGET` | `local` \| `staging` \| `qa` \| `test` — **required for any write** | seed/reset |
| `KK_ALLOW_LIVE_SEED` | `1` to permit writes (with a non-prod `KK_TARGET`) | seed/reset |
| `KK_PROD_SUPABASE_URL` | If set, seeding is blocked when the active URL matches it | safety |
| `KK_INTEGRITY_SCOPE` | `kktest` (default for `data`) or `all` (default for `health`) | integrity |
| `KK_INTEGRITY_REPORT_ONLY` | `1` = log violations without failing | integrity |
| `AUTH_SESSION_SECRET` | Signs bootstrapped sessions | session-based UI specs |
| `PLAYWRIGHT_LIVE_CONTRACTS` | `1` to enable live contract checks | select specs |
| `NATIVE_PUSH_TEST_SECRET` | Auth for native push test route | notify pack |

Values are read from real `process.env` first, then `web/.env.local`.

---

## 5. Safety Rules

1. **Never write to production.** Seed/reset throw unless `KK_ALLOW_LIVE_SEED=1`
   **and** `KK_TARGET ∈ {local,staging,qa,test}` **and** the active URL ≠
   `KK_PROD_SUPABASE_URL`.
2. **Production is read-only.** Only `test:kk:health` / `test:kk:data`
   (SELECT-only) may point at production.
3. **Row scope is hard-guarded.** Every seed/reset write is restricted to rows
   whose id starts `KKTEST_` or whose phone is in `9999990000–9999990999`. A
   filter outside that scope throws instead of running.
4. **No production business logic is changed by QA.** Tests only read and seed
   KKTEST rows. A real product bug found by a test is reported, not patched as
   part of the test run.
5. **Never push** without explicit operator approval.
6. **Auth/OTP change gate (MANDATORY).** Any change that touches authentication
   or OTP — `app/api/send-whatsapp-otp`, `app/api/verify-otp`,
   `app/api/send-otp`, `app/api/auth/**`, `lib/auth.ts`, `lib/otp/**`,
   `lib/sessionVersion.ts` — MUST run **`npm run test:kk:auth`** (deterministic
   OTP/auth gate — green-by-default, no seeded backend) **and**
   **`npm run test:kk:smoke`** before merge, and record both results in the PR.
   Use **`npm run test:kk:auth:full`** (full `e2e/auth/**`) when a seeded/staging
   backend is available for broader coverage. OTP guards are gated by
   `KK_OTP_SEND_GUARD_ENABLED` / `KK_OTP_VERIFY_GUARD_ENABLED` (both default
   OFF, fail-open) — never enable a guard flag in prod without first running
   this gate against a non-prod database.

---

## 6. Test Data Rules

- **Prefix everything** `KKTEST_`. **Reserved phone block:** `9999990000–9999990999`.
- **Static personas** (fixed ids/phones) are defined in
  `web/e2e/_support/kktest/personas.ts` — the single source of truth.
- **Ephemeral scenario rows** (tasks/threads created mid-test) use the
  `KKTEST_…` id pattern so reset cleans them with one scoped sweep.
- **Idempotent:** `seedPersonas()` upserts; re-running yields identical state.
  `resetPersonas()` = guarded purge + reseed.
- Categories are **atomic** (DJ / Pandit / Caterer / Electrician / Plumber);
  matching specs use the unique isolation category `KKTEST_SERVICE` so they
  never collide with real providers.

---

## 7. KKTEST Personas

Defined in `web/e2e/_support/kktest/personas.ts`. Regions resolve at seed time
against the live active JOD catalog (`service_regions` / `service_region_areas`).

### Users (phone-keyed posters; no provider row)
| Persona | Phone | Scope | Purpose |
|---|---|---|---|
| `KKTEST_USER_CORE` | 9999990001 | known region (JOD-01) | Happy path |
| `KKTEST_USER_ALT` | 9999990002 | different region | Wrong-region isolation |
| `KKTEST_USER_UNKNOWN` | 9999990003 | unmapped area | Unknown-area fallback |
| `KKTEST_USER_ALLCITY` | 9999990004 | All Jodhpur | City-wide posting |

### Providers (seeded across all plan tiers)
| Persona | Phone | plan_code | Regions | period_end | verified/status |
|---|---|---|---|---|---|
| `KKTEST_PROV_FREE` | 9999990101 | free | 1 | none | yes/active |
| `KKTEST_PROV_R5` | 9999990102 | regions_5 | 5 | future | yes/active |
| `KKTEST_PROV_AJ` | 9999990103 | all_jodhpur | all | future | yes/active |
| `KKTEST_PROV_AJ_EXPIRED` | 9999990104 | all_jodhpur | all (drift) | **past** | yes/active |
| `KKTEST_PROV_PENDING` | 9999990105 | free | 1 | none | no/pending |
| `KKTEST_PROV_BLOCKED` | 9999990106 | regions_5 | 1 | future | yes/blocked |
| `KKTEST_PROV_SCHEDULED` | 9999990107 | all_jodhpur → sched regions_5 | all | future | yes/active |

### Admin
| Persona | Phone | Purpose |
|---|---|---|
| `KKTEST_ADMIN` | 9999990201 | Role-based admin access + admin flows |

**Plan priority (source of truth):** `web/lib/payments/planRank.ts` —
`PLAN_RANK = { free:0, regions_5:1, all_jodhpur:2 }` (higher = preferred).

---

## 8. Test Packs

Packs are Playwright **projects** in `web/pw-kk.config.ts`, keyed by file-path
globs — existing specs are wired in **without edits**.

| Pack | Script | Type | Risk |
|---|---|---|---|
| Smoke | `test:kk:smoke` | mocked | Low |
| User Journey | `test:kk:user` | mocked + live | Med |
| Provider Journey | `test:kk:provider` | mocked + live | High |
| Matching Engine | `test:kk:matching` | live | Critical |
| Chat / Response | `test:kk:chat` | mocked | High |
| Notification | `test:kk:notify` | unit + mocked | High |
| Revenue / Subscription / Invoice | `test:kk:revenue` | live + API | Critical |
| Admin Operations | `test:kk:admin` | mocked | Med |
| Data Integrity (read-only) | `test:kk:data` | live SELECT | Critical |
| Security / PII | `test:kk:security` | live + mocked | Critical |
| **Operational Health** (prod-safe read-only) | `test:kk:health` | live SELECT | — |
| **Release Certification** (structure) | `test:kk:release` | meta | — |
| Mobile / PWA / Android | *manual* (§12) | manual | Med |

**Operational Health** = the only pack safe to run against production
(SELECT-only, defaults to platform-wide scope, emits the report artifact).
**Release Certification** is the pre-launch gate; Phase 1 ships its structure
(scaffolding checks + ordered gate list), Phase 2 aggregates per-pack verdicts.

### Data Integrity Pack — invariants (read-only)
1. provider_plans agrees with provider_areas (per-plan caps).
2. free provider has exactly 1 active region.
3. regions_5 provider has ≤ 5 active regions.
4. all_jodhpur provider covers all active regions.
5. expired plan never carries `all_jodhpur` match priority.
6. every paid payment order has an invoice.
7. no orphan invoice/payment rows.
8. no provider has an impossible region state.
9. `provider_task_matches` is unique per `(task_id, provider_id)`.

> Phase 1 implements checks 1–5, 6 (paid→invoice), and 9 as read-only queries
> (`web/e2e/_support/kktest/integrity.ts`). 7–8 widen in Phase 2 alongside the
> revenue/matching specs.

---

## 9. Execution Order

```
0. Seed/reset      npm run test:kk:reset        (non-prod only)
1. Smoke           npm run test:kk:smoke
2. Security guards  npm run test:kk:security
3. User Journey    npm run test:kk:user
4. Provider Journey npm run test:kk:provider
5. Matching Engine  npm run test:kk:matching
6. Chat / Response  npm run test:kk:chat
7. Notifications    npm run test:kk:notify
8. Revenue/Invoice  npm run test:kk:revenue
9. Admin Operations npm run test:kk:admin
10. Data Integrity  npm run test:kk:data
11. Mobile/PWA      manual (§12)
12. Final Security/PII gate  npm run test:kk:security
```

Or the full regression set in one go: `npm run test:kk:all`
(runs every automated pack except `setup` and `health`).

For a production spot-check: `npm run test:kk:health` only.

---

## 10. Commands

```bash
cd web

# Seed / reset (NON-PROD ONLY — requires KK_TARGET + KK_ALLOW_LIVE_SEED=1)
npm run test:kk:seed      # idempotent ensure personas exist
npm run test:kk:reset     # guarded purge + reseed

# Packs
npm run test:kk:smoke
npm run test:kk:user
npm run test:kk:provider
npm run test:kk:matching
npm run test:kk:chat
npm run test:kk:notify
npm run test:kk:revenue
npm run test:kk:admin
npm run test:kk:data       # read-only integrity (KK_INTEGRITY_SCOPE=kktest|all)
npm run test:kk:security

# Full regression + meta
npm run test:kk:all
npm run test:kk:release    # certification structure
npm run test:kk:health     # PROD-SAFE read-only diagnostics

# Discovery
npm run test:kk:list       # list discovered tests, runs nothing

# Auth/OTP regression (run on ANY auth/OTP change — see §5 rule 6)
npm run test:kk:auth       # deterministic gate: otp-guard + otp-paste + single-active-session (green-by-default, no seeded backend)
npm run test:kk:auth:full  # full e2e/auth/** (incl. dashboard specs that need a seeded/live backend)
```

Backward-compat aliases (retired the broken config): `test:e2e:audit`,
`test:e2e:audit:headed`, `test:e2e:audit:list` now delegate to the `test:kk:*`
scripts above.

---

## 11. Failure Diagnosis Method

For each failure, classify before reacting:

1. **Env gap?** Skipped/failed with "creds not available" or "writes not
   allowed" → missing `SUPABASE_*` / `KK_TARGET` / `KK_ALLOW_LIVE_SEED`. Not a
   product bug — record as *blocked*.
2. **Seed gap?** Live spec can't find a KKTEST persona → run `test:kk:reset`
   first, then re-run.
3. **Server down?** UI packs need the app at `PLAYWRIGHT_BASE_URL`. Start it
   (`npm run dev`) or point at the right URL.
4. **Mock vs live drift?** A mocked pack passes but the live one fails (or vice
   versa) → the mock no longer matches the real contract. Flag for spec update.
5. **Flake?** Re-run the single spec. Networked/timing failures that don't
   reproduce → note as flaky, not a regression.
6. **Real regression?** Reproducible failure against seeded data with the app
   up → this is a product bug. Capture the spec, the assertion, and the
   observed vs expected. Report it; do **not** patch production logic inside a
   test run.

Always attach the failing assertion text and any console/network diagnostics
(the suite records these via `_support/diagnostics.ts`).

---

## 12. Manual Android / PWA Checklist

Run on a real Android device / installed PWA before release:

- [ ] Bottom navigation switches sections and preserves state.
- [ ] Menu sheet opens, scrolls, and closes; no overlap with content.
- [ ] Notification panel opens; unread badge clears on read.
- [ ] PWA install row appears and installs cleanly.
- [ ] "Detect my area" requests permission and resolves a region (or falls back
      gracefully when denied).
- [ ] Razorpay opens the UPI app and returns to the app.
- [ ] After payment success, the app is **not stuck** — plan card updates and
      invoice is visible.
- [ ] Provider task alert + user response alert arrive as push.

Record each as pass/fail with device + OS version in the report.

---

## 13. Final Report Format

Produce this after a run (the `health`/`data` packs emit a markdown artifact via
`_support/kktest/report.ts`; assemble the rest from pack results):

```
# Kaun Karega — Operational Health Report
- Overall: ✅ PASS | 🔴 FAIL | 🟡 PENDING
- Generated: <ISO timestamp>
- Target: <local|staging|qa|prod-readonly>
- Mode: full | read-only

## Pack results
| Pack | Status | Pass | Fail | Skip |
| ...  | ...    | ...  | ...  | ...  |

## Failed scenarios
- [pack] scenario — observed vs expected

## Data integrity
- ✅ / 🔴 <check> — <detail>

## Manual checklist (pending)
- [ ] <item>

## Notes
- env gaps / flakes / follow-ups
```

---

## 14. Maintenance

- **Add a persona:** edit `personas.ts` (keep id `KKTEST_…`, phone in block),
  then the seeder picks it up automatically.
- **Add a pack:** add a project (path globs) to `pw-kk.config.ts` and a
  `test:kk:<pack>` script; add it to `test:kk:all` and §8/§9 here.
- **Add a spec to a pack:** drop the file under the pack's glob (no config edit
  needed if it matches), or add its path to the project's `testMatch`.
- **Never** widen a seed/reset write outside the KKTEST scope — the guard will
  reject it, and that guard is intentional.

---

## 15. Admin Testing Dashboard (future — not built yet)

Planned `web/app/admin/testing/page.tsx` that consumes the `HealthReport`
object from `report.ts`:

- Per-pack status + last-run timestamp.
- Failed-scenario list with diagnosis tags.
- Copy-paste run instructions per pack.
- Manual checklist status (Android/PWA) with persisted checkboxes.

Deferred until explicitly requested. The report format in §13 / `report.ts` is
designed so the dashboard can render it without rework.

---

## File Map (framework foundation)

| File | Role |
|---|---|
| `docs/qa/KAUN_KAREGA_REGULAR_TESTING_GUIDE.md` | This guide (entrypoint) |
| `web/pw-kk.config.ts` | Single QA config; packs = projects |
| `web/e2e/_support/kktest/personas.ts` | Canonical personas (source of truth) |
| `web/e2e/_support/kktest/env.ts` | Env + Supabase client + **prod write guard** |
| `web/e2e/_support/kktest/guard.ts` | Strict KKTEST row-scope guard |
| `web/e2e/_support/kktest/seedPersonas.ts` | Idempotent seeder |
| `web/e2e/_support/kktest/resetPersonas.ts` | Guarded purge + reseed |
| `web/e2e/_support/kktest/integrity.ts` | Read-only integrity checks |
| `web/e2e/_support/kktest/report.ts` | Health report formatter |
| `web/e2e/kktest/seed.setup.spec.ts` | `@seed` runner |
| `web/e2e/kktest/reset.setup.spec.ts` | `@reset` runner |
| `web/e2e/data-integrity/integrity-invariants.spec.ts` | Data Integrity Pack |
| `web/e2e/health/operational-health.spec.ts` | Operational Health Pack |
| `web/e2e/release/release-certification.spec.ts` | Release Certification structure |
