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

const SW_VERSION = "v1.0.0";

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
