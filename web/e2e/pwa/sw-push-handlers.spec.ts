/**
 * Phase B Step 4 — service-worker push display.
 *
 * public/sw.js is a static, un-bundled service worker (it references SW
 * globals like `self`/`clients`), so it cannot be imported into the Node
 * test runner. This spec reads the file as text and asserts the required
 * handlers, defaults, and safety invariants are present — a regression
 * guard against accidental removal. Real delivery is verified manually on
 * a device once Steps 5/6 land.
 */

import fs from "fs";
import path from "path";

import { test, expect } from "@playwright/test";

const SW_PATH = path.resolve(__dirname, "../../public/sw.js");
const sw = fs.readFileSync(SW_PATH, "utf8");

test.describe("Phase B — sw.js push handlers", () => {
  test("SW_VERSION was bumped (forces re-download)", () => {
    expect(sw).toContain('const SW_VERSION = "v1.1.0"');
  });

  test("existing behavior intact: install/activate/fetch handlers remain", () => {
    expect(sw).toContain('addEventListener("install"');
    expect(sw).toContain('addEventListener("activate"');
    expect(sw).toContain('addEventListener("fetch"');
    expect(sw).toContain("event.respondWith(fetch(event.request))");
  });

  test("adds push + notificationclick handlers and showNotification", () => {
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
    expect(sw).toContain("self.registration.showNotification");
  });

  test("admin-alert defaults present", () => {
    expect(sw).toContain("Kaun Karega Admin Alert");
    expect(sw).toContain("You have a new admin alert.");
    expect(sw).toContain("/admin/alerts");
  });

  test("notification options: stable tag, renotify, deepLink data, icon", () => {
    expect(sw).toContain('tag: "kk-admin-alert"');
    expect(sw).toContain("renotify: true");
    expect(sw).toContain("deepLink");
    expect(sw).toContain("/icons/icon-192-v2.png");
  });

  test("click handler focuses existing window or opens a new one", () => {
    expect(sw).toContain("clients.matchAll");
    expect(sw).toContain("openWindow");
    expect(sw).toContain(".focus()");
  });

  test("NO Firebase IMPORT/SDK in the service-worker CODE", () => {
    // The file legitimately MENTIONS firebase in explanatory comments; the
    // invariant is that no actual import/SDK usage exists. Strip comments
    // first, then assert against executable code only.
    const code = sw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toContain("importScripts");
    expect(code).not.toContain("firebase");
    expect(code).not.toContain("initializeApp");
    expect(code).not.toContain("getMessaging");
    expect(code).not.toContain("onBackgroundMessage");
  });

  test("does NOT request permission or register tokens in the SW", () => {
    expect(sw).not.toContain("requestPermission");
    expect(sw).not.toContain("native-push/devices");
  });
});
