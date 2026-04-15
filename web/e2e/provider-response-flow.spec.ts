import { test, expect, type BrowserContext, type Page, type Route } from "@playwright/test";

const LIVE_ORIGIN = "https://kaun-karega.vercel.app";
const USER_PHONE = "9999999905";
const PROVIDER_PHONE = "9876543205";
const PROVIDER_ID = "ZZ-PROV-LIVE-005";
const PROVIDER_NAME = "ZZ QA Provider Five";
const TASK_ID = "TASK-ZZ-LIVE-005";
const DISPLAY_ID = "ZZ-QA-LIVE-005";
const THREAD_ID = "ZZ-THREAD-LIVE-005";
const CATEGORY = "Electrician";
const AREA = "Sardarpura";
const DETAILS = "ZZ QA live provider response flow test. Please ignore.";
const CREATED_AT = "2026-04-14T10:00:00.000Z";
const USER_MESSAGE = "Test message from user";

type ChatMessage = {
  MessageID: string;
  ThreadID: string;
  SenderType: "provider" | "user";
  MessageText: string;
  CreatedAt: string;
};

type FlowState = {
  messages: ChatMessage[];
  lastMessageAt: string;
};

function makeSessionCookieValue(phone: string): string {
  const session = JSON.stringify({ phone, verified: true, createdAt: Date.now() });
  return encodeURIComponent(session);
}

async function injectAuthCookie(context: BrowserContext, phone: string) {
  await context.addCookies([
    {
      name: "kk_auth_session",
      value: makeSessionCookieValue(phone),
      url: LIVE_ORIGIN,
      sameSite: "Lax",
      secure: true,
    },
  ]);
}

function makeThread(state: FlowState) {
  return {
    ThreadID: THREAD_ID,
    TaskID: TASK_ID,
    DisplayID: DISPLAY_ID,
    UserPhone: USER_PHONE,
    ProviderID: PROVIDER_ID,
    ProviderName: PROVIDER_NAME,
    Status: "active",
    LastMessageAt: state.lastMessageAt,
    CreatedAt: CREATED_AT,
  };
}

function makeUserRequest() {
  return {
    TaskID: TASK_ID,
    DisplayID: DISPLAY_ID,
    Category: CATEGORY,
    Area: AREA,
    Details: DETAILS,
    Status: "responded",
    CreatedAt: CREATED_AT,
    MatchedProviders: [PROVIDER_ID],
    MatchedProviderDetails: [
      {
        ProviderID: PROVIDER_ID,
        ProviderName: PROVIDER_NAME,
        ProviderPhone: PROVIDER_PHONE,
        Verified: "yes",
        ResponseStatus: "responded",
      },
    ],
    RespondedProvider: PROVIDER_ID,
    RespondedProviderName: PROVIDER_NAME,
  };
}

function makeProviderProfile(state: FlowState) {
  return {
    ok: true,
    provider: {
      ProviderID: PROVIDER_ID,
      ProviderName: PROVIDER_NAME,
      Phone: PROVIDER_PHONE,
      Verified: "yes",
      OtpVerified: "yes",
      PendingApproval: "no",
      Status: "Active",
      Services: [{ Category: CATEGORY }],
      Areas: [{ Area: AREA }],
      Analytics: {
        Summary: {
          ProviderID: PROVIDER_ID,
          Categories: [CATEGORY],
          Areas: [AREA],
        },
        Metrics: {
          TotalRequestsInMyCategories: 6,
          TotalRequestsMatchedToMe: 3,
          TotalRequestsRespondedByMe: 1,
          TotalRequestsAcceptedByMe: 0,
          TotalRequestsCompletedByMe: 0,
          ResponseRate: 33,
          AcceptanceRate: 0,
        },
        AreaDemand: [{ AreaName: AREA, RequestCount: 3 }],
        SelectedAreaDemand: [{ AreaName: AREA, RequestCount: 3, IsSelectedByProvider: true }],
        CategoryDemandByRange: {
          today: [{ CategoryName: CATEGORY, RequestCount: 3 }],
        },
        RecentMatchedRequests: [
          {
            TaskID: TASK_ID,
            DisplayID: DISPLAY_ID,
            Category: CATEGORY,
            Area: AREA,
            Details: DETAILS,
            CreatedAt: CREATED_AT,
            Responded: true,
            Accepted: false,
            ThreadID: THREAD_ID,
            LastMessageAt: state.lastMessageAt,
          },
        ],
      },
      AreaCoverage: {
        ActiveApprovedAreas: [{ Area: AREA, Status: "active" }],
        PendingAreaRequests: [],
        ResolvedOutcomes: [],
      },
    },
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installFlowRoutes(context: BrowserContext, state: FlowState) {
  await context.route("**/api/submit-request", async (route) => {
    await fulfillJson(route, {
      ok: true,
      taskId: TASK_ID,
      displayId: DISPLAY_ID,
    });
  });

  await context.route("**/api/process-task-notifications", async (route) => {
    await fulfillJson(route, {
      ok: true,
      skipped: true,
      matchedProviders: 1,
      attemptedSends: 0,
      failedSends: 0,
    });
  });

  await context.route("**/api/my-requests**", async (route) => {
    await fulfillJson(route, {
      ok: true,
      requests: [makeUserRequest()],
    });
  });

  await context.route("**/api/provider/dashboard-profile**", async (route) => {
    await fulfillJson(route, makeProviderProfile(state));
  });

  await context.route("**/api/kk**", async (route) => {
    let body: Record<string, unknown> = {};

    try {
      const parsed = route.request().postDataJSON();
      if (parsed && typeof parsed === "object") {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      const action = new URL(route.request().url()).searchParams.get("action");
      if (action) {
        body = { action };
      }
    }

    const action = String(body.action || "");

    switch (action) {
      case "chat_get_threads":
        await fulfillJson(route, {
          ok: true,
          threads: [
            {
              ThreadID: THREAD_ID,
              TaskID: TASK_ID,
              DisplayID: DISPLAY_ID,
              UserPhone: USER_PHONE,
              ProviderID: PROVIDER_ID,
              ProviderName: PROVIDER_NAME,
              UnreadUserCount: 0,
              UnreadProviderCount: 0,
              LastMessageAt: state.lastMessageAt,
              CreatedAt: CREATED_AT,
            },
          ],
        });
        return;

      case "chat_create_or_get_thread":
        await fulfillJson(route, {
          ok: true,
          created: false,
          ThreadID: THREAD_ID,
          thread: makeThread(state),
        });
        return;

      case "chat_get_messages":
        await fulfillJson(route, {
          ok: true,
          thread: makeThread(state),
          messages: state.messages,
        });
        return;

      case "chat_mark_read":
        await fulfillJson(route, { ok: true });
        return;

      case "chat_send_message": {
        const senderType = String(body.ActorType || "").trim().toLowerCase() === "provider"
          ? "provider"
          : "user";
        const message: ChatMessage = {
          MessageID: `MSG-${state.messages.length + 1}`,
          ThreadID: THREAD_ID,
          SenderType: senderType,
          MessageText: String(body.MessageText || "").trim(),
          CreatedAt: new Date().toISOString(),
        };

        state.messages = [...state.messages, message];
        state.lastMessageAt = message.CreatedAt;

        await fulfillJson(route, {
          ok: true,
          thread: makeThread(state),
          message,
        });
        return;
      }

      case "get_provider_by_phone":
        await fulfillJson(route, {
          ok: true,
          provider: {
            ProviderID: PROVIDER_ID,
            ProviderName: PROVIDER_NAME,
            Phone: PROVIDER_PHONE,
          },
        });
        return;

      default:
        await fulfillJson(route, { ok: true });
    }
  });
}

function logCurrentUrl(page: Page) {
  console.log("Current URL:", page.url());
}

test("provider response flow uses live baseURL and keeps chat/status navigation consistent", async ({
  page,
  context,
}) => {
  const state: FlowState = {
    messages: [
      {
        MessageID: "MSG-1",
        ThreadID: THREAD_ID,
        SenderType: "provider",
        MessageText: "Provider responded and is ready to chat.",
        CreatedAt: CREATED_AT,
      },
    ],
    lastMessageAt: CREATED_AT,
  };

  let providerPage: Page | undefined;

  const failureContext = () =>
    [
      `User URL: ${page.url()}`,
      `Provider URL: ${providerPage ? providerPage.url() : "not opened"}`,
    ].join("\n");

  await installFlowRoutes(context, state);
  await injectAuthCookie(context, USER_PHONE);

  try {
    await test.step("Phase 1 - open homepage", async () => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      logCurrentUrl(page);
      await expect(page).toHaveURL(/kaun-karega/);
    });

    await test.step("Phase 2 - navigate to request flow and submit a test task", async () => {
      const serviceInput = page
        .getByPlaceholder(/What service do you need/i)
        .or(page.locator("input[type='text']").first());

      await serviceInput.fill(CATEGORY);
      await serviceInput.press("Enter");

      await page.waitForURL(/\/request-flow/);
      await page.waitForLoadState("networkidle");
      logCurrentUrl(page);

      await expect(page).toHaveURL(/\/request-flow/);
      await expect(page.getByRole("heading", { name: CATEGORY })).toBeVisible();

      await page.getByRole("button", { name: "Right now" }).click();
      await page.getByRole("button", { name: AREA }).click();
      await page.getByPlaceholder("Describe your work in 1-2 sentences...").fill(DETAILS);

      await page.getByRole("button", { name: /submit request/i }).click();
      await page.waitForURL(/\/success/);
      await page.waitForLoadState("networkidle");
      logCurrentUrl(page);
    });

    await test.step("Phase 3 - open chat from my requests", async () => {
      await page.getByRole("link", { name: /go to my requests/i }).click();
      await page.waitForURL(/\/dashboard\/my-requests/);
      await page.waitForLoadState("networkidle");
      logCurrentUrl(page);

      await expect(page.getByText("Provider responded")).toBeVisible();
      await page.getByRole("button", { name: /view responses/i }).click();
      await page.getByRole("button", { name: /open chat/i }).click();

      await page.waitForURL(/\/chat\/thread\//);
      await page.waitForLoadState("networkidle");
      logCurrentUrl(page);
      await expect(page).toHaveURL(/\/chat\/thread\//);
    });

    await test.step("Phase 4 - wait for chat page to load", async () => {
      await expect(page.getByText("Loading chat...")).not.toBeVisible();
      await expect(page.getByText("User Chat")).toBeVisible();
      await expect(page.getByText(`Thread ID: ${THREAD_ID}`)).toBeVisible();
    });

    await test.step("Phase 5 - send a user message", async () => {
      await page.locator("textarea").fill(USER_MESSAGE);
      await page.keyboard.press("Enter");
      await page.waitForLoadState("networkidle");
      logCurrentUrl(page);

      await expect(page.getByText(USER_MESSAGE)).toBeVisible();
      await expect(page.getByText("You")).toBeVisible();
    });

    await test.step("Phase 6 - provider dashboard shows responded state and same chat thread", async () => {
      await injectAuthCookie(context, PROVIDER_PHONE);
      providerPage = await context.newPage();

      await providerPage.goto("/provider/dashboard");
      await providerPage.waitForLoadState("networkidle");
      logCurrentUrl(providerPage);

      await expect(providerPage).toHaveURL(/\/provider\/dashboard/);
      await expect(providerPage.getByText("Responded", { exact: true })).toBeVisible();
      await expect(providerPage.getByText(CATEGORY).first()).toBeVisible();

      await providerPage.getByRole("button", { name: /open chat/i }).click();
      await providerPage.waitForURL(new RegExp(`/chat/thread/${THREAD_ID}$`));
      await providerPage.waitForLoadState("networkidle");
      logCurrentUrl(providerPage);

      await expect(providerPage.getByText("Loading chat...")).not.toBeVisible();
      await expect(providerPage.getByText("Provider Chat")).toBeVisible();
      await expect(providerPage.getByText(`Thread ID: ${THREAD_ID}`)).toBeVisible();
      await expect(providerPage.getByText(USER_MESSAGE)).toBeVisible();
    });
  } catch (error) {
    console.log("Current URL:", page.url());
    if (providerPage) {
      console.log("Current URL:", providerPage.url());
    }

    throw new Error(
      `${
        error instanceof Error ? error.message : String(error)
      }\n${failureContext()}`
    );
  } finally {
    if (providerPage) {
      await providerPage.close();
    }
  }
});
