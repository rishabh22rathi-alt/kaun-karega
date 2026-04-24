# Kaun Karega E2E Coverage Audit

## Covered

### Smoke
- Guest app shell loads.
- Desktop sidebar shell renders with guest navigation.
- Homepage shell renders without console/page errors.

### Public
- Homepage category, timing, and area flow gates progression correctly.
- Guest sidebar/provider CTA routes through `/login?next=/provider/register`.
- Logged-in public submit flow reaches `/success`.

### Auth
- User OTP login reaches `/dashboard/my-requests`.
- Provider OTP login reaches `/provider/dashboard`.
- Admin OTP login reaches `/admin/dashboard`.
- Guest redirects for `/dashboard/*`, `/admin/*`, `/provider/login`.
- Logout clears client session.
- Session persists across reloads on protected user routes.

### User
- `My Requests` renders task category, area, details, status, and response table.
- User-side chat opens from `My Requests`.
- `no_providers_matched` renders a friendly empty-state path.
- `Report an Issue` submits successfully.
- `I NEED` posting flow routes back to `My Needs`.
- `My Needs` supports status updates and response-thread navigation.

### Provider
- Provider registration supports category and area selection and submits successfully.
- Provider dashboard renders profile, demand cards, service/area chips, and chat entry points.
- Pending approval provider state renders correct messaging and edit links.

### Admin
- Admin control center renders dashboard snapshot, notification health, areas, issues, and chat monitoring sections.
- Provider verification actions stay wired.
- Pending category request approval stays wired.
- Area alias add/map flows stay wired.
- Issue status update stays wired.
- Chat monitoring thread open flow stays wired.

### Chat
- User chat deep links load in user mode.
- Provider chat deep links load in provider mode.
- `chat_mark_read` and `chat_send_message` requests fire from browser flows.
- Access-denied state renders clearly.
- Guest deep links route to the correct login target for each actor.

### Matching / Notifications
- Success page triggers `/api/process-task-notifications`.
- Success page fetches providers via `/api/find-provider`.
- Zero-match provider modal renders a graceful empty state.

### Migration / Hardening
- Browser-side homepage, chat, success, and provider flows avoid direct Apps Script calls.
- Internal routes `/api/categories`, `/api/areas`, `/api/provider/dashboard-profile`, `/api/kk`, `/api/find-provider`, and `/api/process-task-notifications` are exercised from browser flows.
- Live contract scaffold exists behind `PLAYWRIGHT_LIVE_CONTRACTS=1` for critical migrated endpoints.

### UI Audit
- Major visible homepage, user, provider, and admin controls are classified as:
  - `works`
  - `disabled`
  - `conditional`
  - `broken`
- JSON and Markdown audit artifacts are attached per UI-audit test.

## Verified Status
- Dedicated audit config discovery: 34 tests across 15 files.
- Latest verified run: 31 passed, 3 skipped.
- Skipped tests are the live contract checks that require `PLAYWRIGHT_LIVE_CONTRACTS=1`.

## Intentionally Skipped
- Real WhatsApp OTP delivery and verification.
- Real notification dispatch to provider phones.
- Live Supabase data assertions unless `PLAYWRIGHT_LIVE_CONTRACTS=1`.
- Team management or permission mutation coverage in admin, because no explicit in-app team-management surface was found in the current dashboard UI.
- Full manual moderation flows that require `window.prompt`/`window.confirm` reason entry with production-like operator behavior.

## Appears Broken
- No confirmed broken flow is being hard-coded from the mocked audit suite itself.
- Any failures here should be treated as newly detected regressions when the suite is run.
- The live-contract block is intentionally skipped by default, so environment-specific backend breakages can still exist until that block is enabled against seeded data.

## Needs Manual Testing
- Real OTP, WhatsApp template delivery, and phone-number ownership checks.
- Cross-device/mobile Safari rendering and keyboard behavior.
- True Supabase row-level security behavior with non-mocked production-like accounts.
- Admin moderation prompts that depend on human-entered reasons.
- Real provider matching quality, ranking, and notification delivery timing.

## Needs Unit / Integration Coverage
- Pure status-label mapping and task/need normalization helpers.
- Provider/admin reducer-like local state transitions after action responses.
- API contract validation for `/api/kk` action payloads and responses.
- Matching and notification business rules around blocked providers, pending approvals, and empty-match transitions.
- Route handlers for issue reports, provider registration, chat send/read, and area-management mutations.
- Polling and toast-diff logic on `My Requests` and provider dashboard pages.

## Environment Notes
- Default audit specs use browser/network mocks and do not require live OTP or seeded WhatsApp infrastructure.
- Live route-contract checks require:
  - `PLAYWRIGHT_LIVE_CONTRACTS=1`
  - a running app with working server env
  - seeded data suitable for `/api/find-provider`, `/api/process-task-notifications`, and native `/api/kk` chat actions

## Run Commands
- Full audit suite: `npm run test:e2e:audit`
- Headed audit run: `npm run test:e2e:audit:headed`
- List discovered audit tests: `npm run test:e2e:audit:list`
- Domain subset example: `npx playwright test -c pw-e2e-audit.config.ts e2e/smoke e2e/public e2e/auth`
- Admin and UI audit example: `npx playwright test -c pw-e2e-audit.config.ts e2e/admin e2e/ui-audit`
