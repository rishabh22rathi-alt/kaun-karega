"use client";

// TODO: Switch to one-time localStorage gate after QA approval. For now this
// coachmark renders on every dashboard mount so testers can validate the flow
// repeatedly without clearing storage.

import { useCallback, useEffect, useMemo, useState } from "react";

type TourStep = {
  key: string;
  title: string;
  text: string;
  selector: string;
};

type TargetBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const STEPS: TourStep[] = [
  {
    key: "profile",
    title: "Provider Profile",
    text: "This shows your provider identity and verification status.",
    selector: '[data-provider-tour="profile"]',
  },
  {
    key: "open-requests",
    title: "Open Requests",
    text: "Check here to see if any new customer requests are waiting.",
    selector: '[data-provider-tour="open-requests"]',
  },
  {
    key: "metrics",
    title: "Dashboard Metrics",
    text: "Track demand, matched leads, and your responses.",
    selector: '[data-provider-tour="metrics"]',
  },
  // Demand Insights step removed — BI sections deferred from MVP. Auto-skip
  // logic for missing selectors is intentionally retained as a safety net.
  {
    key: "services",
    title: "Services & Areas",
    text: "Keep your services and areas updated for better matching.",
    selector: '[data-provider-tour="services"]',
  },
];

export default function ProviderDashboardCoachmark() {
  const [isVisible, setIsVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetBox, setTargetBox] = useState<TargetBox | null>(null);

  const step = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;
  const isFirstStep = stepIndex === 0;

  const finish = useCallback(() => {
    // TODO: Persist a "seen" flag here once QA approves the flow.
    setIsVisible(false);
  }, []);

  const goNext = useCallback(() => {
    setStepIndex((current) =>
      current >= STEPS.length - 1 ? current : current + 1
    );
  }, []);

  const goBack = useCallback(() => {
    setStepIndex((current) => Math.max(0, current - 1));
  }, []);

  const updateTarget = useCallback(() => {
    if (typeof document === "undefined") return;
    const element = document.querySelector<HTMLElement>(step.selector);
    if (!element) {
      setTargetBox(null);
      return;
    }
    const rect = element.getBoundingClientRect();
    setTargetBox({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    });
  }, [step.selector]);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsVisible(true), 700);
    return () => window.clearTimeout(timer);
  }, []);

  // If the active step's section is missing in the DOM, advance past it so the
  // tour does not stall on optional sections.
  useEffect(() => {
    if (!isVisible) return;
    if (typeof document === "undefined") return;
    if (document.querySelector(step.selector)) return;

    if (isLastStep) {
      finish();
      return;
    }
    const timer = window.setTimeout(() => goNext(), 0);
    return () => window.clearTimeout(timer);
  }, [finish, goNext, isLastStep, isVisible, step.selector]);

  useEffect(() => {
    if (!isVisible) return;
    const frame = window.requestAnimationFrame(updateTarget);
    window.addEventListener("resize", updateTarget);
    window.addEventListener("scroll", updateTarget, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateTarget);
      window.removeEventListener("scroll", updateTarget, true);
    };
  }, [isVisible, updateTarget]);

  useEffect(() => {
    if (!isVisible) return;
    const frame = window.requestAnimationFrame(updateTarget);
    return () => window.cancelAnimationFrame(frame);
  }, [isVisible, stepIndex, updateTarget]);

  // Smoothly scroll the active section into view on each step change.
  useEffect(() => {
    if (!isVisible) return;
    if (typeof document === "undefined") return;
    const element = document.querySelector<HTMLElement>(step.selector);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isVisible, step.selector]);

  const ringStyle = useMemo(() => {
    if (!targetBox) return undefined;
    return {
      top: targetBox.top - 8,
      left: targetBox.left - 8,
      width: targetBox.width + 16,
      height: targetBox.height + 16,
    };
  }, [targetBox]);

  const cardStyle = useMemo(() => {
    if (!targetBox || typeof window === "undefined") {
      return {
        top: "44vh",
        left: "50vw",
        transform: "translateX(-50%)",
      };
    }
    const preferBelow = targetBox.top < window.innerHeight * 0.55;
    const top = preferBelow
      ? Math.min(targetBox.top + targetBox.height + 20, window.innerHeight - 220)
      : Math.max(targetBox.top - 200, 18);
    const left = Math.min(
      Math.max(targetBox.left + targetBox.width / 2, 180),
      window.innerWidth - 180
    );
    return {
      top,
      left,
      transform: "translateX(-50%)",
    };
  }, [targetBox]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[80] pointer-events-none">
      {ringStyle && (
        <div
          aria-hidden="true"
          className="fixed rounded-2xl border-2 border-orange-300/80 shadow-[0_0_0_8px_rgba(249,115,22,0.10),0_0_34px_rgba(249,115,22,0.30)] transition-all duration-500 kk-provider-tour-pulse"
          style={ringStyle}
        />
      )}

      <div
        role="dialog"
        aria-live="polite"
        aria-label="Provider dashboard guide"
        className="fixed w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-orange-100 bg-white p-4 text-left shadow-[0_20px_60px_rgba(15,23,42,0.18)] pointer-events-auto transition-all duration-500"
        style={cardStyle}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-500">
              Step {stepIndex + 1} of {STEPS.length}
            </p>
            <h2 className="mt-1 text-base font-bold text-[#003d20]">
              {step.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={finish}
            className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-400 transition hover:bg-slate-50 hover:text-slate-700"
          >
            Skip
          </button>
        </div>

        <p className="text-sm leading-6 text-slate-600">{step.text}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex gap-1.5">
            {STEPS.map((item, index) => (
              <span
                key={item.key}
                className={`h-1.5 rounded-full transition-all ${
                  index === stepIndex ? "w-5 bg-orange-500" : "w-1.5 bg-orange-200"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!isFirstStep && (
              <button
                type="button"
                onClick={goBack}
                className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm font-bold text-[#003d20] transition hover:bg-orange-50"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (isLastStep) {
                  finish();
                  return;
                }
                goNext();
              }}
              className="rounded-xl bg-[#003d20] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#002a15]"
            >
              {isLastStep ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .kk-provider-tour-pulse {
          animation: kk-provider-tour-pulse 1.7s ease-in-out infinite;
        }
        @keyframes kk-provider-tour-pulse {
          0%, 100% {
            box-shadow: 0 0 0 8px rgba(249, 115, 22, 0.1), 0 0 34px rgba(249, 115, 22, 0.3);
          }
          50% {
            box-shadow: 0 0 0 14px rgba(249, 115, 22, 0.04), 0 0 42px rgba(249, 115, 22, 0.36);
          }
        }
      `}</style>
    </div>
  );
}
