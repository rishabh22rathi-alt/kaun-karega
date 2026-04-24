import { createClient } from "@supabase/supabase-js";
import type { Locator, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

import { bootstrapProviderSession } from "./_support/auth";
import { gotoPath } from "./_support/home";
import { test, expect } from "./_support/test";

type ProviderFixture = {
  providerId: string;
  phone: string;
  name: string;
  services: string[];
  areas: string[];
};

type PendingAreaRow = {
  reviewId: string;
  rawArea: string;
};

type ResolvedAreaRow = {
  reviewId: string;
  rawArea: string;
  resolvedCanonicalArea: string;
};

type ScenarioFixture = {
  label: string;
  provider: ProviderFixture;
  pendingAreas: PendingAreaRow[];
  resolvedAreas: ResolvedAreaRow[];
};

type SupabaseErrorLike = { message?: string } | null;

let cachedEnvLocal: Record<string, string> | null = null;

function loadEnvLocal(): Record<string, string> {
  if (cachedEnvLocal) return cachedEnvLocal;

  const envPath = path.resolve(__dirname, "../.env.local");
  if (!fs.existsSync(envPath)) {
    cachedEnvLocal = {};
    return cachedEnvLocal;
  }

  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    env[key] = value;
  }

  cachedEnvLocal = env;
  return cachedEnvLocal;
}

function getEnv(name: string): string {
  return process.env[name] || loadEnvLocal()[name] || "";
}

function createAdminSupabaseClient() {
  const url = getEnv("SUPABASE_URL") || getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase admin env. Expected SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

function assertNoSupabaseError(label: string, error: SupabaseErrorLike): void {
  if (error) {
    throw new Error(`${label}: ${error.message || "Unknown Supabase error"}`);
  }
}

function makeSeed(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

function makePhone(prefix: string, seed: string): string {
  const digits = seed.replace(/\D/g, "").slice(-8).padStart(8, "0");
  return `${prefix}${digits}`;
}

function toAreaKey(area: string): string {
  return area.trim().toLowerCase().replace(/\s+/g, "_");
}

function buildProvider(label: string, seed: string, areas: string[]): ProviderFixture {
  const suffix = seed.slice(-6);
  return {
    providerId: `ZZ-PAC-${label.toUpperCase()}-${suffix}`,
    phone: makePhone("87", seed),
    name: `ZZ Area Coverage ${label} ${suffix}`,
    services: [`ZZ Plumber ${suffix}`],
    areas,
  };
}

function buildScenarioOne(): ScenarioFixture {
  const seed = makeSeed();
  const suffix = seed.slice(-6);
  return {
    label: "scenario-one-active",
    provider: buildProvider("ACTIVE", seed, [
      `ZZ Area Active A ${suffix}`,
      `ZZ Area Active B ${suffix}`,
      `ZZ Area Active C ${suffix}`,
    ]),
    pendingAreas: [],
    resolvedAreas: [],
  };
}

function buildScenarioTwo(): ScenarioFixture {
  const seed = makeSeed();
  const suffix = seed.slice(-6);
  return {
    label: "scenario-two-pending",
    provider: buildProvider("PENDING", seed, [`ZZ Area Active A ${suffix}`]),
    pendingAreas: [
      { reviewId: `ZZ-PAC-REV-${suffix}-P1`, rawArea: `ZZ Pending Area A ${suffix}` },
      { reviewId: `ZZ-PAC-REV-${suffix}-P2`, rawArea: `ZZ Pending Area B ${suffix}` },
    ],
    resolvedAreas: [],
  };
}

function buildScenarioThree(): ScenarioFixture {
  const seed = makeSeed();
  const suffix = seed.slice(-6);
  return {
    label: "scenario-three-resolved",
    provider: buildProvider("RESOLVED", seed, [`ZZ Area Active A ${suffix}`]),
    pendingAreas: [],
    resolvedAreas: [
      {
        reviewId: `ZZ-PAC-REV-${suffix}-R1`,
        rawArea: `ZZ Resolved Approved A ${suffix}`,
        resolvedCanonicalArea: `ZZ Canonical Approved A ${suffix}`,
      },
      {
        reviewId: `ZZ-PAC-REV-${suffix}-R2`,
        rawArea: `ZZ Resolved Rejected B ${suffix}`,
        resolvedCanonicalArea: "",
      },
    ],
  };
}

function buildScenarioFour(): ScenarioFixture {
  const seed = makeSeed();
  const suffix = seed.slice(-6);
  return {
    label: "scenario-four-edit",
    provider: buildProvider("EDIT", seed, [`ZZ Area Active A ${suffix}`]),
    pendingAreas: [],
    resolvedAreas: [],
  };
}

async function insertScenario(
  client: ReturnType<typeof createAdminSupabaseClient>,
  scenario: ScenarioFixture
) {
  const { provider, pendingAreas, resolvedAreas } = scenario;

  const providerInsert = await client.from("providers").insert({
    provider_id: provider.providerId,
    full_name: provider.name,
    phone: provider.phone,
    status: "active",
    verified: "yes",
  });
  assertNoSupabaseError("providers insert failed", providerInsert.error);

  const servicesInsert = await client.from("provider_services").insert(
    provider.services.map((category) => ({
      provider_id: provider.providerId,
      category,
    }))
  );
  assertNoSupabaseError("provider_services insert failed", servicesInsert.error);

  if (provider.areas.length > 0) {
    const areasInsert = await client.from("provider_areas").insert(
      provider.areas.map((area) => ({
        provider_id: provider.providerId,
        area,
      }))
    );
    assertNoSupabaseError("provider_areas insert failed", areasInsert.error);
  }

  const nowIso = new Date().toISOString();

  if (pendingAreas.length > 0) {
    const pendingInsert = await client.from("area_review_queue").insert(
      pendingAreas.map((row) => ({
        review_id: row.reviewId,
        raw_area: row.rawArea,
        normalized_key: toAreaKey(row.rawArea),
        status: "pending",
        occurrences: 1,
        source_type: "provider_register",
        source_ref: provider.providerId,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
        resolved_canonical_area: "",
        resolved_at: null,
      }))
    );
    assertNoSupabaseError("area_review_queue pending insert failed", pendingInsert.error);
  }

  if (resolvedAreas.length > 0) {
    const resolvedInsert = await client.from("area_review_queue").insert(
      resolvedAreas.map((row) => ({
        review_id: row.reviewId,
        raw_area: row.rawArea,
        normalized_key: toAreaKey(row.rawArea),
        status: "resolved",
        occurrences: 1,
        source_type: "provider_register",
        source_ref: provider.providerId,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
        resolved_canonical_area: row.resolvedCanonicalArea,
        resolved_at: nowIso,
      }))
    );
    assertNoSupabaseError("area_review_queue resolved insert failed", resolvedInsert.error);
  }
}

async function cleanupScenario(
  client: ReturnType<typeof createAdminSupabaseClient>,
  scenario: ScenarioFixture
) {
  const cleanupErrors: string[] = [];
  const providerId = scenario.provider.providerId;
  const reviewIds = [
    ...scenario.pendingAreas.map((row) => row.reviewId),
    ...scenario.resolvedAreas.map((row) => row.reviewId),
  ];

  if (reviewIds.length > 0) {
    const reviewDelete = await client
      .from("area_review_queue")
      .delete()
      .in("review_id", reviewIds);
    if (reviewDelete.error) {
      cleanupErrors.push(`area_review_queue delete failed: ${reviewDelete.error.message}`);
    }
  }

  const servicesDelete = await client.from("provider_services").delete().eq("provider_id", providerId);
  if (servicesDelete.error) {
    cleanupErrors.push(`provider_services delete failed: ${servicesDelete.error.message}`);
  }

  const areasDelete = await client.from("provider_areas").delete().eq("provider_id", providerId);
  if (areasDelete.error) {
    cleanupErrors.push(`provider_areas delete failed: ${areasDelete.error.message}`);
  }

  const providersDelete = await client.from("providers").delete().eq("provider_id", providerId);
  if (providersDelete.error) {
    cleanupErrors.push(`providers delete failed: ${providersDelete.error.message}`);
  }

  if (cleanupErrors.length > 0) {
    throw new Error(`Cleanup failed for ${scenario.label}: ${cleanupErrors.join(" | ")}`);
  }
}

async function runScenarioWithCleanup(
  scenario: ScenarioFixture,
  run: () => Promise<void>
): Promise<void> {
  const client = createAdminSupabaseClient();
  let primaryError: unknown = null;

  try {
    await insertScenario(client, scenario);
    console.log(
      `[provider-area-coverage] inserted ${JSON.stringify({
        label: scenario.label,
        provider: scenario.provider,
        pendingAreas: scenario.pendingAreas,
        resolvedAreas: scenario.resolvedAreas,
      })}`
    );
    await run();
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await cleanupScenario(client, scenario);
      console.log(`[provider-area-coverage] cleaned ${JSON.stringify({ label: scenario.label })}`);
    } catch (cleanupError) {
      console.error("[provider-area-coverage] cleanup failed", cleanupError);
      if (!primaryError) {
        throw cleanupError;
      }
    }
  }
}

function areaCoverageCard(page: Page): Locator {
  // The Area Coverage heading is a styled paragraph-heading (h2). We scope to
  // the outer card div via its closest `rounded-[28px]` container.
  return page
    .getByRole("heading", { name: "Area Coverage", exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-[28px]')][1]");
}

function areaChip(card: Locator, area: string): Locator {
  return card.getByText(area, { exact: true });
}

test.describe("Provider dashboard: Area Coverage", () => {
  test("scenario 1 — shows active approved areas with correct count and chips", async ({
    page,
    diag,
  }) => {
    const scenario = buildScenarioOne();

    await runScenarioWithCleanup(scenario, async () => {
      await bootstrapProviderSession(page, scenario.provider.phone);
      await gotoPath(page, "/provider/dashboard");

      const card = areaCoverageCard(page);
      await expect(card).toBeVisible();
      await expect(
        card.getByText(
          "Active areas are used for matching. Pending requests wait for admin review.",
          { exact: true }
        )
      ).toBeVisible();
      await expect(card.getByText("Active Approved Areas (3/5)", { exact: true })).toBeVisible();

      for (const area of scenario.provider.areas) {
        await expect(areaChip(card, area)).toBeVisible();
      }

      await expect(card.getByText("No pending area requests.", { exact: true })).toBeVisible();
      await expect(card.getByText("No resolved area requests yet.", { exact: true })).toBeVisible();

      diag.assertClean();
    });
  });

  test("scenario 2 — pending area requests appear in Pending Area Requests section", async ({
    page,
    diag,
  }) => {
    const scenario = buildScenarioTwo();

    await runScenarioWithCleanup(scenario, async () => {
      await bootstrapProviderSession(page, scenario.provider.phone);
      await gotoPath(page, "/provider/dashboard");

      const card = areaCoverageCard(page);
      await expect(card).toBeVisible();

      for (const activeArea of scenario.provider.areas) {
        await expect(areaChip(card, activeArea)).toBeVisible();
      }

      for (const pending of scenario.pendingAreas) {
        await expect(card.getByText(pending.rawArea, { exact: true })).toBeVisible();
      }

      await expect(card.getByText("No pending area requests.", { exact: true })).toHaveCount(0);

      diag.assertClean();
    });
  });

  test("scenario 3 — resolved outcomes appear in Resolved Outcomes section", async ({
    page,
    diag,
  }) => {
    const scenario = buildScenarioThree();

    await runScenarioWithCleanup(scenario, async () => {
      await bootstrapProviderSession(page, scenario.provider.phone);
      await gotoPath(page, "/provider/dashboard");

      const card = areaCoverageCard(page);
      await expect(card).toBeVisible();

      for (const resolved of scenario.resolvedAreas) {
        // UI shows either `rawArea -> canonical` (mapped) or just canonical (rejected).
        // We accept EITHER the raw area or the canonical area in the rendered text.
        const haystack = card.locator("xpath=.//*[contains(normalize-space(.), " +
          JSON.stringify(resolved.rawArea) + ")]");
        const canonicalMatch = resolved.resolvedCanonicalArea
          ? card.locator("xpath=.//*[contains(normalize-space(.), " +
              JSON.stringify(resolved.resolvedCanonicalArea) + ")]")
          : null;

        const rawCount = await haystack.count();
        const canonicalCount = canonicalMatch ? await canonicalMatch.count() : 0;
        expect(
          rawCount + canonicalCount,
          `scenario-three: expected resolved area "${resolved.rawArea}" (or its canonical "${resolved.resolvedCanonicalArea}") to be visible in the Area Coverage card`
        ).toBeGreaterThan(0);
      }

      await expect(card.getByText("No resolved area requests yet.", { exact: true })).toHaveCount(0);

      diag.assertClean();
    });
  });

  test("scenario 4 — Edit button inside Area Coverage routes to the areas edit page", async ({
    page,
    diag,
  }) => {
    const scenario = buildScenarioFour();

    await runScenarioWithCleanup(scenario, async () => {
      await bootstrapProviderSession(page, scenario.provider.phone);
      await gotoPath(page, "/provider/dashboard");

      const card = areaCoverageCard(page);
      await expect(card).toBeVisible();

      const editLink = card.getByRole("link", { name: "Edit", exact: true });
      await expect(editLink).toBeVisible();

      const href = await editLink.getAttribute("href");
      expect(href, "scenario-four: Edit link inside Area Coverage is missing an href").toBeTruthy();
      expect(href).toContain("/provider/register");
      expect(href).toContain("edit=areas");

      await editLink.click();
      await page.waitForURL(/\/provider\/register.*edit=areas/, { timeout: 10_000 });
      expect(page.url()).toMatch(/\/provider\/register.*edit=areas/);

      diag.assertClean();
    });
  });
});
