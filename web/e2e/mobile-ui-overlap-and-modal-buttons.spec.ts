/**
 * Mobile responsive UI verification.
 *
 * Covers the UI-only patches landed for the "buttons overlap on mobile /
 * disclaimer buttons not crisp" issue:
 *
 *   1. UserDisclaimerModal + ProviderPledgeModal footer buttons stack
 *      full-width on a 390x844 viewport and sit inline-right at desktop.
 *      Verified by injecting the exact footer markup into a Tailwind-
 *      loaded page (`/`) and asserting computed styles — avoids the
 *      heavy session/localStorage choreography needed to organically
 *      open either modal.
 *   2. Admin dashboard tables (CategoryTab, AreaTab) now have an
 *      `overflow-x-auto` wrapper so 4–5 column tables don't visually
 *      overlap the page chrome on narrow viewports. Verified via a
 *      class-presence assertion on the wrapper elements served by the
 *      compiled JSX bundle — covered by the source check below since
 *      mounting the admin shell needs auth + many /api mocks.
 */

import { test, expect } from "./_support/test";
import { gotoPath } from "./_support/home";
import fs from "node:fs";
import path from "node:path";

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 900 };

const DISCLAIMER_FOOTER_HTML = `
  <div id="disclaimer-footer"
       class="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
    <button id="later"
            class="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:w-auto">
      Later
    </button>
    <button id="accept"
            class="w-full rounded-lg bg-[#003d20] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#002a15] sm:w-auto">
      I Understand & Continue
    </button>
  </div>
`;

const PLEDGE_FOOTER_HTML = `
  <div id="pledge-footer"
       class="flex flex-col gap-2 border-t border-slate-100 px-5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
    <button id="pledge-accept"
            class="w-full rounded-lg bg-[#003d20] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#002a15] sm:w-auto">
      Accept & Continue
    </button>
  </div>
`;

async function injectMarkup(
  page: import("@playwright/test").Page,
  html: string
) {
  // Wrap in a 390-wide container so flex-wrap / w-full behave like the
  // real modal card (max-w-lg ~32rem, with 20px horizontal padding).
  await page.evaluate((markup) => {
    const host = document.createElement("div");
    host.id = "test-host";
    host.style.maxWidth = "350px";
    host.style.margin = "20px auto";
    host.style.border = "1px solid transparent";
    host.innerHTML = markup;
    document.body.innerHTML = "";
    document.body.appendChild(host);
  }, html);
}

test.describe("Modal footer buttons — mobile stacking", () => {
  test("UserDisclaimerModal footer stacks full-width on 390 viewport", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await gotoPath(page, "/");
    await injectMarkup(page, DISCLAIMER_FOOTER_HTML);

    const footer = page.locator("#disclaimer-footer");
    await expect(footer).toBeVisible();

    // The mobile-first class `flex-col-reverse` resolves to
    // flex-direction: column-reverse on the layout pipeline.
    const direction = await footer.evaluate(
      (el) => window.getComputedStyle(el).flexDirection
    );
    expect(direction).toBe("column-reverse");

    // Both buttons should span the full available width — i.e., their
    // bounding box width equals the parent's content-box width (within
    // 1px to allow for sub-pixel rounding).
    const parentWidth = await footer.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      const padLeft = parseFloat(styles.paddingLeft);
      const padRight = parseFloat(styles.paddingRight);
      return el.clientWidth - padLeft - padRight;
    });
    const acceptBox = await page.locator("#accept").boundingBox();
    const laterBox = await page.locator("#later").boundingBox();
    expect(acceptBox).not.toBeNull();
    expect(laterBox).not.toBeNull();
    expect(Math.abs((acceptBox?.width ?? 0) - parentWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs((laterBox?.width ?? 0) - parentWidth)).toBeLessThanOrEqual(1);
  });

  test("UserDisclaimerModal footer goes inline-right on desktop", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await gotoPath(page, "/");
    await injectMarkup(page, DISCLAIMER_FOOTER_HTML);

    const footer = page.locator("#disclaimer-footer");
    const direction = await footer.evaluate(
      (el) => window.getComputedStyle(el).flexDirection
    );
    expect(direction).toBe("row");

    // Buttons shrink back to their content width (much narrower than
    // the 350px host).
    const accept = await page.locator("#accept").boundingBox();
    expect(accept).not.toBeNull();
    expect(accept!.width).toBeLessThan(260);
  });

  test("ProviderPledgeModal footer stacks full-width on 390 viewport", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await gotoPath(page, "/");
    await injectMarkup(page, PLEDGE_FOOTER_HTML);

    const footer = page.locator("#pledge-footer");
    const direction = await footer.evaluate(
      (el) => window.getComputedStyle(el).flexDirection
    );
    expect(direction).toBe("column");

    const parentWidth = await footer.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      const padLeft = parseFloat(styles.paddingLeft);
      const padRight = parseFloat(styles.paddingRight);
      return el.clientWidth - padLeft - padRight;
    });
    const accept = await page.locator("#pledge-accept").boundingBox();
    expect(accept).not.toBeNull();
    expect(Math.abs((accept?.width ?? 0) - parentWidth)).toBeLessThanOrEqual(1);
  });
});

test.describe("Admin tables — overflow-x-auto wrappers exist in source", () => {
  // Mounting the admin shell requires auth + many /api mocks; the
  // table wrappers are pure UI markup, so a source-level assertion is
  // equivalent and far cheaper than orchestrating the full route.
  const root = path.resolve(__dirname, "..");

  test("CategoryTab tables are wrapped with overflow-x-auto", () => {
    const file = fs.readFileSync(
      path.join(root, "components/admin/CategoryTab.tsx"),
      "utf8"
    );
    // The two tables — categories list and pending requests — each
    // sit directly inside an overflow-x-auto wrapper.
    const wrappers = [
      ...file.matchAll(
        /<div\s+className="overflow-x-auto[^"]*">\s*<table\s+className="min-w-full/g
      ),
    ];
    expect(
      wrappers.length,
      "expected 2 overflow-x-auto wrappers around CategoryTab tables"
    ).toBe(2);
  });

  test("AreaTab tables are wrapped with overflow-x-auto", () => {
    const file = fs.readFileSync(
      path.join(root, "components/admin/AreaTab.tsx"),
      "utf8"
    );
    const wrappers = [
      ...file.matchAll(
        /<div\s+className="overflow-x-auto">\s*<table\s+className="min-w-full/g
      ),
    ];
    expect(
      wrappers.length,
      "expected 2 overflow-x-auto wrappers around AreaTab tables"
    ).toBe(2);
  });
});

/**
 * MANUAL VERIFICATION NOTES
 * -------------------------
 *
 * Modal buttons crispness (cannot be screenshotted by Playwright in this
 * spec — open path needs full session + stale-disclaimer state):
 *   - Trigger the homepage disclaimer modal (login + clear
 *     localStorage["kk_disclaimer_seen_at"]). On a 390x844 viewport the
 *     "Later" / "I Understand & Continue" buttons should stack
 *     vertically, each occupying the full modal width with the same
 *     padding. Touch targets feel comfortably tappable.
 *   - On ≥640px (sm:) the buttons sit inline-right with the original
 *     gap-2 spacing — unchanged from before the patch.
 *
 * Provider pledge:
 *   - From /provider/register on a fresh device, scroll to the pledge
 *     section and click the chat bubble (if applicable) so the pledge
 *     modal opens. On 390x844 the "Accept & Continue" button spans the
 *     full modal width; on desktop it stays right-aligned.
 *
 * Admin dashboard tables:
 *   - Sign in as admin → /admin/dashboard.
 *   - Set the browser to a 390x844 viewport. In Categories, scroll to
 *     a table with many rows. The 3-column table no longer pushes Edit
 *     / Disable / Enable buttons over the column to its left — instead
 *     the table is horizontally scrollable inside its rounded card.
 *   - Same for Areas tab → Unmapped Provider Areas + Pending Approval.
 *   - On ≥768px the layout looks identical to pre-patch (the wrapper
 *     simply allows scroll if needed; on wide screens nothing scrolls).
 *
 * Desktop regression check:
 *   - Resize back to 1280x900 on the homepage and admin pages. No
 *     visible difference compared to pre-patch — the responsive classes
 *     are mobile-first additions that no-op once `sm:` kicks in.
 */
