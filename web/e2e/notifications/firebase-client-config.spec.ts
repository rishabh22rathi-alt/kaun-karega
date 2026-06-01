/**
 * Phase B Step 3 — firebaseClient config detection.
 *
 * Pure unit spec (no dev server, no DB, no firebase SDK loaded — the
 * SDK is only dynamic-imported inside getFirebaseMessaging/getFcmWebToken,
 * which we do NOT call here). Verifies the all-or-nothing gate.
 */

import { test, expect } from "@playwright/test";

import { hasAllFirebaseWebValues } from "../../lib/push/firebaseClient";

const FULL = {
  apiKey: "AIzaTEST",
  authDomain: "kaun-karega.firebaseapp.com",
  projectId: "kaun-karega",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123",
  vapidKey: "B-vapid-public-key",
};

test.describe("Phase B — hasAllFirebaseWebValues", () => {
  test("true only when all six values are present", () => {
    expect(hasAllFirebaseWebValues(FULL)).toBe(true);
  });

  test("false when any single value is missing", () => {
    for (const key of Object.keys(FULL) as Array<keyof typeof FULL>) {
      const partial = { ...FULL };
      delete partial[key];
      expect(hasAllFirebaseWebValues(partial)).toBe(false);
    }
  });

  test("false for empty/whitespace values", () => {
    expect(hasAllFirebaseWebValues({ ...FULL, apiKey: "" })).toBe(false);
    expect(hasAllFirebaseWebValues({ ...FULL, vapidKey: "   " })).toBe(false);
  });

  test("false for an empty object", () => {
    expect(hasAllFirebaseWebValues({})).toBe(false);
  });
});
