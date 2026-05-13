/**
 * Unit-style verification for the pure lifecycle classifier used by
 * GET /api/admin/kaam.
 *
 * The repo has no jest/vitest harness — Playwright is the only test
 * runner wired up. Playwright's `test()` runs in a Node context, so we
 * can import the pure function directly and assert on its output
 * without spinning up a browser context.
 *
 * One scenario per branch of computeLifecycleStatus, in the priority
 * order defined by the spec. The function is import-only — these tests
 * never touch the database.
 */

import {
  computeLifecycleStatus,
  type LifecycleInput,
} from "../lib/admin/kaamLifecycle";
import { test, expect } from "@playwright/test";

function emptyInput(overrides: Partial<LifecycleInput> = {}): LifecycleInput {
  return {
    status: null,
    closedAt: null,
    closedBy: null,
    closeReason: null,
    matchStatuses: [],
    notificationStatuses: [],
    chatSenderTypes: [],
    ...overrides,
  };
}

test.describe("computeLifecycleStatus — pure classifier", () => {
  test("Task Created — only the task row exists, no downstream evidence", () => {
    expect(computeLifecycleStatus(emptyInput({ status: "submitted" }))).toBe(
      "Task Created"
    );
    expect(computeLifecycleStatus(emptyInput({ status: null }))).toBe(
      "Task Created"
    );
    // Even a raw status the spec treats as "pending_category_review"
    // resolves to Task Created at the lifecycle layer — the
    // attention flag is a separate dimension handled by the route.
    expect(
      computeLifecycleStatus(
        emptyInput({ status: "pending_category_review" })
      )
    ).toBe("Task Created");
  });

  test("Matched — provider_task_matches row exists with no further signal", () => {
    expect(
      computeLifecycleStatus(
        emptyInput({ status: "submitted", matchStatuses: ["matched"] })
      )
    ).toBe("Matched");
  });

  test("Providers Notified — notification_logs accepted", () => {
    expect(
      computeLifecycleStatus(
        emptyInput({
          status: "submitted",
          matchStatuses: ["matched"],
          notificationStatuses: ["accepted"],
        })
      )
    ).toBe("Providers Notified");
  });

  test("Providers Notified — tasks.status === 'notified' is enough on its own", () => {
    expect(
      computeLifecycleStatus(emptyInput({ status: "notified" }))
    ).toBe("Providers Notified");
  });

  test("Providers Notified — match_status='notified' alone qualifies", () => {
    expect(
      computeLifecycleStatus(
        emptyInput({ matchStatuses: ["matched", "notified"] })
      )
    ).toBe("Providers Notified");
  });

  test("Provider Responded — status flips to 'provider_responded'", () => {
    expect(
      computeLifecycleStatus(
        emptyInput({
          status: "provider_responded",
          matchStatuses: ["matched"],
          notificationStatuses: ["accepted"],
        })
      )
    ).toBe("Provider Responded");
  });

  test("Provider Responded — single provider-side chat message", () => {
    // The notification/match signals would otherwise classify this as
    // Providers Notified — the provider chat message escalates it.
    expect(
      computeLifecycleStatus(
        emptyInput({
          status: "notified",
          matchStatuses: ["matched"],
          notificationStatuses: ["accepted"],
          chatSenderTypes: ["provider"],
        })
      )
    ).toBe("Provider Responded");
  });

  test("Provider Responded — match_status='responded' qualifies", () => {
    expect(
      computeLifecycleStatus(
        emptyInput({
          status: "notified",
          matchStatuses: ["responded"],
        })
      )
    ).toBe("Provider Responded");
  });

  test("Completed / Closed — tasks.status === 'closed'", () => {
    expect(
      computeLifecycleStatus(emptyInput({ status: "closed" }))
    ).toBe("Completed / Closed");
  });

  test("Completed / Closed — closed_at is set, regardless of raw status", () => {
    expect(
      computeLifecycleStatus(
        emptyInput({
          status: "submitted",
          closedAt: "2026-05-13T11:00:00.000Z",
          closedBy: "user",
          closeReason: "withdrawn",
        })
      )
    ).toBe("Completed / Closed");
  });

  test("Completed / Closed — both provider AND user chat messages exist (display-only rule)", () => {
    // Raw status still says 'notified' — the function must not write
    // anything back to a hypothetical task; it just classifies. The
    // spec is explicit that this rule does NOT close the chat.
    expect(
      computeLifecycleStatus(
        emptyInput({
          status: "notified",
          chatSenderTypes: ["provider", "user"],
        })
      )
    ).toBe("Completed / Closed");
  });

  test("Completed / Closed wins over Provider Responded even with chat from one side", () => {
    // closure beats responses — admin should always see the resolved
    // state when the task is closed.
    expect(
      computeLifecycleStatus(
        emptyInput({
          status: "completed",
          chatSenderTypes: ["provider"],
        })
      )
    ).toBe("Completed / Closed");
  });

  test("Only provider chat (no user) stays at Provider Responded, NOT Completed", () => {
    // Guard against the "both sides chatted" rule from over-triggering.
    // Single-sided conversation is a Provider Responded signal only.
    expect(
      computeLifecycleStatus(
        emptyInput({
          chatSenderTypes: ["provider", "provider"],
        })
      )
    ).toBe("Provider Responded");
  });

  test("Only user chat (no provider) stays at Task Created — user can't escalate alone", () => {
    // The spec's Completed-by-chat rule requires BOTH sides. A
    // self-replying user without any provider message has no
    // independent lifecycle signal, so we fall back to Task Created.
    expect(
      computeLifecycleStatus(
        emptyInput({ chatSenderTypes: ["user", "user"] })
      )
    ).toBe("Task Created");
  });

  test("Priority — Completed beats Notified, which beats Matched, which beats Created", () => {
    // The closure signal trumps everything below it.
    expect(
      computeLifecycleStatus(
        emptyInput({
          status: "notified",
          matchStatuses: ["matched", "responded"],
          notificationStatuses: ["accepted"],
          chatSenderTypes: ["provider", "user"],
          closedAt: "2026-05-13T12:00:00.000Z",
        })
      )
    ).toBe("Completed / Closed");
  });
});
