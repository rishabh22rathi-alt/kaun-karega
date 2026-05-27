import { bootstrapUserSession } from "../_support/auth";
import {
  QA_AREA,
  QA_CATEGORY,
} from "../_support/data";
import { completeHomeRequestFlow, gotoPath, submitHomeForm } from "../_support/home";
import {
  jsonOk,
  mockCommonCatalogRoutes,
  mockJson,
  mockSubmitRequestSuccess,
} from "../_support/routes";
import { mockUserRequestsApis } from "../_support/scenarios";
import { test, expect } from "../_support/test";

// NOTE on the missing `details` arg below:
// The optional "Task details" textarea was removed from the homepage in
// a prior MVP simplification — see the comment block at
// app/HomePageClient.tsx:1659 (".../Submit panel — the optional 'Task
// details' textarea was removed for the MVP"). Both tests now reflect
// the current flow: service → time → area → submit, no free-text body.
// The shared `completeHomeRequestFlow` helper still accepts an optional
// `details` arg for other suites that exercise non-homepage textareas;
// here we deliberately omit it so the homepage no-textarea contract is
// pinned and a future regression that re-adds a textarea would not
// silently make these tests start filling it.

test.describe("Public: homepage flow", () => {
  test("homepage search UI gates submit until service, time, and area are selected", async ({
    page,
    diag,
  }) => {
    await mockCommonCatalogRoutes(page);
    // The homepage's disclaimer bootstrap (HomePageClient.tsx) fires
    // GET /api/auth/whoami on mount. For an anonymous visitor that
    // route legitimately 401s; the hook short-circuits silently. The
    // browser still logs the 401 as a "Failed to load resource" line
    // which diag.assertClean() would otherwise treat as test noise.
    // Same allow-list pattern used by e2e/pwa/install-ui.spec.ts.
    diag.allowConsoleError(/Failed to load resource.*401/);
    diag.allowHttpError(/whoami/);
    // The AreaSelection component issues catalogue and region-lookup
    // requests as the user types. When the test progresses quickly
    // through the form (or when React re-renders the picker), some of
    // those requests get aborted by the browser — net::ERR_ABORTED is
    // expected, environmental noise and not a real failure of the
    // homepage flow. Allow-list the two known URL prefixes only.
    diag.allowRequestFailure(
      /GET .*\/api\/areas.*net::ERR_ABORTED/
    );
    diag.allowRequestFailure(
      /GET .*\/api\/area-intelligence\/regions.*net::ERR_ABORTED/
    );
    await gotoPath(page, "/");

    await expect(page.getByRole("button", { name: /^search$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /find providers/i })).toHaveCount(0);

    await completeHomeRequestFlow(page, {
      service: QA_CATEGORY,
      time: "Today",
      area: QA_AREA,
    });

    const submitButton = page.getByRole("button", { name: /find providers/i });
    await expect(page.getByText("Service:")).toBeVisible();
    // Current MVP behavior: the optional task-details textarea is NOT
    // rendered. Pin this so a future commit can't silently reintroduce
    // it without an explicit update here.
    await expect(
      page.locator('textarea[placeholder*="Describe"]')
    ).toHaveCount(0);
    await expect(submitButton).toBeEnabled();

    diag.assertClean();
  });

  test("logged-in public submit route lands on success page with expected CTAs", async ({
    page,
    diag,
  }) => {
    await bootstrapUserSession(page);
    await mockCommonCatalogRoutes(page);
    await mockUserRequestsApis(page, { requests: [], globalThreads: [], taskThreads: [] });
    await mockSubmitRequestSuccess(page);
    // The homepage now bootstraps the disclaimer on mount (added in
    // a prior commit, preserved verbatim through the SEO Phase 1-B
    // split). For a logged-in test we mock whoami → ok+phone and
    // disclaimer → isFresh:true so the soft modal does not pop and
    // the submit can proceed straight to the success page.
    await mockJson(
      page,
      "**/api/auth/whoami",
      jsonOk({ phone: "9999999999" })
    );
    await mockJson(
      page,
      "**/api/user/disclaimer",
      jsonOk({
        version: "v1",
        acceptedAt: new Date().toISOString(),
        isFresh: true,
      })
    );
    await mockJson(
      page,
      "**/api/process-task-notifications**",
      jsonOk({ matchedProviders: 1, attemptedSends: 1, failedSends: 0 })
    );
    await mockJson(
      page,
      "**/api/find-provider**",
      jsonOk({
        count: 1,
        providers: [
          {
            name: "ZZ QA Provider",
            phone: "9999999902",
            verified: "yes",
          },
        ],
      })
    );

    await gotoPath(page, "/");
    await completeHomeRequestFlow(page, {
      service: QA_CATEGORY,
      time: "Today",
      area: QA_AREA,
    });
    await submitHomeForm(page);

    await expect(page).toHaveURL(/\/success/);
    // Current MVP copy on the success page (app/success/SuccessClient.tsx
    // line 304 / line 462). The legacy "Task Submitted Successfully"
    // + "Show service provider numbers" button + "Go to my requests"
    // strings no longer exist — the page now shows the provider list
    // inline as soon as it loads, and the secondary action is "Go to
    // Responses" which routes to /dashboard/my-requests.
    await expect(
      page.getByRole("heading", { name: /request posted successfully/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /go to responses/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /post another request/i })
    ).toBeVisible();
    // Same area-picker race that affects test 1 — providers list also
    // performs follow-up area queries that can race with the navigation.
    diag.allowRequestFailure(
      /GET .*\/api\/areas.*net::ERR_ABORTED/
    );
    diag.allowRequestFailure(
      /GET .*\/api\/area-intelligence\/regions.*net::ERR_ABORTED/
    );
    // The bottom-nav notification bell polls /api/provider/notifications
    // on every page render. For a regular user session that endpoint
    // 404s — the user has no provider account. The 404 logs a "Failed
    // to load resource" console line which is unrelated to the success
    // page being asserted here.
    diag.allowConsoleError(/Failed to load resource.*404/);
    diag.allowHttpError(/provider\/notifications/);

    diag.assertClean();
  });
});
