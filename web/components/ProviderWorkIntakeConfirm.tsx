"use client";

import type {
  WorkIntakeMainCategory,
  WorkIntakeReason,
  WorkIntakeWorkTag,
} from "@/lib/workIntake/types";

// Discriminated-union shape consumed by the registration page. Defined here
// because the panel is the only consumer that pattern-matches on `kind`; the
// page just builds + forwards these values. If a third consumer appears, lift
// to lib/workIntake/types.ts.
export type IntakeState =
  | { kind: "idle" }
  | { kind: "resolving"; text: string }
  | {
      kind: "green";
      text: string;
      mainCategory: WorkIntakeMainCategory;
      workTags: WorkIntakeWorkTag[];
    }
  | {
      kind: "yellow";
      text: string;
      mainCategory: WorkIntakeMainCategory | null;
      workTags: WorkIntakeWorkTag[];
      reason: WorkIntakeReason;
    }
  | { kind: "red"; text: string }
  | { kind: "manual"; reason: WorkIntakeReason };

type Props = {
  intake: IntakeState;
  onUse: () => void;
  onDismiss: () => void;
  onRetry: () => void;
};

const PANEL_BASE =
  "mt-2 rounded-xl border px-3 py-2.5 text-sm shadow-sm";
const BUTTON_PRIMARY =
  "inline-flex items-center rounded-full bg-[#003d20] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#002a16] disabled:cursor-not-allowed disabled:opacity-60";
const BUTTON_SECONDARY =
  "inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50";

/**
 * Pure presentation. Renders one of five states. Owns no state, no network,
 * no business rules — every action is forwarded to a parent callback. The
 * parent decides whether a click mutates selection or just dismisses.
 *
 * `idle` renders nothing so the parent can keep this mounted unconditionally
 * without producing an empty box.
 */
export default function ProviderWorkIntakeConfirm({
  intake,
  onUse,
  onDismiss,
  onRetry,
}: Props) {
  if (intake.kind === "idle") return null;

  return (
    <div
      data-testid="kk-work-intake-confirm"
      data-kk-confirm-state={intake.kind}
      role="status"
      aria-live="polite"
      className={`${PANEL_BASE} ${
        intake.kind === "green"
          ? "border-green-300 bg-green-50/70"
          : intake.kind === "yellow"
          ? "border-amber-300 bg-amber-50/70"
          : intake.kind === "red"
          ? "border-red-300 bg-red-50/70"
          : "border-slate-300 bg-slate-50/70"
      }`}
    >
      {/* Hidden machine-readable state for tests. Independent of the data
          attribute on the wrapper so locators can match either. */}
      <span data-testid="kk-work-intake-confirm-state" hidden>
        {intake.kind}
      </span>

      {intake.kind === "resolving" ? (
        <p className="text-sm font-medium text-slate-700">
          Understanding your work…
        </p>
      ) : null}

      {intake.kind === "green" ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-800">
            We understood your work as:
          </p>
          <p className="text-sm text-slate-700">
            <span className="font-semibold">Main service:</span>{" "}
            <span data-testid="kk-work-intake-confirm-canonical">
              {intake.mainCategory.canonical}
            </span>
          </p>
          {intake.workTags.length > 0 ? (
            <p className="text-sm text-slate-700">
              <span className="font-semibold">Work types:</span>{" "}
              <span data-testid="kk-work-intake-confirm-tags">
                {intake.workTags.map((t) => t.label).join(", ")}
              </span>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              data-testid="kk-work-intake-confirm-use"
              onClick={onUse}
              className={BUTTON_PRIMARY}
            >
              Use this
            </button>
            <button
              type="button"
              data-testid="kk-work-intake-confirm-dismiss"
              onClick={onDismiss}
              className={BUTTON_SECONDARY}
            >
              Edit manually
            </button>
          </div>
        </div>
      ) : null}

      {intake.kind === "yellow" ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-800">
            We could not match this exactly yet.
          </p>
          <p className="text-sm text-slate-700">
            Please choose from the list below or add it as a new service for
            review.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              data-testid="kk-work-intake-confirm-retry"
              onClick={onRetry}
              className={BUTTON_PRIMARY}
            >
              Try different wording
            </button>
            <button
              type="button"
              data-testid="kk-work-intake-confirm-dismiss"
              onClick={onDismiss}
              className={BUTTON_SECONDARY}
            >
              Choose manually
            </button>
          </div>
        </div>
      ) : null}

      {intake.kind === "red" ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-red-800">
            This type of work cannot be listed on Kaun Karega.
          </p>
          <p className="text-sm text-slate-700">
            Please enter a different legal service.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              data-testid="kk-work-intake-confirm-dismiss"
              onClick={onDismiss}
              className={BUTTON_PRIMARY}
            >
              Type something else
            </button>
          </div>
        </div>
      ) : null}

      {intake.kind === "manual" ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-800">
            Smart help is not available right now.
          </p>
          <p className="text-sm text-slate-700">
            Please choose your service manually.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              data-testid="kk-work-intake-confirm-dismiss"
              onClick={onDismiss}
              className={BUTTON_PRIMARY}
            >
              Continue manually
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
