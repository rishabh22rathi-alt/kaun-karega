/**
 * Admin Pending Admin Approval — orphan-leaked categories surface here
 * (not just on the provider dashboard).
 *
 * Post-patch: `/api/admin/pending-category-requests` lazily inserts a
 * `pending_category_requests` row for any provider_services orphan
 * (category not in `categories`, no existing request row for the same
 * provider_id + category). The same response then includes the freshly
 * inserted row so admins can Approve / Reject from the existing tab.
 *
 * Source-level verification — the admin shell is gated by an HMAC-
 * signed-cookie middleware that the test environment can't satisfy, so
 * the backfill helper is asserted at the source level. The downstream
 * Approve / Reject paths are already covered by
 * provider-category-request-lifecycle.spec.ts; this spec layers on the
 * "discovery" half of the cycle.
 */

import fs from "node:fs";
import path from "node:path";

import { test, expect } from "../_support/test";

test.describe("Admin pending endpoint — orphan backfill", () => {
  const root = path.resolve(__dirname, "../..");

  test("admin pending endpoint inserts missing pending_category_requests rows for orphans", () => {
    const file = fs.readFileSync(
      path.join(root, "app/api/admin/pending-category-requests/route.ts"),
      "utf8"
    );
    // The backfill helper exists and runs before the read.
    expect(file).toContain("backfillOrphanPendingRequests");
    expect(file).toMatch(
      /await backfillOrphanPendingRequests\(\)/
    );
  });

  test("backfill reads BOTH provider_services and the full categories set (any active state)", () => {
    const file = fs.readFileSync(
      path.join(root, "app/api/admin/pending-category-requests/route.ts"),
      "utf8"
    );
    expect(file).toContain('.from("provider_services")');
    expect(file).toContain('.from("categories")');
    // Match the .select wrapped across newlines.
    expect(file).toMatch(
      /\.from\("provider_services"\)[\s\S]{0,200}\.select\("provider_id, category"\)/
    );
    // No active filter on the categories fetch — orphan detection needs
    // the full set so that admin-deactivated canonicals aren't treated
    // as orphans.
    expect(file).toMatch(/\.from\("categories"\)[\s\S]{0,200}\.select\("name"\)/);
  });

  test("backfill is idempotent — skips inserts when ANY request row already exists for the pair", () => {
    const file = fs.readFileSync(
      path.join(root, "app/api/admin/pending-category-requests/route.ts"),
      "utf8"
    );
    // existing-pairs set check before insert.
    expect(file).toMatch(/existingPairs\.has\(existingKey/);
    // Pending-categry-requests existence query is unfiltered by status
    // (any state in {pending,approved,rejected,closed,archived} prevents
    // a duplicate insert).
    expect(file).toMatch(
      /\.from\("pending_category_requests"\)[\s\S]{0,200}\.select\("provider_id, requested_category, status"\)/
    );
  });

  test("backfill insert payload includes provider name + phone for audit", () => {
    const file = fs.readFileSync(
      path.join(root, "app/api/admin/pending-category-requests/route.ts"),
      "utf8"
    );
    expect(file).toMatch(/provider_name: enrich\?\.name \|\| null/);
    expect(file).toMatch(/phone: enrich\?\.phone \|\| null/);
    expect(file).toMatch(/status: "pending"/);
    expect(file).toMatch(/request_id: `PCR-\$\{randomUUID\(\)\}`/);
  });

  test("backfill is soft-fail — errors are logged but don't 500 the response", () => {
    const file = fs.readFileSync(
      path.join(root, "app/api/admin/pending-category-requests/route.ts"),
      "utf8"
    );
    // Every error path warns and returns; nothing throws or returns 500
    // out of the helper.
    expect(file).toMatch(/console\.warn\([\s\S]{0,200}backfill: categories fetch failed/);
    expect(file).toMatch(/console\.warn\([\s\S]{0,200}backfill: provider_services fetch failed/);
    expect(file).toMatch(/console\.warn\([\s\S]{0,200}backfill: existing-requests fetch failed/);
    expect(file).toMatch(/console\.warn\([\s\S]{0,200}backfill: insert failed/);
    // The helper signature returns void — Promise<void> — never throws.
    expect(file).toMatch(/async function backfillOrphanPendingRequests\(\): Promise<void>/);
  });
});

/**
 * MANUAL VERIFICATION
 * -------------------
 * Run with a real Supabase + admin session:
 *
 *   1. Seed: provider P has a provider_services row {category:"Saree
 *      Showroom"}; `categories` has no Saree Showroom row;
 *      `pending_category_requests` has no row for (P, Saree Showroom).
 *
 *   2. Sign in as admin → /admin/dashboard → Category → Pending Admin
 *      Approval. The endpoint backfills the missing row in the same
 *      request; the row appears with Approve / Reject buttons. Console
 *      logs `[admin/pending-category-requests] backfill: inserted 1
 *      orphan pending request(s)`.
 *
 *   3. Click Approve:
 *        - categories upserts {name:"Saree Showroom", active:true}
 *        - pending_category_requests.status flips to "approved"
 *        - provider_services row for (P, "Saree Showroom") is preserved
 *          (the existing approveCategoryRequest patch upserts the row,
 *          no-op on conflict)
 *        - provider_notifications row inserted for P
 *
 *   4. Refresh the pending tab: the row no longer appears (status is
 *      "approved"). Refresh /provider/dashboard for P: chip flips to
 *      Active Approved Service Category; Pending block is empty.
 *
 *   5. Click Reject on a different orphan request:
 *        - pending_category_requests.status flips to "rejected"
 *        - provider_services row preserved (no auto-delete)
 *        - provider_notifications row inserted
 *
 *   6. Re-run the admin pending tab: the backfill is idempotent —
 *      `[backfill: inserted 0 orphan pending request(s)]` (or no log
 *      line at all if every orphan now has a request row). The
 *      now-rejected category is NOT re-inserted because the existing-
 *      pairs check matches ANY status, not just pending.
 */
