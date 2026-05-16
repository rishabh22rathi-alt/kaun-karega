// Push payload builders. All values that end up in FCM `data` MUST be strings;
// FCM rejects non-string values. Keep that invariant inside this module so
// callers cannot accidentally violate it.

export type PushEventType = "job_matched" | "chat_message" | "test";

export type PushDataPayload = {
  title: string;
  body: string;
  deepLink: string;
  eventType: PushEventType;
  sentAt: string;
  // Open record so per-event builders can add typed string fields
  // (taskId, threadId, displayId, etc.) without changing this base type.
  [extra: string]: string;
};

export function testPayload(): PushDataPayload {
  return {
    title: "Kaun Karega test",
    body: "Native push is working",
    deepLink: "/",
    eventType: "test",
    sentAt: new Date().toISOString(),
  };
}
