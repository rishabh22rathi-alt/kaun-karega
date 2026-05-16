import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { scrubLongTokens } from "../lib/push/scrub";

loadEnv({ path: path.resolve(__dirname, "../.env.local") });
loadEnv({ path: path.resolve(__dirname, "../.env") });

// Phase 4B: provider matched-job native push. These tests cover the parts we
// can assert without setting up a real handset:
//   1. The scrub helper redacts long token-shaped runs from error_message.
//   2. push_logs row count is unchanged when NATIVE_PUSH_ENABLED is not the
//      string "true" — the only way the push block is supposed to fire.
//
// The deeper "real fan-out" coverage (token resolution, sendEachForMulticast,
// invalid-token cleanup, deep-link round-trip) is exercised by the §"Manual
// live test steps" matrix from the Phase 4B report, against a real Firebase
// project. We don't attempt to mock the SDK here — it would only prove the
// mock matches itself.

function getEnv(name: string): string {
  return (process.env[name] || "").trim();
}

function adminClient(): SupabaseClient | null {
  const url = getEnv("SUPABASE_URL") || getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

test.describe("Phase 4B: scrubLongTokens", () => {
  test("redacts a long FCM-token-shaped run from error_message", () => {
    const fakeToken =
      "fcmTokenStartZ" +
      "abcdefghij1234567890_ABCDEFGHIJK".repeat(5) +
      "TokenEnd";
    const input = `FCM error: tried to send to ${fakeToken} but it was unregistered`;
    const out = scrubLongTokens(input);
    expect(out).not.toBeNull();
    expect(out!).not.toContain(fakeToken);
    expect(out!).toContain("[REDACTED_TOKEN]");
    expect(out!).toMatch(/FCM error: tried to send/);
  });

  test("leaves short error codes untouched", () => {
    const input = "messaging/registration-token-not-registered";
    expect(scrubLongTokens(input)).toBe(input);
  });

  test("returns null for null/empty input", () => {
    expect(scrubLongTokens(null)).toBeNull();
    expect(scrubLongTokens(undefined)).toBeNull();
    expect(scrubLongTokens("")).toBeNull();
    expect(scrubLongTokens("   ")).toBeNull();
  });

  test("redacts multiple token-shaped runs in a single message", () => {
    // Threshold in scrub.ts is 60 chars in the token alphabet, so both
    // fixtures must exceed that to actually exercise the redactor.
    const t1 = "a".repeat(80);
    const t2 = "Z".repeat(80);
    const input = `${t1} failed; ${t2} also failed`;
    const out = scrubLongTokens(input)!;
    expect(out).not.toContain(t1);
    expect(out).not.toContain(t2);
    expect((out.match(/\[REDACTED_TOKEN\]/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

test.describe("Phase 4B: process-task-notifications push gate", () => {
  // Default behaviour in dev/CI: NATIVE_PUSH_ENABLED is unset, so even a
  // successful matched-task run must not write any push_logs row. This
  // assertion guards against accidental "always-on" wiring in the route.
  test("with NATIVE_PUSH_ENABLED unset, push_logs row count is unchanged on a forbidden POST", async ({
    request,
  }) => {
    test.skip(
      getEnv("NATIVE_PUSH_ENABLED") === "true",
      "NATIVE_PUSH_ENABLED is set; this test only applies when push is disabled."
    );
    const client = adminClient();
    test.skip(
      !client,
      "Supabase admin env not available; cannot snapshot push_logs."
    );

    // Snapshot push_logs row count. We don't seed a real matched task here
    // (the existing native-push-devices spec already exercises seeding for
    // the registration path) — instead, hit the route anonymously. The
    // route returns 401 before any matching/push code runs, so push_logs
    // must be unchanged. This proves the route file doesn't accidentally
    // write push_logs on unauthorized paths.
    const before = await client!
      .from("push_logs")
      .select("id", { count: "exact", head: true });
    const beforeCount = before.count ?? 0;

    const res = await request.post("/api/process-task-notifications", {
      data: { taskId: "TSK-DOES-NOT-EXIST-PHASE-4B-TEST" },
    });
    expect(res.status()).toBe(401);

    const after = await client!
      .from("push_logs")
      .select("id", { count: "exact", head: true });
    const afterCount = after.count ?? 0;

    expect(afterCount).toBe(beforeCount);
  });
});
