"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// One-time-display gate. Renamed from kk_first_visit_guide_seen_v1 to
// align with the shared coachmark naming scheme; bumping to v1 of the new
// key intentionally re-shows the guide to users on their next visit so the
// fresh copy/steps are surfaced once.
const STORAGE_KEY = "kk_home_coachmark_seen_v1";

type TourStep = {
  key: string;
  title: string;
  text: string;
  selector: string;
  fakeTyping?: string;
};

type TargetBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const STEPS: TourStep[] = [
  {
    key: "service",
    title: "What you need?",
    text: "Type the service you need, like Electrician, AC Repair, Plumber.",
    selector: '[data-tour="service"]',
    fakeTyping: "AC Repair",
  },
  {
    key: "area",
    title: "Where you need?",
    text: "Select your area in Jodhpur.",
    selector: '[data-tour="area"]',
  },
  {
    key: "time",
    title: "When you need?",
    text: "Choose your preferred time.",
    selector: '[data-tour="time"]',
  },
  {
    key: "submit",
    title: "Find Providers",
    text: "Tap here and we'll notify relevant providers.",
    selector: '[data-tour="submit"]',
  },
];

export default function FirstVisitCoachmark() {
  const [isVisible, setIsVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetBox, setTargetBox] = useState<TargetBox | null>(null);

  const step = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;

  const markSeen = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Ignore storage failures; closing the guide should still work.
    }
    setIsVisible(false);
  }, []);

  const updateTarget = useCallback(() => {
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
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "true") return;
    } catch {
      // If storage is unavailable, still show the guide for this session.
    }

    const timer = window.setTimeout(() => {
      setIsVisible(true);
    }, 700);

    return () => window.clearTimeout(timer);
  }, []);

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

  const ringStyle = useMemo(() => {
    if (!targetBox) return undefined;

    return {
      top: targetBox.top - 6,
      left: targetBox.left - 6,
      width: targetBox.width + 12,
      height: targetBox.height + 12,
    };
  }, [targetBox]);

  const pointerStyle = useMemo(() => {
    if (!targetBox) {
      return {
        top: "44vh",
        left: "50vw",
      };
    }

    return {
      top: targetBox.top + targetBox.height / 2,
      left: Math.min(targetBox.left + targetBox.width - 18, window.innerWidth - 34),
    };
  }, [targetBox]);

  const cardStyle = useMemo(() => {
    if (!targetBox) {
      return {
        top: "calc(44vh + 34px)",
        left: "50vw",
        transform: "translateX(-50%)",
      };
    }

    const preferBelow = targetBox.top < window.innerHeight * 0.58;
    const top = preferBelow
      ? Math.min(targetBox.top + targetBox.height + 18, window.innerHeight - 190)
      : Math.max(targetBox.top - 166, 18);
    const left = Math.min(Math.max(targetBox.left + targetBox.width / 2, 170), window.innerWidth - 170);

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
          className="fixed rounded-2xl border-2 border-orange-300/80 shadow-[0_0_0_8px_rgba(249,115,22,0.10),0_0_34px_rgba(249,115,22,0.30)] transition-all duration-500 kk-tour-pulse"
          style={ringStyle}
        />
      )}

      <div
        aria-hidden="true"
        className="fixed h-5 w-5 rounded-full bg-orange-500 shadow-[0_0_0_8px_rgba(249,115,22,0.16),0_10px_25px_rgba(15,23,42,0.22)] transition-all duration-500 kk-tour-dot"
        style={pointerStyle}
      />

      <div
        role="dialog"
        aria-live="polite"
        aria-label="Homepage request guide"
        className="fixed w-[min(21rem,calc(100vw-2rem))] rounded-2xl border border-orange-100 bg-white p-4 text-left shadow-[0_20px_60px_rgba(15,23,42,0.18)] pointer-events-auto transition-all duration-500"
        style={cardStyle}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-500">
              Step {stepIndex + 1} of {STEPS.length}
            </p>
            <h2 className="mt-1 text-base font-bold text-slate-900">{step.title}</h2>
          </div>
          <button
            type="button"
            onClick={markSeen}
            className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-400 transition hover:bg-slate-50 hover:text-slate-700"
          >
            Skip
          </button>
        </div>

        <p className="text-sm leading-6 text-slate-600">{step.text}</p>

        {step.fakeTyping && (
          <div className="mt-3 inline-flex items-center rounded-full border border-orange-100 bg-orange-50 px-3 py-1.5 text-sm font-semibold text-orange-700">
            <span className="mr-1.5 h-2 w-2 rounded-full bg-orange-500 kk-tour-blink" />
            {step.fakeTyping}
          </div>
        )}

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

          <button
            type="button"
            onClick={() => {
              if (isLastStep) {
                markSeen();
                return;
              }
              setStepIndex((current) => current + 1);
            }}
            className="rounded-xl bg-[#003d20] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#002a15]"
          >
            {isLastStep ? "Finish" : "Got it"}
          </button>
        </div>
      </div>

      <style>{`
        .kk-tour-pulse {
          animation: kk-tour-pulse 1.7s ease-in-out infinite;
        }

        .kk-tour-dot {
          animation: kk-tour-dot 1.2s ease-in-out infinite;
        }

        .kk-tour-blink {
          animation: kk-tour-blink 0.9s steps(2, start) infinite;
        }

        @keyframes kk-tour-pulse {
          0%,
          100% {
            box-shadow: 0 0 0 8px rgba(249, 115, 22, 0.1), 0 0 34px rgba(249, 115, 22, 0.3);
          }
          50% {
            box-shadow: 0 0 0 14px rgba(249, 115, 22, 0.04), 0 0 42px rgba(249, 115, 22, 0.36);
          }
        }

        @keyframes kk-tour-dot {
          0%,
          100% {
            transform: translate(-50%, -50%) scale(1);
          }
          50% {
            transform: translate(-50%, -50%) scale(1.12);
          }
        }

        @keyframes kk-tour-blink {
          0%,
          45% {
            opacity: 1;
          }
          46%,
          100% {
            opacity: 0.25;
          }
        }
      `}</style>
    </div>
  );
}
