import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(__dirname, "../.env.local") });
loadEnv({ path: path.resolve(__dirname, "../.env") });

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const AUTH_SESSION_SECRET = (process.env.AUTH_SESSION_SECRET || "").trim();
const RUN_ID = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

function getEnv(name: string): string {
  if (process.env[name]) return process.env[name] || "";

  const envPath = path.resolve(__dirname, "../.env.local");
  if (!fs.existsSync(envPath)) return "";

  const line = fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith(`${name}=`));
  if (!line) return "";
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

function createAdminClient(): SupabaseClient {
  const url = getEnv("SUPABASE_URL") || getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing Supabase admin env");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function canonicalPhone(phone10: string): string {
  const digits = phone10.replace(/\D/g, "").slice(-10);
  return `91${digits}`;
}

function mintSession(phone10: string, sver = 0): string {
  const payload = Buffer.from(
    JSON.stringify({
      phone: canonicalPhone(phone10),
      verified: true,
      createdAt: Date.now(),
      sver,
    })
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", AUTH_SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

async function newSignedContext(phone10: string, sver = 0): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: {
      Cookie: `kk_auth_session=${mintSession(phone10, sver)}`,
    },
  });
}

async function nativePushTableAvailable(client: SupabaseClient): Promise<boolean> {
  const { error } = await client.from("native_push_devices").select("id").limit(1);
  return !error;
}

async function seedProfile(client: SupabaseClient, phone10: string, sver = 0) {
  const { error } = await client.from("profiles").upsert(
    {
      phone: canonicalPhone(phone10),
      role: "user",
      session_version: sver,
      last_login_at: new Date().toISOString(),
    },
    { onConflict: "phone" }
  );
  expect(error?.message || "").toBe("");
}

async function cleanup(client: SupabaseClient, tokens: string[], phones10: string[], providerIds: string[]) {
  if (tokens.length > 0) {
    await client.from("native_push_devices").delete().in("fcm_token", tokens);
  }
  if (providerIds.length > 0) {
    await client.from("providers").delete().in("provider_id", providerIds);
  }
  for (const phone10 of phones10) {
    await client.from("admins").delete().eq("phone", canonicalPhone(phone10));
    await client.from("profiles").delete().eq("phone", canonicalPhone(phone10));
  }
}

test.describe("native Android push token registration API", () => {
  test("unauthenticated request returns 401", async ({ request }) => {
    const res = await request.post("/api/native-push/devices", {
      data: { fcmToken: `fcm_test_unauth_${RUN_ID}_abcdefghijklmnopqrstuvwxyz` },
    });
    expect(res.status()).toBe(401);
  });

  test("invalid token returns 400", async ({ request }) => {
    const res = await request.post("/api/native-push/devices", {
      data: { fcmToken: "short" },
    });
    expect(res.status()).toBe(400);
  });

  test.describe("with Supabase-backed device table", () => {
    let client: SupabaseClient;
    const tokens: string[] = [];
    const phones: string[] = [];
    const providerIds: string[] = [];

    test.beforeAll(async () => {
      test.skip(
        AUTH_SESSION_SECRET.length < 16,
        "AUTH_SESSION_SECRET is required to mint signed kk_auth_session cookies"
      );
      client = createAdminClient();
      test.skip(
        !(await nativePushTableAvailable(client)),
        "native_push_devices table is not available; apply the Phase 2 migration first"
      );
    });

    test.afterAll(async () => {
      if (client) {
        await cleanup(client, tokens, phones, providerIds);
      }
    });

    test("stale session returns 401", async () => {
      const phone = `81${RUN_ID.slice(-8).padStart(8, "0")}`;
      phones.push(phone);
      await seedProfile(client, phone, 0);

      const ctx = await newSignedContext(phone, 999);
      try {
        const res = await ctx.post("/api/native-push/devices", {
          data: { fcmToken: `fcm_test_stale_${RUN_ID}_abcdefghijklmnopqrstuvwxyz` },
        });
        expect(res.status()).toBe(401);
      } finally {
        await ctx.dispose();
      }
    });

    test("valid user session inserts user device", async () => {
      const phone = `82${RUN_ID.slice(-8).padStart(8, "0")}`;
      const token = `fcm_test_user_${RUN_ID}_abcdefghijklmnopqrstuvwxyz`;
      phones.push(phone);
      tokens.push(token);
      await seedProfile(client, phone, 0);

      const ctx = await newSignedContext(phone, 0);
      try {
        const res = await ctx.post("/api/native-push/devices", {
          data: { fcmToken: token, appVersion: "1.0.0", deviceModel: "Pixel Test", androidSdk: 35 },
        });
        expect(res.status()).toBe(200);
        await expect(res).toBeOK();
        const body = await res.json();
        expect(body.device.actorType).toBe("user");
        expect(body.device.providerId).toBeNull();
      } finally {
        await ctx.dispose();
      }

      const { data, error } = await client
        .from("native_push_devices")
        .select("phone, actor_type, provider_id, platform, app_version, device_model, android_sdk, active, revoked_at")
        .eq("fcm_token", token)
        .single();
      expect(error?.message || "").toBe("");
      expect(data).toMatchObject({
        phone: canonicalPhone(phone),
        actor_type: "user",
        provider_id: null,
        platform: "android",
        app_version: "1.0.0",
        device_model: "Pixel Test",
        android_sdk: 35,
        active: true,
        revoked_at: null,
      });
    });

    test("valid provider session inserts provider device", async () => {
      const phone = `83${RUN_ID.slice(-8).padStart(8, "0")}`;
      const providerId = `ZZ-PUSH-${RUN_ID}`;
      const token = `fcm_test_provider_${RUN_ID}_abcdefghijklmnopqrstuvwxyz`;
      phones.push(phone);
      providerIds.push(providerId);
      tokens.push(token);
      await seedProfile(client, phone, 0);
      const providerInsert = await client.from("providers").insert({
        provider_id: providerId,
        full_name: "ZZ Push Provider",
        phone,
        status: "active",
        verified: "yes",
      });
      expect(providerInsert.error?.message || "").toBe("");

      const ctx = await newSignedContext(phone, 0);
      try {
        const res = await ctx.post("/api/native-push/devices", {
          data: { fcmToken: token },
        });
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.device.actorType).toBe("provider");
        expect(body.device.providerId).toBe(providerId);
      } finally {
        await ctx.dispose();
      }
    });

    test("valid admin session inserts admin device", async () => {
      const phone = `84${RUN_ID.slice(-8).padStart(8, "0")}`;
      const token = `fcm_test_admin_${RUN_ID}_abcdefghijklmnopqrstuvwxyz`;
      phones.push(phone);
      tokens.push(token);
      await seedProfile(client, phone, 0);
      const adminInsert = await client.from("admins").upsert(
        {
          phone: canonicalPhone(phone),
          name: "ZZ Push Admin",
          role: "admin",
          permissions: ["manage_roles"],
          active: true,
        },
        { onConflict: "phone" }
      );
      expect(adminInsert.error?.message || "").toBe("");

      const ctx = await newSignedContext(phone, 0);
      try {
        const res = await ctx.post("/api/native-push/devices", {
          data: { fcmToken: token },
        });
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.device.actorType).toBe("admin");
        expect(body.device.providerId).toBeNull();
      } finally {
        await ctx.dispose();
      }
    });

    test("repeated token updates metadata and reactivates row", async () => {
      const phone = `85${RUN_ID.slice(-8).padStart(8, "0")}`;
      const token = `fcm_test_repeat_${RUN_ID}_abcdefghijklmnopqrstuvwxyz`;
      phones.push(phone);
      tokens.push(token);
      await seedProfile(client, phone, 0);

      const ctx = await newSignedContext(phone, 0);
      try {
        const first = await ctx.post("/api/native-push/devices", {
          data: { fcmToken: token, appVersion: "1.0.0" },
        });
        expect(first.status()).toBe(200);
        await client
          .from("native_push_devices")
          .update({ active: false, revoked_at: new Date().toISOString() })
          .eq("fcm_token", token);
        const second = await ctx.post("/api/native-push/devices", {
          data: { fcmToken: token, appVersion: "2.0.0", deviceModel: "Updated Device" },
        });
        expect(second.status()).toBe(200);
      } finally {
        await ctx.dispose();
      }

      const { data, error } = await client
        .from("native_push_devices")
        .select("app_version, device_model, active, revoked_at")
        .eq("fcm_token", token)
        .single();
      expect(error?.message || "").toBe("");
      expect(data).toMatchObject({
        app_version: "2.0.0",
        device_model: "Updated Device",
        active: true,
        revoked_at: null,
      });
    });

    test("body-supplied identity is ignored", async () => {
      const phone = `86${RUN_ID.slice(-8).padStart(8, "0")}`;
      const token = `fcm_test_identity_${RUN_ID}_abcdefghijklmnopqrstuvwxyz`;
      phones.push(phone);
      tokens.push(token);
      await seedProfile(client, phone, 0);

      const ctx = await newSignedContext(phone, 0);
      try {
        const res = await ctx.post("/api/native-push/devices", {
          data: {
            fcmToken: token,
            phone: "919999999999",
            actorType: "admin",
            providerId: "PR-ATTACK",
          },
        });
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.device.actorType).toBe("user");
        expect(body.device.providerId).toBeNull();
      } finally {
        await ctx.dispose();
      }

      const { data, error } = await client
        .from("native_push_devices")
        .select("phone, actor_type, provider_id")
        .eq("fcm_token", token)
        .single();
      expect(error?.message || "").toBe("");
      expect(data).toMatchObject({
        phone: canonicalPhone(phone),
        actor_type: "user",
        provider_id: null,
      });
    });
  });
});
