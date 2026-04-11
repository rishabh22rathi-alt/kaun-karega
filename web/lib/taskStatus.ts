export function getTaskStatusLabel(status: unknown): string {
  const normalizedStatus = String(status ?? "").trim().toLowerCase();

  switch (normalizedStatus) {
    case "submitted":
      return "Request received";
    case "notified":
      return "Providers notified";
    case "responded":
      return "A provider has responded";
    case "no_providers_matched":
      return "No providers available in your area yet";
    case "assigned":
      return "Provider assigned";
    case "completed":
      return "Work completed";
    default:
      return String(status ?? "").trim() || "-";
  }
}
