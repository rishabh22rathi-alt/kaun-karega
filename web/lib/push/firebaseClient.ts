/**
 * Phase B Step 3 — Firebase Web (client) initialization ONLY.
 *
 * This module ONLY initializes the Firebase Web app and exposes a token
 * getter. It deliberately does NOT:
 *   - request Notification permission,
 *   - register/store any token,
 *   - send any push,
 *   - touch the service worker,
 *   - call any of these functions itself.
 * Wiring lands in later Phase B steps.
 *
 * Everything is lazy + soft-fail: `firebase/app` and `firebase/messaging`
 * are dynamic-imported only when a function actually runs, so the public
 * bundle is unchanged while the admin push panel is disabled, and any
 * missing env / unsupported browser resolves to a safe null (never throws).
 *
 * Uses the SAME Firebase project as the server (`kaun-karega`) via the
 * public NEXT_PUBLIC_FIREBASE_* config; the server's service-account
 * (firebase-admin) can only deliver to web tokens minted in that project.
 */

import type { FirebaseApp, FirebaseOptions } from "firebase/app";
import type { Messaging } from "firebase/messaging";

// ─── Env (read as static member accesses so Next inlines NEXT_PUBLIC_*) ──

type FirebaseWebEnv = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  messagingSenderId?: string;
  appId?: string;
  vapidKey?: string;
};

function readFirebaseWebEnv(): FirebaseWebEnv {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
  };
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Pure config-detection: true only when ALL six web-push values are
 * present (the five firebaseConfig fields + the VAPID key). Exported for
 * unit tests so the gate is verified without depending on the inlined
 * build-time env.
 */
export function hasAllFirebaseWebValues(env: FirebaseWebEnv): boolean {
  return (
    isNonEmpty(env.apiKey) &&
    isNonEmpty(env.authDomain) &&
    isNonEmpty(env.projectId) &&
    isNonEmpty(env.messagingSenderId) &&
    isNonEmpty(env.appId) &&
    isNonEmpty(env.vapidKey)
  );
}

/** True when every NEXT_PUBLIC_FIREBASE_* value needed for web push is set. */
export function isFirebaseWebConfigured(): boolean {
  return hasAllFirebaseWebValues(readFirebaseWebEnv());
}

/** The five-field firebaseConfig, or null if any init field is missing. */
function readFirebaseOptions(): FirebaseOptions | null {
  const env = readFirebaseWebEnv();
  if (
    !isNonEmpty(env.apiKey) ||
    !isNonEmpty(env.authDomain) ||
    !isNonEmpty(env.projectId) ||
    !isNonEmpty(env.messagingSenderId) ||
    !isNonEmpty(env.appId)
  ) {
    return null;
  }
  return {
    apiKey: env.apiKey,
    authDomain: env.authDomain,
    projectId: env.projectId,
    messagingSenderId: env.messagingSenderId,
    appId: env.appId,
  };
}

// ─── Lazy init (browser-only, dynamic-imported, cached) ──────────────────

let messagingPromise: Promise<Messaging | null> | null = null;

/**
 * Initialize Firebase Messaging on the client and return it, or null when
 * not possible (SSR, missing config, unsupported browser, init error).
 * Never throws. Cached after the first call.
 */
export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (typeof window === "undefined") return null; // never on the server
  const options = readFirebaseOptions();
  if (!options) return null;

  if (messagingPromise) return messagingPromise;
  messagingPromise = (async () => {
    try {
      const { initializeApp, getApps, getApp } = await import("firebase/app");
      const { getMessaging, isSupported } = await import("firebase/messaging");
      const supported = await isSupported().catch(() => false);
      if (!supported) return null;
      const app: FirebaseApp = getApps().length ? getApp() : initializeApp(options);
      return getMessaging(app);
    } catch (err) {
      console.warn("[firebaseClient] messaging init failed (non-fatal)", {
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  })();
  return messagingPromise;
}

/**
 * Retrieve an FCM web registration token using the VAPID key and an
 * optional service-worker registration. Returns null on any failure
 * (missing config, no permission, unsupported, SDK error). NEVER throws.
 *
 * NOTE: This is exported for a later Phase B step. It is NOT called
 * anywhere yet, and it does not itself request Notification permission —
 * if permission has not been granted, getToken simply yields null here.
 */
export async function getFcmWebToken(
  serviceWorkerRegistration?: ServiceWorkerRegistration
): Promise<string | null> {
  const { vapidKey } = readFirebaseWebEnv();
  if (!isNonEmpty(vapidKey)) return null;

  const messaging = await getFirebaseMessaging();
  if (!messaging) return null;

  try {
    const { getToken } = await import("firebase/messaging");
    const token = await getToken(messaging, {
      vapidKey,
      ...(serviceWorkerRegistration ? { serviceWorkerRegistration } : {}),
    });
    return token && token.length > 0 ? token : null;
  } catch (err) {
    console.warn("[firebaseClient] getToken failed (non-fatal)", {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
