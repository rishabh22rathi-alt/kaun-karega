type TaskDisplayInput =
  | {
      DisplayID?: unknown;
      displayId?: unknown;
      TaskID?: unknown;
      taskId?: unknown;
    }
  | string
  | number
  | null
  | undefined;

function normalizeDisplayId(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const digits = raw.match(/\d+/)?.[0] || "";
  if (!digits) return "";

  const normalized = String(Number(digits) || "");
  return normalized && normalized !== "0" ? normalized : "";
}

function normalizeTaskId(value: unknown): string {
  return String(value ?? "").trim();
}

export function getTaskDisplayLabel(
  input: TaskDisplayInput,
  fallbackTaskId = ""
): string {
  if (input && typeof input === "object") {
    const displayId = normalizeDisplayId(input.DisplayID ?? input.displayId);
    if (displayId) return `Kaam No. ${displayId}`;

    const taskId = normalizeTaskId(input.TaskID ?? input.taskId);
    return taskId || normalizeTaskId(fallbackTaskId);
  }

  const displayId = normalizeDisplayId(input);
  if (displayId) return `Kaam No. ${displayId}`;

  return normalizeTaskId(fallbackTaskId);
}
