"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { fetchResolve } from "@/lib/workIntake/clientResolve";
import type {
  WorkIntakeMainCategory,
  WorkIntakeReason,
  WorkIntakeWorkTag,
} from "@/lib/workIntake/types";

// Voice-first provider work-intake assistant — Gemini-style guided two-step
// conversation.
//
// Step 1 question:
//   "Aap apne mukhya kaam ke baare mein batayein."
// Step 2 question (only asked after step 1 is captured / typed):
//   "Aapke is kaam ke daayre mein kya-kya kaam aate hain?"
//
// On Process, both answers are combined as:
//   "Mukhya kaam: <a1>. Kaam ke daayre: <a2>."
// and sent to the existing /api/provider/work-intake/resolve. The route stays
// read-only; the modal owns conversation state until the provider taps
// Confirm — only then do the apply* callbacks mutate the registration form.
//
// Voice-first contract:
//   - Mic is the primary surface on each step. Typed input is fallback ONLY:
//     unsupported browser, mic permission denied, or explicit "Likh kar try
//     karein". On both fallbacks the SAME two-question structure is preserved.
//   - Audio never leaves the browser. SpeechRecognition emits text only.

export type AssistantApplyGreen = {
  mainCategory: WorkIntakeMainCategory;
  workTags: WorkIntakeWorkTag[];
};

export type AssistantApplyYellowProposal = {
  mainCategory: WorkIntakeMainCategory;
};

type Props = {
  open: boolean;
  onClose: () => void;
  cityCode?: string;
  onApplyGreen: (result: AssistantApplyGreen) => void;
  onApplyYellowProposal: (result: AssistantApplyYellowProposal) => void;
  onApplySingleChoice: (canonical: string) => void;
  /** Controls the closing voice + visual feedback. Defaults to "pre-submit":
   *  the provider still has to submit the registration form, so we show
   *  "Ab registration complete karne ke liye form submit karein." and stay on
   *  the page. "edit" is the existing-provider service/category update flow —
   *  same stay-on-page behavior, but the closer points at the "Save Changes"
   *  button (/api/provider/update) instead of the registration submit.
   *  "post-submit" navigates to the dashboard (reserved for a future flow
   *  where the assistant runs after a completed registration). */
  mode?: "pre-submit" | "edit" | "post-submit";
};

// Fixed thanking message. The closing sentence differs by mode so the spoken
// + visual feedback never promises a navigation we won't perform.
const THANKING_INTRO =
  "Shukriya. Humne aapka kaam samajh liya hai. Kaun Karega jald hi aapko aise logon se jodne mein madad karega, jo aapke kaam ki talash kar rahe hain.";
const THANKING_PRE_SUBMIT_CLOSER =
  "Ab registration complete karne ke liye form submit karein.";
const THANKING_EDIT_CLOSER =
  "Ab badlav save karne ke liye 'Save Changes' dabayein.";
const THANKING_POST_SUBMIT_CLOSER =
  "Chaliye, ab aapko dashboard par le chalte hain.";
const THANKING_FALLBACK_MS = 3000;

type ResultKind =
  | {
      kind: "green";
      mainCategory: WorkIntakeMainCategory;
      workTags: WorkIntakeWorkTag[];
    }
  | {
      kind: "yellow";
      mainCategory: WorkIntakeMainCategory | null;
      reason: WorkIntakeReason;
    }
  | { kind: "choose-category"; possibleCategories: WorkIntakeMainCategory[] }
  | { kind: "red" }
  | { kind: "manual"; reason: WorkIntakeReason };

type Screen =
  | { kind: "step1" }
  | { kind: "step2" }
  | { kind: "resolving"; combined: string }
  | { kind: "result"; result: ResultKind; combined: string }
  | { kind: "thanking"; message: string };

type Substep = "idle" | "listening" | "captured" | "editing";

const Q1_PROMPT = "Aap apne mukhya kaam ke baare mein batayein.";
const Q2_PROMPT = "Aapke is kaam ke daayre mein kya-kya kaam aate hain?";

const BUTTON_PRIMARY =
  "inline-flex items-center justify-center rounded-full bg-[#003d20] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#002a16] disabled:cursor-not-allowed disabled:opacity-60";
const BUTTON_SECONDARY =
  "inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50";
const BUTTON_GHOST =
  "inline-flex items-center justify-center rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100";

function combineAnswers(a1: string, a2: string): string {
  const t1 = String(a1 ?? "").trim();
  const t2 = String(a2 ?? "").trim();
  if (t1 && t2) return `Mukhya kaam: ${t1}. Kaam ke daayre: ${t2}.`;
  if (t1) return `Mukhya kaam: ${t1}.`;
  return t2;
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { name?: unknown }).name === "AbortError";
}

export default function ProviderWorkIntakeAssistant({
  open,
  onClose,
  cityCode,
  onApplyGreen,
  onApplyYellowProposal,
  onApplySingleChoice,
  mode = "pre-submit",
}: Props) {
  const {
    supported,
    listening,
    partialTranscript,
    finalTranscript,
    error: speechError,
    start: startListening,
    stop: stopListening,
    reset: resetSpeech,
  } = useSpeechRecognition();

  const [screen, setScreen] = useState<Screen>({ kind: "step1" });
  const [substep, setSubstep] = useState<Substep>("idle");
  const [answer1, setAnswer1] = useState<string>("");
  const [answer2, setAnswer2] = useState<string>("");
  const [typedDraft, setTypedDraft] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  // Body-scroll lock — mirrors ProviderPledgeModal so the platform feels
  // consistent and other dialogs can't trample each other's overflow state.
  useEffect(() => {
    if (!open) return;
    if (typeof document === "undefined") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Reset on open — each session is a clean Q1/Q2 conversation.
  useEffect(() => {
    if (open) {
      setScreen({ kind: "step1" });
      setSubstep("idle");
      setAnswer1("");
      setAnswer2("");
      setTypedDraft("");
      resetSpeech();
      abortRef.current?.abort();
      abortRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Mirror speech recognition into the substep machine. The hook gives us
  // `listening` + `finalTranscript`; the modal needs a substep so the JSX
  // can render captured / listening / editing branches off one source.
  useEffect(() => {
    if (!open) return;
    if (screen.kind !== "step1" && screen.kind !== "step2") return;
    if (listening) {
      setSubstep("listening");
      return;
    }
    if (substep === "listening" && finalTranscript.trim()) {
      setSubstep("captured");
    }
  }, [listening, finalTranscript, open, screen.kind, substep]);

  // Permission-denied / unsupported steer the active step into the typed
  // fallback automatically — the provider never sees a dead mic.
  const fallbackOnly = !supported || speechError === "permission-denied";
  useEffect(() => {
    if (!open) return;
    if (screen.kind !== "step1" && screen.kind !== "step2") return;
    if (!fallbackOnly) return;
    if (substep !== "editing") {
      const seed =
        screen.kind === "step1" ? answer1 : answer2;
      setTypedDraft(seed);
      setSubstep("editing");
    }
    // typedDraft / setSubstep are intentionally not deps — we only want to
    // flip to editing once when fallback becomes the only path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fallbackOnly, screen.kind]);

  const stepNumber = screen.kind === "step1" ? 1 : screen.kind === "step2" ? 2 : 0;

  const currentCaptured = useMemo(() => {
    if (screen.kind === "step1") return answer1;
    if (screen.kind === "step2") return answer2;
    return "";
  }, [screen.kind, answer1, answer2]);

  // ────────────────────────── Mic / fallback handlers ─────────────────────

  const handleMicTap = useCallback(() => {
    if (listening) {
      stopListening();
      return;
    }
    resetSpeech();
    setTypedDraft("");
    startListening();
  }, [listening, stopListening, resetSpeech, startListening]);

  const handleSpeakAgain = useCallback(() => {
    if (screen.kind === "step1") setAnswer1("");
    if (screen.kind === "step2") setAnswer2("");
    setTypedDraft("");
    resetSpeech();
    setSubstep("idle");
  }, [screen.kind, resetSpeech]);

  const handleEdit = useCallback(() => {
    const baseline =
      currentCaptured ||
      finalTranscript.trim();
    setTypedDraft(baseline);
    setSubstep("editing");
  }, [currentCaptured, finalTranscript]);

  // Commit whatever the active step has — captured speech or typed draft —
  // into the appropriate answer slot, returning the value that was committed.
  const commitActiveAnswer = useCallback((): string => {
    if (screen.kind !== "step1" && screen.kind !== "step2") return "";
    const value =
      substep === "editing"
        ? typedDraft.trim()
        : (currentCaptured || finalTranscript.trim());
    if (!value) return "";
    if (screen.kind === "step1") setAnswer1(value);
    else setAnswer2(value);
    return value;
  }, [screen.kind, substep, typedDraft, currentCaptured, finalTranscript]);

  const handleNextToStep2 = useCallback(() => {
    const committed = commitActiveAnswer();
    if (!committed) return;
    resetSpeech();
    setTypedDraft("");
    setSubstep("idle");
    setScreen({ kind: "step2" });
  }, [commitActiveAnswer, resetSpeech]);

  // ─────────────────────────────── Resolve ────────────────────────────────

  const runResolve = useCallback(
    async (combined: string) => {
      const trimmed = combined.trim();
      if (!trimmed) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setScreen({ kind: "resolving", combined: trimmed });
      try {
        const data = await fetchResolve(trimmed, cityCode, {
          signal: ctrl.signal,
        });
        if (abortRef.current !== ctrl) return;
        abortRef.current = null;

        let result: ResultKind;
        if (!data.ok) {
          result = { kind: "manual", reason: data.reason };
        } else if (data.blocked || data.safety === "red") {
          result = { kind: "red" };
        } else if (
          data.needsSingleCategoryChoice &&
          Array.isArray(data.possibleCategories) &&
          data.possibleCategories.length >= 2
        ) {
          result = {
            kind: "choose-category",
            possibleCategories: data.possibleCategories,
          };
        } else if (data.safety === "yellow" || !data.mainCategory) {
          result = {
            kind: "yellow",
            mainCategory: data.mainCategory,
            reason: data.reason,
          };
        } else {
          result = {
            kind: "green",
            mainCategory: data.mainCategory,
            workTags: data.workTags,
          };
        }
        setScreen({ kind: "result", result, combined: trimmed });
      } catch (err) {
        if (isAbortError(err)) return;
        setScreen({
          kind: "result",
          result: { kind: "manual", reason: "AI_UNAVAILABLE" },
          combined: trimmed,
        });
      }
    },
    [cityCode]
  );

  const handleProcess = useCallback(() => {
    const committed = commitActiveAnswer();
    const a1 = answer1;
    const a2 = screen.kind === "step2" ? committed || answer2 : answer2;
    const combined = combineAnswers(a1, a2);
    void runResolve(combined);
  }, [answer1, answer2, commitActiveAnswer, runResolve, screen.kind]);

  // ───────────────────────────── Lifecycle ────────────────────────────────

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    try {
      stopListening();
    } catch {
      // ignore
    }
    // Cancel any in-flight SpeechSynthesis utterance so the closing voice
    // doesn't keep speaking after the modal is gone.
    if (
      typeof window !== "undefined" &&
      typeof window.speechSynthesis !== "undefined"
    ) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    onClose();
  }, [onClose, stopListening]);

  const enterThankingAndClose = useCallback(() => {
    const closer =
      mode === "post-submit"
        ? THANKING_POST_SUBMIT_CLOSER
        : mode === "edit"
        ? THANKING_EDIT_CLOSER
        : THANKING_PRE_SUBMIT_CLOSER;
    const message = `${THANKING_INTRO} ${closer}`;
    setScreen({ kind: "thanking", message });
  }, [mode]);

  // Voice + auto-close lifecycle for the thanking screen. SpeechSynthesis is
  // best-effort: when it's available we let `onend` close us; we ALWAYS arm a
  // fallback timer so a failed/empty TTS run never leaves the modal hanging.
  useEffect(() => {
    if (!open) return;
    if (screen.kind !== "thanking") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const closeOnce = () => {
      if (closed) return;
      closed = true;
      handleClose();
    };
    const synth =
      typeof window !== "undefined" &&
      typeof window.speechSynthesis !== "undefined"
        ? window.speechSynthesis
        : null;
    if (synth && typeof window.SpeechSynthesisUtterance !== "undefined") {
      try {
        // Cancel anything queued from a prior thanking screen (the close
        // handler does this too, but be defensive in case of fast retries).
        synth.cancel();
        const utter = new window.SpeechSynthesisUtterance(screen.message);
        utter.lang = "hi-IN";
        utter.rate = 1;
        utter.onend = () => closeOnce();
        utter.onerror = () => closeOnce();
        synth.speak(utter);
      } catch {
        // Synthesis blew up — fall back to the timer below.
      }
    }
    timer = setTimeout(closeOnce, THANKING_FALLBACK_MS);
    return () => {
      if (timer) clearTimeout(timer);
      // Don't cancel synth here — handleClose already does, and cancelling
      // again on the strict-mode double-mount in dev fires onerror → close.
    };
  }, [open, screen, handleClose]);

  const goBackToStep = (target: 1 | 2) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setScreen({ kind: target === 1 ? "step1" : "step2" });
    resetSpeech();
    setTypedDraft("");
    setSubstep("idle");
  };

  if (!open) return null;

  const captured = screen.kind === "step1" || screen.kind === "step2"
    ? substep === "captured"
      ? finalTranscript.trim() || currentCaptured
      : currentCaptured
    : "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kk-work-intake-assistant-title"
      data-testid="kk-work-intake-assistant"
      className="fixed inset-0 z-[100] flex items-stretch justify-center bg-slate-900/60 px-0 py-0 sm:items-center sm:px-4 sm:py-6"
    >
      <div className="flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white shadow-xl sm:h-auto sm:max-h-[90vh] sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <p
              id="kk-work-intake-assistant-title"
              className="text-base font-semibold text-slate-900"
            >
              Apna kaam bataiye
            </p>
            <p className="text-xs text-slate-500">
              Hindi, Hinglish ya English — apni bhasha mein boliye.
            </p>
          </div>
          <button
            type="button"
            data-testid="kk-work-intake-assistant-close"
            onClick={handleClose}
            aria-label="Close assistant"
            className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100"
          >
            <span aria-hidden="true" className="text-lg">
              ✕
            </span>
          </button>
        </div>

        {/* Body */}
        <div
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5"
          data-testid="kk-work-intake-assistant-body"
        >
          <span
            data-testid="kk-work-intake-assistant-state"
            data-step={stepNumber}
            data-substep={substep}
            hidden
          >
            {screen.kind === "result" ? screen.result.kind : screen.kind}
          </span>

          {/* Step 1 question — always visible while answering Q1, and shown
              compact above Q2 once A1 is committed. */}
          {screen.kind === "step1" ||
          screen.kind === "step2" ||
          screen.kind === "resolving" ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Sawaal 1
              </p>
              <p
                data-testid="kk-work-intake-assistant-q1-prompt"
                className="mt-1 text-sm font-medium text-slate-800"
              >
                {Q1_PROMPT}
              </p>
              {answer1 ? (
                <p
                  data-testid="kk-work-intake-assistant-a1"
                  className="mt-1 text-sm text-slate-700"
                >
                  <span className="font-semibold">Aapne bola:</span> {answer1}
                </p>
              ) : screen.kind === "step1" && captured ? (
                <p
                  data-testid="kk-work-intake-assistant-a1-preview"
                  className="mt-1 text-sm text-slate-700"
                >
                  <span className="font-semibold">Aapne bola:</span> {captured}
                </p>
              ) : null}
              {screen.kind === "step2" || screen.kind === "resolving" ? (
                <button
                  type="button"
                  data-testid="kk-work-intake-assistant-back-to-q1"
                  onClick={() => goBackToStep(1)}
                  className={`mt-2 ${BUTTON_GHOST}`}
                >
                  Sawaal 1 ko sahi karein
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Step 2 question — only after step 1 is committed. */}
          {screen.kind === "step2" || screen.kind === "resolving" ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Sawaal 2
              </p>
              <p
                data-testid="kk-work-intake-assistant-q2-prompt"
                className="mt-1 text-sm font-medium text-slate-800"
              >
                {Q2_PROMPT}
              </p>
              {answer2 ? (
                <p
                  data-testid="kk-work-intake-assistant-a2"
                  className="mt-1 text-sm text-slate-700"
                >
                  <span className="font-semibold">Aapne bola:</span> {answer2}
                </p>
              ) : screen.kind === "step2" && captured ? (
                <p
                  data-testid="kk-work-intake-assistant-a2-preview"
                  className="mt-1 text-sm text-slate-700"
                >
                  <span className="font-semibold">Aapne bola:</span> {captured}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Resolving spinner-ish state. */}
          {screen.kind === "resolving" ? (
            <p
              data-testid="kk-work-intake-assistant-resolving"
              className="text-sm text-slate-700"
            >
              Aapka kaam samajh rahe hain…
            </p>
          ) : null}

          {/* Result bubbles. */}
          {screen.kind === "result" && screen.result.kind === "green" ? (
            <div
              data-testid="kk-work-intake-assistant-green"
              className="rounded-2xl border border-green-300 bg-green-50/70 px-4 py-3"
            >
              <p className="text-sm font-semibold text-slate-800">
                Humne aapka kaam aise samjha:
              </p>
              <p className="mt-2 text-sm text-slate-700">
                <span className="font-semibold">Main Service:</span>{" "}
                <span data-testid="kk-work-intake-assistant-canonical">
                  {screen.result.mainCategory.canonical}
                </span>
              </p>
              {screen.result.workTags.length > 0 ? (
                <p className="mt-1 text-sm text-slate-700">
                  <span className="font-semibold">Work Types:</span>{" "}
                  <span data-testid="kk-work-intake-assistant-tags">
                    {screen.result.workTags.map((t) => t.label).join(", ")}
                  </span>
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="kk-work-intake-assistant-confirm"
                  onClick={() => {
                    if (screen.kind !== "result" || screen.result.kind !== "green") return;
                    onApplyGreen({
                      mainCategory: screen.result.mainCategory,
                      workTags: screen.result.workTags,
                    });
                    enterThankingAndClose();
                  }}
                  className={BUTTON_PRIMARY}
                >
                  Confirm and use this
                </button>
                <button
                  type="button"
                  data-testid="kk-work-intake-assistant-result-speak-again"
                  onClick={() => goBackToStep(1)}
                  className={BUTTON_SECONDARY}
                >
                  Dobara boliye
                </button>
              </div>
            </div>
          ) : null}

          {screen.kind === "result" && screen.result.kind === "yellow" ? (
            (() => {
              const proposal =
                screen.result.mainCategory?.canonical?.trim() || "";
              const proposalIsNew =
                screen.result.mainCategory?.isExisting === false;
              const hasProposal = proposal.length > 0 && proposalIsNew;
              return (
                <div
                  data-testid="kk-work-intake-assistant-yellow"
                  className="rounded-2xl border border-amber-300 bg-amber-50/70 px-4 py-3"
                >
                  <p className="text-sm font-semibold text-slate-800">
                    We could not find this in our list yet.
                  </p>
                  {hasProposal ? (
                    <p className="mt-2 text-sm text-slate-700">
                      <span className="font-semibold">
                        Suggested new service name:
                      </span>{" "}
                      <span data-testid="kk-work-intake-assistant-proposal">
                        {proposal}
                      </span>
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-700">
                      Dobara boliye, ya likh kar try karein. Manual category
                      list bhi neeche available hai.
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {hasProposal && screen.result.mainCategory ? (
                      <button
                        type="button"
                        data-testid="kk-work-intake-assistant-use-proposal"
                        onClick={() => {
                          if (
                            screen.kind !== "result" ||
                            screen.result.kind !== "yellow" ||
                            !screen.result.mainCategory
                          )
                            return;
                          onApplyYellowProposal({
                            mainCategory: screen.result.mainCategory,
                          });
                          enterThankingAndClose();
                        }}
                        className={BUTTON_PRIMARY}
                      >
                        Use this as a new service
                      </button>
                    ) : null}
                    <button
                      type="button"
                      data-testid="kk-work-intake-assistant-result-speak-again"
                      onClick={() => goBackToStep(1)}
                      className={hasProposal ? BUTTON_SECONDARY : BUTTON_PRIMARY}
                    >
                      Dobara boliye
                    </button>
                  </div>
                </div>
              );
            })()
          ) : null}

          {screen.kind === "result" && screen.result.kind === "choose-category" ? (
            <div
              data-testid="kk-work-intake-assistant-choose"
              className="rounded-2xl border border-amber-300 bg-amber-50/70 px-4 py-3"
            >
              <p className="text-sm font-semibold text-slate-800">
                Aapne ek se zyada kaam bataye hain.
              </p>
              <p className="mt-1 text-sm text-slate-700">
                Abhi registration ke liye ek main service choose karein:
              </p>
              <div
                className="mt-3 flex flex-wrap gap-2"
                data-testid="kk-work-intake-assistant-choices"
              >
                {screen.result.possibleCategories.map((option) => (
                  <button
                    key={option.canonical}
                    type="button"
                    data-testid="kk-work-intake-assistant-choice"
                    data-canonical={option.canonical}
                    onClick={() => {
                      onApplySingleChoice(option.canonical);
                      enterThankingAndClose();
                    }}
                    className={BUTTON_PRIMARY}
                  >
                    {option.canonical}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="kk-work-intake-assistant-result-speak-again"
                  onClick={() => goBackToStep(1)}
                  className={BUTTON_SECONDARY}
                >
                  Dobara boliye
                </button>
              </div>
            </div>
          ) : null}

          {screen.kind === "result" && screen.result.kind === "red" ? (
            <div
              data-testid="kk-work-intake-assistant-red"
              className="rounded-2xl border border-red-300 bg-red-50/70 px-4 py-3"
            >
              <p className="text-sm font-semibold text-red-800">
                This type of work cannot be listed on Kaun Karega.
              </p>
              <p className="mt-1 text-sm text-slate-700">
                Kripya koi aur legal service bataiye.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="kk-work-intake-assistant-result-speak-again"
                  onClick={() => goBackToStep(1)}
                  className={BUTTON_PRIMARY}
                >
                  Dobara boliye
                </button>
              </div>
            </div>
          ) : null}

          {screen.kind === "result" && screen.result.kind === "manual" ? (
            <div
              data-testid="kk-work-intake-assistant-manual"
              className="rounded-2xl border border-slate-300 bg-slate-50/70 px-4 py-3"
            >
              <p className="text-sm font-semibold text-slate-800">
                Smart help is not available right now.
              </p>
              <p className="mt-1 text-sm text-slate-700">
                Likh kar ya manually category choose karein.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="kk-work-intake-assistant-result-speak-again"
                  onClick={() => goBackToStep(1)}
                  className={BUTTON_PRIMARY}
                >
                  Dobara boliye
                </button>
                <button
                  type="button"
                  data-testid="kk-work-intake-assistant-close-to-manual"
                  onClick={handleClose}
                  className={BUTTON_SECONDARY}
                >
                  Manually choose karein
                </button>
              </div>
            </div>
          ) : null}

          {screen.kind === "thanking" ? (
            <div
              data-testid="kk-work-intake-assistant-thanking"
              role="status"
              aria-live="polite"
              className="rounded-2xl border border-emerald-300 bg-emerald-50/70 px-4 py-3"
            >
              <p className="text-sm font-semibold text-emerald-900">Shukriya 🙏</p>
              <p
                data-testid="kk-work-intake-assistant-thanking-message"
                className="mt-1 text-sm leading-relaxed text-slate-800"
              >
                {screen.message}
              </p>
            </div>
          ) : null}

          {/* Active step composer (Q1 or Q2). Mic-first; typed input only
              when the device/permission forces it or the provider explicitly
              chose to edit. */}
          {(screen.kind === "step1" || screen.kind === "step2") &&
          substep === "editing" ? (
            <div
              data-testid="kk-work-intake-assistant-typed-fallback"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {stepNumber === 1 ? "Sawaal 1 ka jawaab likhiye" : "Sawaal 2 ka jawaab likhiye"}
              </p>
              {!supported ? (
                <p className="mt-1 text-xs text-slate-500">
                  Aapka phone abhi voice support nahi karta — neeche likh ke
                  bataiye.
                </p>
              ) : null}
              {speechError === "permission-denied" ? (
                <p className="mt-1 text-xs text-slate-500">
                  Mic permission nahi mili — neeche likh ke bataiye, ya phone
                  settings mein permission de kar phir try karein.
                </p>
              ) : null}
              <textarea
                value={typedDraft}
                onChange={(e) => setTypedDraft(e.target.value)}
                rows={3}
                data-testid="kk-work-intake-assistant-typed-input"
                placeholder={stepNumber === 1 ? "Apna mukhya kaam likhiye…" : "Apne kaam ke daayre likhiye…"}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {stepNumber === 1 ? (
                  <button
                    type="button"
                    data-testid="kk-work-intake-assistant-typed-next"
                    onClick={handleNextToStep2}
                    disabled={typedDraft.trim().length === 0}
                    className={BUTTON_PRIMARY}
                  >
                    Aage badhein
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="kk-work-intake-assistant-typed-process"
                    onClick={handleProcess}
                    disabled={typedDraft.trim().length === 0}
                    className={BUTTON_PRIMARY}
                  >
                    Samjho
                  </button>
                )}
                {supported && speechError !== "permission-denied" ? (
                  <button
                    type="button"
                    data-testid="kk-work-intake-assistant-back-to-mic"
                    onClick={handleSpeakAgain}
                    className={BUTTON_GHOST}
                  >
                    Mic se boliye
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {/* Composer / mic bar — primary surface in idle / listening / captured
            when the typed fallback is not currently active. */}
        {(screen.kind === "step1" || screen.kind === "step2") &&
        substep !== "editing" ? (
          <div className="border-t border-slate-200 bg-white px-5 py-4">
            <div className="flex flex-col items-center gap-3">
              {substep === "listening" ? (
                <p
                  className="text-sm font-medium text-slate-700"
                  data-testid="kk-work-intake-assistant-listening-label"
                >
                  Sun rahe hain…
                </p>
              ) : substep === "captured" ? (
                <p
                  className="text-xs text-slate-600"
                  data-testid="kk-work-intake-assistant-captured-label"
                >
                  {stepNumber === 1
                    ? "Aage badhein, ya dobara boliye"
                    : "Tap to process, or speak again"}
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  {stepNumber === 1
                    ? "Sawaal 1 ka jawaab dene ke liye mic dabaaye"
                    : "Sawaal 2 ka jawaab dene ke liye mic dabaaye"}
                </p>
              )}
              <button
                type="button"
                data-testid="kk-work-intake-assistant-mic"
                onClick={handleMicTap}
                aria-pressed={substep === "listening"}
                aria-label={
                  substep === "listening" ? "Stop listening" : "Start listening"
                }
                disabled={!supported && substep === "idle"}
                className={`flex h-20 w-20 items-center justify-center rounded-full text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  substep === "listening"
                    ? "animate-pulse bg-red-600 hover:bg-red-700"
                    : "bg-[#003d20] hover:bg-[#002a16]"
                }`}
              >
                <span aria-hidden="true" className="text-3xl">
                  🎤
                </span>
              </button>
              {substep === "listening" && partialTranscript ? (
                <p
                  className="max-w-md truncate text-xs text-slate-500"
                  data-testid="kk-work-intake-assistant-partial"
                >
                  {partialTranscript}
                </p>
              ) : null}
              {substep === "captured" ? (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {stepNumber === 1 ? (
                    <button
                      type="button"
                      data-testid="kk-work-intake-assistant-next"
                      onClick={handleNextToStep2}
                      className={BUTTON_PRIMARY}
                    >
                      Aage badhein
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid="kk-work-intake-assistant-process"
                      onClick={handleProcess}
                      className={BUTTON_PRIMARY}
                    >
                      Process karo
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="kk-work-intake-assistant-speak-again"
                    onClick={handleSpeakAgain}
                    className={BUTTON_SECONDARY}
                  >
                    Dobara boliye
                  </button>
                  <button
                    type="button"
                    data-testid="kk-work-intake-assistant-edit"
                    onClick={handleEdit}
                    className={BUTTON_GHOST}
                  >
                    Likh kar try karein
                  </button>
                </div>
              ) : null}
              {supported && substep === "idle" ? (
                <button
                  type="button"
                  data-testid="kk-work-intake-assistant-prefer-typed"
                  onClick={handleEdit}
                  className={BUTTON_GHOST}
                >
                  Likh kar try karein
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
