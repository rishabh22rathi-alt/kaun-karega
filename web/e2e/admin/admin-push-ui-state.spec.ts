/**
 * Admin Push UI state after registration (pure).
 *
 * The gated panel can't be rendered in this dev env (NEXT_PUBLIC_* is
 * inlined at build time and unset here), so — like the gate test — we
 * assert the pure pieces that drive the panel:
 *   - registerAdminPush outcome mapping (success / denied / error),
 *   - adminPushStatus message + tone,
 *   - adminPushTestDisabled (Send Test Push availability).
 * Together these prove: a successful register enables Send Test Push and
 * shows a clear "enabled" success message, while denied/error states do
 * not enable the test and surface an error tone.
 */

import { test, expect } from "@playwright/test";

import {
  adminPushStatus,
  adminPushTestDisabled,
  adminPushEnableDisabled,
} from "../../components/admin/AdminPushControls";
import { registerAdminPush } from "../../lib/push/adminPushCore";

const OK_DEPS = {
  isSupported: () => true,
  isConfigured: () => true,
  requestPermission: async () => "granted" as NotificationPermission,
  getToken: async () => "x".repeat(40),
  postDevice: async () => ({ ok: true }),
};

test.describe("Admin push — successful registration enables Send Test Push", () => {
  test("mocked successful register response → registered outcome", async () => {
    const outcome = await registerAdminPush(OK_DEPS);
    expect(outcome.status).toBe("registered");
  });

  test("registered state enables Send Test Push", () => {
    expect(adminPushTestDisabled({ registered: true, testLoading: false })).toBe(
      false
    );
    // ...and re-disables only while a send is in flight.
    expect(adminPushTestDisabled({ registered: true, testLoading: true })).toBe(
      true
    );
  });

  test("registered state shows a clear success message", () => {
    const status = adminPushStatus({
      supported: true,
      configured: true,
      registered: true,
      permission: "granted",
    });
    expect(status.tone).toBe("success");
    expect(status.text).toBe("Push alerts enabled on this device.");
  });

  test("Enable button is retired once registered", () => {
    expect(
      adminPushEnableDisabled({
        supported: true,
        configured: true,
        loading: false,
        registered: true,
      })
    ).toBe(true);
  });
});

test.describe("Admin push — denied / error states still work", () => {
  test("denied permission → denied outcome, test stays disabled", async () => {
    const outcome = await registerAdminPush({
      ...OK_DEPS,
      requestPermission: async () => "denied" as NotificationPermission,
    });
    expect(outcome.status).toBe("denied");
    expect(
      adminPushTestDisabled({ registered: false, testLoading: false })
    ).toBe(true);
  });

  test("denied permission shows an error-tone message", () => {
    const status = adminPushStatus({
      supported: true,
      configured: true,
      registered: false,
      permission: "denied",
    });
    expect(status.tone).toBe("error");
  });

  test("failed device POST → error outcome, test stays disabled", async () => {
    const outcome = await registerAdminPush({
      ...OK_DEPS,
      postDevice: async () => ({ ok: false, error: "boom" }),
    });
    expect(outcome.status).toBe("error");
    expect(
      adminPushTestDisabled({ registered: false, testLoading: false })
    ).toBe(true);
  });

  test("not-yet-registered prompt is neutral, not a false success", () => {
    const status = adminPushStatus({
      supported: true,
      configured: true,
      registered: false,
      permission: "default",
    });
    expect(status.tone).toBe("neutral");
  });
});
