import {
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

// Isolated app name so this never collides with any other firebase-admin
// initialization that may exist in the same Next.js process.
const APP_NAME = "kk-native-push";

let cachedApp: App | null = null;
let cachedMessaging: Messaging | null = null;

function parseServiceAccount(): ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || raw.trim().length === 0) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON did not parse to an object");
  }

  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.project_id !== "string" ||
    typeof obj.client_email !== "string" ||
    typeof obj.private_key !== "string"
  ) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON missing project_id, client_email, or private_key"
    );
  }

  // Vercel-style env vars escape newlines in the private key as literal \n.
  const privateKey = obj.private_key.includes("\\n")
    ? obj.private_key.replace(/\\n/g, "\n")
    : obj.private_key;

  return {
    projectId: obj.project_id,
    clientEmail: obj.client_email,
    privateKey,
  };
}

function getOrInitApp(): App {
  if (cachedApp) return cachedApp;
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) {
    cachedApp = existing;
    return existing;
  }
  const credential = cert(parseServiceAccount());
  cachedApp = initializeApp({ credential }, APP_NAME);
  return cachedApp;
}

// Cheap, side-effect-free check used by callers that need to refuse work
// (e.g. return 503) when push is not configured for this environment.
export function isPushConfigured(): boolean {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  return typeof raw === "string" && raw.trim().length > 0;
}

export function getPushMessaging(): Messaging {
  if (cachedMessaging) return cachedMessaging;
  cachedMessaging = getMessaging(getOrInitApp());
  return cachedMessaging;
}
