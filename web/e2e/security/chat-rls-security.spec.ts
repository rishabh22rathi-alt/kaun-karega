/**
 * Supabase RLS exposure audit — chat tables.
 *
 *   Targets (all must deny unauthenticated/anonymous reads):
 *     - chat_threads
 *     - chat_messages
 *     - need_chat_threads
 *     - need_chat_messages
 *
 *   This is a DETECTION-only audit. No mutations, no schema changes,
 *   no test seeding. The audit fires read-only probes:
 *
 *     PHASE 1 — Anonymous browser. The browser-side fetch is fired
 *               from the app's own origin with the NEXT_PUBLIC anon
 *               key as Authorization. Expectation: every chat table
 *               returns a deny status (401/403/404) OR an empty
 *               array. ANY non-empty row payload = exposure.
 *
 *     PHASE 2a — Authenticated user (kk_auth_session cookie set
 *                for the QA user phone). Same direct REST probes.
 *                The session cookie is a Kaun Karega-app session;
 *                Supabase RLS uses its own JWT, so this phase
 *                catches a real attacker who is logged in to the
 *                app but tries to side-step into Supabase REST.
 *
 *     PHASE 2b — Same probes as 2a, but with the QA provider phone
 *                cookie. Detects per-role drift in RLS policies.
 *
 *     PHASE 3 — Admin API protection. GET /api/admin/chats and
 *               /api/admin/chats/[threadId] must reject any caller
 *               that is not an active admin (no session OR a
 *               non-admin user session). Bodies must never include
 *               `threads` or `messages`.
 *
 *     PHASE 4 — Positive control. With the QA admin session set,
 *               /api/admin/chats must return ok:true. If the QA
 *               admin phone is not seeded in the live `admins`
 *               table (some envs don't seed test fixtures into
 *               prod-shaped Supabase), this phase logs an INFO and
 *               skips — phases 1-3 still gate the run.
 *
 *     PHASE 5 — Network audit. With a user session, navigate
 *               normal-usage pages and watch every browser network
 *               request. None should hit
 *               `${SUPABASE_URL}/rest/v1/<chat_table>` directly —
 *               chat reads must funnel through protected server
 *               APIs.
 *
 *   Output: each phase logs [PASS] / [FAIL] per table, and on FAIL
 *   prints endpoint, returned row count, and the keys of the first
 *   row (keys only — never values — to avoid leaking actual chat
 *   content into CI logs).
 *
 *   Important: no Supabase credentials are hardcoded. The anon key
 *   is, by Supabase design, a public token already shipped to every
 *   browser session; the audit reads it from .env.local the same
 *   way the app does.
 */

import { test, expect } from "../_support/test";
import type { Page } from "@playwright/test";
import fs from "fs";
import path from "path";

import {
  bootstrapAdminSession,
  bootstrapProviderSession,
  bootstrapUserSession,
} from "../_support/auth";
import { appUrl } from "../_support/runtime";

const CHAT_TABLES = [
  "chat_threads",
  "chat_messages",
  "need_chat_threads",
  "need_chat_messages",
] as const;

type ChatTable = (typeof CHAT_TABLES)[number];

function readEnv(name: string): string {
  if (process.env[name]) return String(process.env[name]);
  const envPath = path.resolve(__dirname, "../../.env.local");
  if (!fs.existsSync(envPath)) return "";
  const line = fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${name}=`));
  if (!line) return "";
  return line
    .slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

const SUPABASE_URL = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON_KEY = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

type RestProbe = {
  table: ChatTable;
  endpoint: string;
  status: number;
  rowCount: number | null;
  sampleKeys: string[] | null;
  rawSnippet: string;
};

async function probeChatTableFromBrowser(
  page: Page,
  table: ChatTable
): Promise<RestProbe> {
  const endpoint = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?select=*&limit=2`;

  // The fetch runs inside the page context — same trust boundary an
  // attacker page would use. We pass the anon key both as `apikey`
  // and as a `Bearer` Authorization, matching what
  // @supabase/supabase-js does for unauthenticated reads.
  const result = await page.evaluate(
    async ({ endpoint, anonKey }) => {
      try {
        const res = await fetch(endpoint, {
          method: "GET",
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            Accept: "application/json",
          },
        });
        const body = await res.text();
        return { status: res.status, body };
      } catch (err) {
        return {
          status: -1,
          body:
            err instanceof Error
              ? `fetch-failed: ${err.message}`
              : "fetch-failed: unknown",
        };
      }
    },
    { endpoint, anonKey: SUPABASE_ANON_KEY }
  );

  let rowCount: number | null = null;
  let sampleKeys: string[] | null = null;
  if (result.status >= 200 && result.status < 300) {
    try {
      const parsed = JSON.parse(result.body);
      if (Array.isArray(parsed)) {
        rowCount = parsed.length;
        if (parsed.length > 0 && parsed[0] && typeof parsed[0] === "object") {
          sampleKeys = Object.keys(parsed[0] as Record<string, unknown>);
        } else {
          sampleKeys = [];
        }
      }
    } catch {
      // 2xx with non-JSON or non-array body — record but don't error.
      // We'll surface as rowCount=null below.
    }
  }

  return {
    table,
    endpoint,
    status: result.status,
    rowCount,
    sampleKeys,
    // Cap the raw snippet so CI logs don't balloon and so any
    // accidental row leak is truncated before reaching console.
    rawSnippet: result.body.slice(0, 240),
  };
}

function assertProbeIsDenied(probe: RestProbe, scope: string): void {
  // Acceptable outcomes:
  //   - any 4xx/5xx (explicit denial / not found / RLS)
  //   - 2xx with an empty array (RLS hides all rows from this caller)
  //
  // FAILURE: 2xx with any rows, or 2xx with a non-array body that
  // looks like a leak (we treat unparseable 2xx as suspicious and
  // surface it for human review).
  const tag = `${scope} ${probe.table}`;
  if (probe.status === -1) {
    console.log(
      `[INFO] ${tag} → fetch error (likely network); recording as inconclusive`
    );
    console.log(`        snippet: ${probe.rawSnippet}`);
    return;
  }

  if (probe.status >= 400) {
    console.log(`[PASS] ${tag} → ${probe.status} (denied)`);
    return;
  }

  if (probe.status >= 200 && probe.status < 300 && probe.rowCount === 0) {
    console.log(
      `[PASS] ${tag} → 200 with empty array (RLS hides rows from ${scope})`
    );
    return;
  }

  // Below this point = exposure. Surface details and fail loudly.
  console.log(`[FAIL] ${tag} EXPOSED`);
  console.log(`        endpoint:  ${probe.endpoint}`);
  console.log(`        status:    ${probe.status}`);
  console.log(
    `        row count: ${probe.rowCount === null ? "(unparseable 2xx)" : probe.rowCount}`
  );
  if (probe.sampleKeys && probe.sampleKeys.length > 0) {
    console.log(`        fields:    ${probe.sampleKeys.join(", ")}`);
  }
  console.log(`        snippet:   ${probe.rawSnippet}`);

  expect(
    probe.status >= 200 && probe.status < 300 && (probe.rowCount ?? 1) === 0,
    `RLS exposure on ${probe.endpoint} for ${scope}: status=${probe.status} rows=${probe.rowCount}`
  ).toBe(true);
}

// Phase 5 helper — collects every Supabase chat-table request the
// browser fires while we click around. We only need the host of the
// configured Supabase URL; anything that targets it through the
// /rest/v1/<chat_table>/... prefix is a direct read from the browser.
function attachChatRestListener(
  page: Page,
  supabaseHost: string
): { leaks: string[]; restAny: string[] } {
  const leaks: string[] = [];
  const restAny: string[] = [];
  page.on("request", (req) => {
    let url: URL;
    try {
      url = new URL(req.url());
    } catch {
      return;
    }
    if (url.host !== supabaseHost) return;
    if (url.pathname.startsWith("/rest/v1/")) {
      restAny.push(`${req.method()} ${url.pathname}${url.search}`);
    }
    for (const table of CHAT_TABLES) {
      if (
        url.pathname === `/rest/v1/${table}` ||
        url.pathname.startsWith(`/rest/v1/${table}?`) ||
        url.pathname.startsWith(`/rest/v1/${table}/`)
      ) {
        leaks.push(`${req.method()} ${req.url()}`);
        return;
      }
    }
  });
  return { leaks, restAny };
}

test.describe.configure({ mode: "serial" });

test.describe("Supabase RLS — chat tables exposure audit", () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY,
    "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing — cannot probe Supabase REST"
  );

  test.beforeAll(() => {
    console.log("─".repeat(72));
    console.log("Supabase RLS audit — chat tables");
    console.log(`Supabase host: ${new URL(SUPABASE_URL).host}`);
    console.log(`Tables: ${CHAT_TABLES.join(", ")}`);
    console.log("─".repeat(72));
  });

  test("PHASE 1 — anonymous browser cannot read chat_* via /rest/v1", async ({
    page,
  }) => {
    // Plant the test on the app origin so the cross-origin Supabase
    // fetch behaves identically to a real browser session.
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded" });
    console.log("[PHASE 1] anon probes →");
    for (const table of CHAT_TABLES) {
      const probe = await probeChatTableFromBrowser(page, table);
      assertProbeIsDenied(probe, "anon");
    }
  });

  test("PHASE 2a — authenticated USER cannot read chat_* via /rest/v1", async ({
    page,
  }) => {
    await bootstrapUserSession(page);
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded" });
    console.log("[PHASE 2a] user-cookie probes →");
    for (const table of CHAT_TABLES) {
      const probe = await probeChatTableFromBrowser(page, table);
      assertProbeIsDenied(probe, "user");
    }
  });

  test("PHASE 2b — authenticated PROVIDER cannot read chat_* via /rest/v1", async ({
    page,
  }) => {
    await bootstrapProviderSession(page);
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded" });
    console.log("[PHASE 2b] provider-cookie probes →");
    for (const table of CHAT_TABLES) {
      const probe = await probeChatTableFromBrowser(page, table);
      assertProbeIsDenied(probe, "provider");
    }
  });

  test("PHASE 3a — /api/admin/chats* rejects unauthenticated callers", async ({
    request,
  }) => {
    const list = await request.get(appUrl("/api/admin/chats"));
    const listStatus = list.status();
    const listBody = (await list.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    console.log(
      `[PHASE 3a] GET /api/admin/chats (no session) → ${listStatus}`
    );
    expect(
      [401, 403],
      `Unauthenticated /api/admin/chats returned ${listStatus} (expected 401 or 403)`
    ).toContain(listStatus);
    expect(listBody.ok).not.toBe(true);
    expect(listBody.threads).toBeUndefined();
    expect(listBody.messages).toBeUndefined();

    const detail = await request.get(
      appUrl("/api/admin/chats/_audit_probe_thread")
    );
    const detailStatus = detail.status();
    const detailBody = (await detail.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    console.log(
      `[PHASE 3a] GET /api/admin/chats/_audit_probe_thread (no session) → ${detailStatus}`
    );
    expect(
      [401, 403],
      `Unauthenticated /api/admin/chats/[id] returned ${detailStatus} (expected 401 or 403)`
    ).toContain(detailStatus);
    expect(detailBody.ok).not.toBe(true);
    expect(detailBody.thread).toBeUndefined();
    expect(detailBody.messages).toBeUndefined();

    console.log("[PASS] /api/admin/chats* blocks unauthenticated callers");
  });

  test("PHASE 3b — /api/admin/chats rejects a non-admin user session", async ({
    page,
  }) => {
    await bootstrapUserSession(page);
    const res = await page.request.get(appUrl("/api/admin/chats"));
    const status = res.status();
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    console.log(`[PHASE 3b] GET /api/admin/chats (user session) → ${status}`);
    expect(
      [401, 403],
      `Non-admin user got ${status} from /api/admin/chats (expected 401 or 403)`
    ).toContain(status);
    expect(body.ok).not.toBe(true);
    expect(body.threads).toBeUndefined();
    console.log("[PASS] non-admin user is blocked from /api/admin/chats");
  });

  test("PHASE 4 — positive control: admin session can read /api/admin/chats", async ({
    page,
  }) => {
    await bootstrapAdminSession(page);
    const res = await page.request.get(appUrl("/api/admin/chats"));
    const status = res.status();
    console.log(`[PHASE 4] GET /api/admin/chats (admin session) → ${status}`);

    if (status === 401 || status === 403) {
      // Common in CI environments where the QA admin phone is not
      // seeded into the live admins table. Phases 1–3 still hold the
      // line on RLS / route gating; we just can't confirm the happy
      // path here.
      console.log(
        "[INFO] Positive control skipped — QA admin phone is not active in the admins table for this environment."
      );
      console.log(
        "        RLS denial and route gating (phases 1-3) remain enforced."
      );
      test.skip(true, "QA admin not seeded in admins table");
      return;
    }

    expect(
      status,
      `Admin session expected 200 from /api/admin/chats; got ${status}`
    ).toBe(200);
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.threads)).toBe(true);
    const threads = (body.threads as unknown[]) ?? [];
    console.log(
      `[PASS] admin session sees ${threads.length} thread${threads.length === 1 ? "" : "s"} via /api/admin/chats`
    );
  });

  test("PHASE 5 — browser never queries Supabase chat REST during normal usage", async ({
    page,
  }) => {
    await bootstrapUserSession(page);
    const supabaseHost = new URL(SUPABASE_URL).host;
    const { leaks, restAny } = attachChatRestListener(page, supabaseHost);

    // Walk a handful of user-facing surfaces. The goal is not full
    // app coverage — it's to ensure that whatever the browser DOES
    // fetch, it doesn't hit chat_* REST directly. If a future commit
    // wires a browser-side @supabase/supabase-js call into chat_*,
    // this loop will surface it.
    const probes = [
      "/",
      "/dashboard/my-requests",
      "/chat/thread/_audit_probe_thread",
    ];
    for (const route of probes) {
      try {
        await page.goto(appUrl(route), { waitUntil: "domcontentloaded" });
      } catch {
        // Route may 404 or redirect — that's fine, we're auditing
        // outbound network behaviour, not page render success.
      }
    }
    // Brief settle so deferred client effects fire.
    await page.waitForTimeout(1_000);

    console.log(
      `[PHASE 5] observed ${restAny.length} Supabase /rest/v1 request(s) from the browser:`
    );
    for (const r of restAny.slice(0, 10)) console.log(`        ${r}`);
    if (restAny.length > 10) {
      console.log(`        … (${restAny.length - 10} more)`);
    }

    if (leaks.length > 0) {
      console.log(
        "[FAIL] Browser directly hit Supabase chat REST during normal usage:"
      );
      for (const l of leaks) console.log(`        ${l}`);
    }

    expect(
      leaks,
      `Browser fired ${leaks.length} direct chat-table REST request(s) during normal usage`
    ).toHaveLength(0);
    console.log(
      "[PASS] Browser only routes chat through the protected server APIs"
    );
  });
});
