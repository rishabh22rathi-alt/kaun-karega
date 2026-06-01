/* eslint-disable */
// Kaun Karega — Phase 1 service worker.
//
// PURPOSE
//   Satisfy Chrome's PWA installability requirement (a registered SW
//   with a `fetch` handler) WITHOUT introducing any caching behavior.
//   Every request flows straight to the network exactly as it would
//   without the SW present.
//
// =====================================================================
//  CRITICAL: DO NOT ADD CACHING TO THIS FILE WITHOUT A TESTED POLICY.
// =====================================================================
//
//  This SW intercepts EVERY request to the origin (scope "/"). If you
//  add any caching here, you MUST explicitly opt out of the following
//  surfaces — they are correctness- and security-sensitive and must
//  never serve a stale response:
//
//    /api/**            (all API mutations + reads)
//    /admin/**          (admin pages + admin auth state)
//    /provider/**       (provider session / dashboard / chat)
//    /dashboard/**      (user-authenticated pages)
//    /chat/**           (live chat threads)
//    Anything related to auth, login, OTP, sessions, payments,
//    matching, provider plan, notifications, or any mutation.
//
//  In practice: precache only static, public, content-addressed
//  assets (e.g. /_next/static/*), use stale-while-revalidate ONLY
//  for cosmetic, non-personalized resources, and route every other
//  request straight through `fetch(event.request)`. Before turning
//  on any caching, add a Playwright regression test that proves
//  mutated `/api/*` responses are NOT served from cache.
//
// =====================================================================
//
// VERSIONING
//   Bump SW_VERSION whenever this file changes. The actual version
//   string is not used at runtime today, but it makes the file bytes
//   differ between deploys so browsers re-download the SW on next
//   navigation (browsers check sw.js at most every 24h regardless;
//   skipWaiting + clients.claim activates the new SW immediately
//   once downloaded).

const SW_VERSION = "v1.1.0";

self.addEventListener("install", (event) => {
  // Activate the new SW as soon as it finishes installing rather than
  // waiting for all tabs to close. Combined with clients.claim below,
  // this means new SW versions take over within one navigation.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of clients (open tabs) without forcing a reload.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass-through. Phase 1 contract: ZERO caching, ever. The browser
  // sees the network response exactly as if no SW were registered.
  //
  // event.respondWith(fetch(event.request)) IS the one and only
  // network round-trip — there is no double-fetch.
  event.respondWith(fetch(event.request));
});

// =====================================================================
//  Phase B Step 4 — Web push display.
// =====================================================================
//  This SW renders push notifications WITHOUT importing Firebase. The
//  client mints an FCM web token (Step 3's firebaseClient), the server
//  sends a DATA-only FCM message (existing send path), and Chrome wakes
//  this SW's `push` event. We parse the data and call showNotification
//  ourselves — there is intentionally NO firebase-messaging-sw.js and NO
//  Firebase SDK in the worker.
//
//  Token registration (Step 5), the admin test route (Step 6), and the
//  permission prompt do NOT exist yet, so no push can actually arrive
//  until those land — these handlers are inert until then.

const PUSH_DEFAULTS = {
  title: "Kaun Karega Admin Alert",
  body: "You have a new admin alert.",
  deepLink: "/admin/alerts",
};

// Pick the first non-empty string from the candidates.
function pickString() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return "";
}

// Safely extract { title, body, deepLink } from a push event. Supports:
//   - raw JSON:           { title, body, deepLink }
//   - FCM data-only:      { data: { title, body, deepLink } }
//   - FCM notification:   { notification: { title, body }, data: { deepLink } }
// Always returns a complete object (falls back to PUSH_DEFAULTS field-wise).
function parsePushData(event) {
  let raw = null;
  if (event && event.data) {
    try {
      raw = event.data.json();
    } catch (e) {
      try {
        const text = event.data.text();
        raw = text ? JSON.parse(text) : null;
      } catch (e2) {
        raw = null;
      }
    }
  }
  if (!raw || typeof raw !== "object") {
    return { ...PUSH_DEFAULTS };
  }
  const data = raw.data && typeof raw.data === "object" ? raw.data : {};
  const notif =
    raw.notification && typeof raw.notification === "object"
      ? raw.notification
      : {};
  return {
    title: pickString(data.title, notif.title, raw.title) || PUSH_DEFAULTS.title,
    body: pickString(data.body, notif.body, raw.body) || PUSH_DEFAULTS.body,
    deepLink:
      pickString(
        data.deepLink,
        data.link,
        raw.deepLink,
        raw.link,
        notif.click_action
      ) || PUSH_DEFAULTS.deepLink,
  };
}

self.addEventListener("push", (event) => {
  const parsed = parsePushData(event);
  const options = {
    body: parsed.body,
    icon: "/icons/icon-192-v2.png",
    badge: "/icons/icon-192-v2.png",
    tag: "kk-admin-alert",
    renotify: true,
    data: { deepLink: parsed.deepLink },
  };
  event.waitUntil(self.registration.showNotification(parsed.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const deepLink =
    typeof data.deepLink === "string" && data.deepLink.trim().length > 0
      ? data.deepLink
      : PUSH_DEFAULTS.deepLink;

  event.waitUntil(
    (async () => {
      const url = new URL(deepLink, self.location.origin).href;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // 1) Exact same URL already open → focus it.
      for (const client of windows) {
        if (client.url === url && "focus" in client) {
          return client.focus();
        }
      }
      // 2) Any app window open → focus it and navigate to the deep link.
      for (const client of windows) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            return client.navigate(url).catch(() => undefined);
          }
          return undefined;
        }
      }
      // 3) Nothing open → open a new window.
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
      return undefined;
    })()
  );
});
