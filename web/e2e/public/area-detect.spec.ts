import type { Page } from "@playwright/test";

import { gotoPath } from "../_support/home";
import { jsonOk, mockJson } from "../_support/routes";
import { test, expect } from "../_support/test";

const AREAS = ["Sardarpura", "Shastri Nagar", "Ratanada"];
const REGIONS = [
  {
    region_code: "JOD-01",
    region_name: "Sardarpura",
    areas: ["Sardarpura"],
    city_code: "JOD",
  },
  {
    region_code: "JOD-02",
    region_name: "Shastri Nagar",
    areas: ["Shastri Nagar"],
    city_code: "JOD",
  },
];

async function mockAreaSelectionCatalog(page: Page) {
  await mockJson(
    page,
    "**/api/cities**",
    jsonOk({
      default_city_code: "JOD",
      cities: [
        {
          city_code: "JOD",
          city_name: "Jodhpur",
          state: "Rajasthan",
          country: "India",
          is_default: true,
        },
      ],
    })
  );
  await mockJson(page, "**/api/areas**", ({ request }) => {
    const query = (
      new URL(request.url()).searchParams.get("q") || ""
    ).toLowerCase();
    const areas = query
      ? AREAS.filter((area) => area.toLowerCase().includes(query))
      : AREAS;
    return jsonOk({ city_code: "JOD", areas });
  });
  await mockJson(
    page,
    "**/api/area-intelligence/regions**",
    jsonOk({ city_code: "JOD", regions: REGIONS })
  );
  await mockJson(
    page,
    "**/api/area-intelligence/suggest**",
    ({ request }) => {
      const query = (
        new URL(request.url()).searchParams.get("query") || ""
      ).toLowerCase();
      const suggestions = AREAS.filter((area) =>
        area.toLowerCase().includes(query)
      ).map((area) => ({
        type: "canonical_area",
        label: area,
        canonical_area: area,
        region_code: "JOD-01",
        region_name: "Sardarpura",
      }));
      return jsonOk({ city_code: "JOD", suggestions });
    }
  );
}

async function openRequestFlow(page: Page) {
  await mockAreaSelectionCatalog(page);
  await gotoPath(page, "/request-flow?category=Plumber");
  await expect(page.locator("#geo-city")).toBeVisible({ timeout: 5_000 });
}

async function installUnsupportedGeolocation(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: undefined,
    });
  });
}

async function installDeniedGeolocation(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (
          _success: PositionCallback,
          error?: PositionErrorCallback
        ) => {
          error?.({
            code: 1,
            message: "Permission denied",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError);
        },
      },
    });
  });
}

async function installSuccessfulGeolocation(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => {
          success({
            coords: {
              latitude: 26.2389,
              longitude: 73.0243,
              accuracy: 1500,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
  });
}

test.describe("AreaSelection detect my area", () => {
  test("button appears after City selector", async ({ page }) => {
    await openRequestFlow(page);

    const detectButton = page.getByTestId("detect-my-area");
    await expect(detectButton).toBeVisible();
    const cityBeforeDetect = await page.evaluate(() => {
      const city = document.querySelector("#geo-city");
      const detect = document.querySelector('[data-testid="detect-my-area"]');
      return Boolean(
        city &&
          detect &&
          (city.compareDocumentPosition(detect) &
            Node.DOCUMENT_POSITION_FOLLOWING)
      );
    });
    expect(cityBeforeDetect).toBe(true);
    await expect(detectButton).toHaveClass(/border-\[#1B5E20\]/);
    await expect(detectButton).toHaveClass(/text-\[#1B5E20\]/);
    await expect(detectButton).not.toHaveClass(/sky/);
  });

  test("unsupported geolocation shows manual-entry fallback", async ({
    page,
  }) => {
    await installUnsupportedGeolocation(page);
    await openRequestFlow(page);

    await page.getByTestId("detect-my-area").click();

    await expect(page.getByTestId("detect-area-message")).toHaveText(
      "Location detection is not available on this device."
    );
  });

  test("permission denied shows manual-entry fallback", async ({ page }) => {
    await installDeniedGeolocation(page);
    await openRequestFlow(page);

    await page.getByTestId("detect-my-area").click();

    await expect(page.getByTestId("detect-area-message")).toHaveText(
      "Location permission was denied. Please type your area manually."
    );
  });

  test("mocked geolocation success shows suggestion and Use this area selects it", async ({
    page,
  }) => {
    await installSuccessfulGeolocation(page);
    await mockJson(
      page,
      "**/api/area-intelligence/detect",
      ({ body }) => {
        expect(body).toMatchObject({
          cityCode: "JOD",
          latitude: 26.2389,
          longitude: 73.0243,
        });
        return jsonOk({
          detectedArea: "Sardarpura",
          regionCode: "JOD-01",
          regionName: "Sardarpura",
          cityCode: "JOD",
          confidence: "approximate",
          source: "reverse_geocode",
          message: "You seem near Sardarpura",
        });
      }
    );
    await openRequestFlow(page);

    await page.getByTestId("detect-my-area").click();

    const suggestion = page.getByTestId("detect-area-suggestion");
    await expect(suggestion).toContainText("You seem near Sardarpura / JOD-01");
    await suggestion.getByRole("button", { name: "Use this area" }).click();

    await expect(page.getByText("Selected area/region")).toBeVisible();
    await expect(page.getByText("Sardarpura").last()).toBeVisible();
  });

  test("manual area typing still works", async ({ page }) => {
    await openRequestFlow(page);

    await page.locator('input[placeholder="Type your area..."]').fill("Sardarpura");
    await page.getByRole("button", { name: "Use this area" }).click();

    await expect(page.getByText("Selected area/region")).toBeVisible();
    await expect(page.getByText("Sardarpura").last()).toBeVisible();
  });

  test("popular region chip selection still works", async ({ page }) => {
    await openRequestFlow(page);

    await page
      .getByRole("button", { name: /^Shastri Nagar$/ })
      .first()
      .click();

    await expect(page.getByText("Selected area/region")).toBeVisible();
    await expect(page.getByText("Shastri Nagar").last()).toBeVisible();
  });
});

test.describe("area-intelligence detect API", () => {
  test("mocked Google geocode response returns a JOD region suggestion without coordinates", async ({
    request,
  }) => {
    const response = await request.post("/api/area-intelligence/detect", {
      headers: {
        "x-kk-google-geocode-fixture": JSON.stringify({
          status: "OK",
          results: [
            {
              address_components: [
                {
                  long_name: "Sardarpura",
                  short_name: "Sardarpura",
                  types: ["sublocality_level_1", "sublocality", "political"],
                },
                {
                  long_name: "Jodhpur",
                  short_name: "Jodhpur",
                  types: ["locality", "political"],
                },
              ],
            },
          ],
        }),
      },
      data: {
        cityCode: "JOD",
        latitude: 26.2389,
        longitude: 73.0243,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      detectedArea: "Sardarpura",
      regionCode: "JOD-01",
      confidence: "approximate",
      source: "reverse_geocode",
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("26.2389");
    expect(serialized).not.toContain("73.0243");
  });

  test("missing geocoder key path returns no confident match", async ({
    request,
  }) => {
    const response = await request.post("/api/area-intelligence/detect", {
      headers: { "x-kk-disable-geocoder": "1" },
      data: {
        cityCode: "JOD",
        latitude: 26.2389,
        longitude: 73.0243,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: false,
      error: "NO_CONFIDENT_MATCH",
    });
    expect(JSON.stringify(body)).not.toContain("26.2389");
    expect(JSON.stringify(body)).not.toContain("73.0243");
  });

  test("rejects invalid coordinates without echoing lat/lng", async ({
    request,
  }) => {
    const response = await request.post("/api/area-intelligence/detect", {
      data: {
        cityCode: "JOD",
        latitude: "26.2389",
        longitude: 73.0243,
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: false,
      error: "INVALID_COORDINATES",
    });
    expect(JSON.stringify(body)).not.toContain("26.2389");
    expect(JSON.stringify(body)).not.toContain("73.0243");
  });
});
