import { expect, test } from "@playwright/test";
import { scrubLongTokens } from "../lib/push/scrub";
import {
  newServiceRequestPayload,
  titleCase,
} from "../lib/push/payloads";

// Pure-function helper tests. These do NOT hit the dev server and do NOT
// touch Supabase or Firebase — they validate the building blocks the
// process-task-notifications push fan-out relies on. Imports stay
// dependency-light (scrub.ts and payloads.ts have zero external deps) so
// the spec runs without env vars.

test.describe("push helpers — scrubLongTokens", () => {
  test("redacts an FCM-token-like long alphanumeric run", () => {
    // Realistic FCM v1 token shape: long base64url-ish string with colons.
    const token =
      "fxXyz_AbC123_DeFGhI-JkLMnO456:APA91bH0i1qZ2wEr3TyU4iO5pAsDfGhJkLZxCvBnM7q8wErTyUi9oP0aSdFgHjKlZxCvBnM";
    const message = `Requested entity was not found: ${token}`;
    const scrubbed = scrubLongTokens(message);

    expect(scrubbed).not.toBeNull();
    expect(scrubbed!).toContain("[REDACTED_TOKEN]");
    expect(scrubbed!).not.toContain(token);
    // Surrounding prose stays intact.
    expect(scrubbed!).toContain("Requested entity was not found");
  });

  test("leaves short FCM error codes alone", () => {
    expect(scrubLongTokens("messaging/registration-token-not-registered")).toBe(
      "messaging/registration-token-not-registered"
    );
    expect(scrubLongTokens("messaging/invalid-argument")).toBe(
      "messaging/invalid-argument"
    );
  });

  test("leaves UUIDs alone — they are 36 chars, below the threshold", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(scrubLongTokens(`task ${uuid} failed`)).toBe(`task ${uuid} failed`);
  });

  test("returns null for empty / whitespace / non-string input", () => {
    expect(scrubLongTokens(null)).toBeNull();
    expect(scrubLongTokens(undefined)).toBeNull();
    expect(scrubLongTokens("")).toBeNull();
    expect(scrubLongTokens("   ")).toBeNull();
  });

  test("scrubs multiple tokens in a single message", () => {
    const tokenA = "a".repeat(120);
    const tokenB = "b".repeat(120);
    const scrubbed = scrubLongTokens(`first=${tokenA} second=${tokenB}`);
    expect(scrubbed).not.toBeNull();
    expect(scrubbed!).not.toContain("aaa");
    expect(scrubbed!).not.toContain("bbb");
    // Both occurrences redacted independently.
    expect((scrubbed!.match(/\[REDACTED_TOKEN\]/g) || []).length).toBe(2);
  });
});

test.describe("push helpers — titleCase", () => {
  test("capitalizes a single lowercase word", () => {
    expect(titleCase("plumbing")).toBe("Plumbing");
  });

  test("capitalizes each word in a multi-word string", () => {
    expect(titleCase("pratap nagar")).toBe("Pratap Nagar");
    expect(titleCase("paota c road")).toBe("Paota C Road");
  });

  test("collapses internal whitespace", () => {
    expect(titleCase("   sojati    gate   ")).toBe("Sojati Gate");
  });

  test("returns empty string for empty / non-string input", () => {
    expect(titleCase("")).toBe("");
    expect(titleCase("   ")).toBe("");
    expect(titleCase(null)).toBe("");
    expect(titleCase(undefined)).toBe("");
  });
});

test.describe("push helpers — newServiceRequestPayload", () => {
  test("title-cases category and area in the body", () => {
    const payload = newServiceRequestPayload({
      taskId: "TSK-1",
      displayId: 42,
      category: "plumbing",
      area: "pratap nagar",
    });
    expect(payload.title).toBe("New service request");
    expect(payload.body).toBe("Plumbing request in Pratap Nagar");
    expect(payload.deepLink).toBe("/provider/my-jobs");
    expect(payload.eventType).toBe("new_service_request");
  });

  test("preserves raw category/area as data fields for analytics", () => {
    const payload = newServiceRequestPayload({
      taskId: "TSK-2",
      displayId: "99",
      category: "ELECTRICIAN",
      area: "SHASTRI NAGAR",
    });
    // Body is title-cased…
    expect(payload.body).toBe("Electrician request in Shastri Nagar");
    // …but the raw values flow through as data fields untouched.
    expect(payload.category).toBe("ELECTRICIAN");
    expect(payload.area).toBe("SHASTRI NAGAR");
  });

  test("substitutes neutral fallbacks when category/area are empty", () => {
    const payload = newServiceRequestPayload({
      taskId: "TSK-3",
      displayId: null,
      category: "",
      area: "",
    });
    expect(payload.body).toBe("Service request in your area");
  });

  test("every value is a string — FCM data is Map<string,string>", () => {
    const payload = newServiceRequestPayload({
      taskId: "TSK-4",
      displayId: 7,
      category: "ac repair",
      area: "paota",
      workTag: "split ac",
      matchTier: "work_tag",
    });
    for (const [key, value] of Object.entries(payload)) {
      expect(
        typeof value,
        `payload field "${key}" must be a string`
      ).toBe("string");
    }
  });
});
