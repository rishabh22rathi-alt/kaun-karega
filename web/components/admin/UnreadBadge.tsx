"use client";

import type { ReactElement } from "react";

// Mirror of the per-entry shape exposed by useAdminUnread. The tab
// components import this type to type their `unread` prop without
// reaching across into the hook file (kept loosely coupled so the
// hook can swap shape independently).
export type UnreadIndicator = {
  hasUnread: boolean;
  count: number;
  lastReadAt?: string;
};

type UnreadBadgeProps = {
  unread?: UnreadIndicator | null;
  // Optional label override. Defaults to the count when known,
  // otherwise "NEW". The wider component is sized so 1-2 digit
  // counts and the "NEW" string both fit cleanly into the
  // accordion header without forcing a layout reflow.
  label?: string;
  // When `dot` is true, render the compact red dot instead of the
  // pill badge. Used inside very tight header areas (e.g. when the
  // tab's title row already has its own count).
  dot?: boolean;
  // Optional test id so the security / unread spec can scope to the
  // specific tab's badge without a brittle text match.
  testId?: string;
};

const PILL_CLASS =
  "ml-2 inline-flex items-center justify-center rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide leading-none text-white shadow-sm";
const DOT_CLASS =
  "ml-2 inline-block h-2 w-2 shrink-0 rounded-full bg-orange-500 shadow-sm";

/**
 * Renders the unread indicator next to a tab title in the admin
 * dashboard accordion header. Returns `null` when there is nothing
 * unread — so the header stays the exact same size as before and
 * the layout never shifts when the dot disappears.
 */
export default function UnreadBadge({
  unread,
  label,
  dot,
  testId,
}: UnreadBadgeProps): ReactElement | null {
  if (!unread || !unread.hasUnread) return null;
  if (dot) {
    return (
      <span
        aria-label={label ?? "New activity"}
        data-testid={testId}
        className={DOT_CLASS}
      />
    );
  }
  // Pill mode — keep the chip narrow so mobile headers don't wrap.
  // We cap displayed counts at "99+" so a sudden burst of updates
  // doesn't push the chip wider than ~3ch.
  const text =
    label !== undefined
      ? label
      : unread.count > 99
        ? "99+"
        : unread.count > 0
          ? String(unread.count)
          : "NEW";
  return (
    <span
      aria-label={`${unread.count > 0 ? unread.count : ""} new`.trim() || "New activity"}
      data-testid={testId}
      className={PILL_CLASS}
    >
      {text}
    </span>
  );
}
