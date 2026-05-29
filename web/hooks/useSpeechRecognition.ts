"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Browser SpeechRecognition wrapper for the provider work-intake assistant.
//
// Voice-first contract:
//   - The page receives ONLY text. Audio is never persisted, never POSTed.
//   - Vendor STT (e.g. Chrome's Google backend) handles recognition; we do not
//     use MediaRecorder, do not call getUserMedia ourselves, do not buffer
//     PCM. The browser owns the audio lifecycle entirely.
//   - SSR-safe: feature detection is window-gated; no top-level access.
//
// Error mapping (matches the SpeechRecognitionError.error values most
// implementations emit; everything else falls back to a generic "error" state):
//   - "not-allowed" | "service-not-allowed" → permission-denied
//   - "no-speech" | "aborted"               → benign, returns to idle
//   - others                                 → "error"

type SpeechRecognitionEventLike = {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

type SpeechRecognitionErrorEventLike = {
  error?: string;
};

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

export type SpeechErrorKind =
  | null
  | "permission-denied"
  | "no-speech"
  | "error";

export type UseSpeechRecognitionResult = {
  /** True when the running browser exposes a usable SpeechRecognition API. */
  supported: boolean;
  /** True between start() and the next stop/error/onend. */
  listening: boolean;
  /** Interim (non-final) hypothesis the recognizer is currently emitting. */
  partialTranscript: string;
  /** The final transcript captured since the last reset(). */
  finalTranscript: string;
  /** Categorised error from the last attempt, or null. */
  error: SpeechErrorKind;
  /** Begin a recognition session. No-op when unsupported or already listening. */
  start: () => void;
  /** Stop the current session — emits onend on the underlying instance. */
  stop: () => void;
  /** Clear partial + final transcripts + any error so the UI returns to idle. */
  reset: () => void;
};

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Browser speech recognition wrapper. Returns transcript-only state — the
 * caller (the assistant modal) decides what to do with the text.
 *
 * Pass `lang` to override the recognition language; defaults to "hi-IN" which
 * tolerates Hindi/Hinglish code-switching well across desktop + Android Chrome.
 */
export function useSpeechRecognition(
  options: { lang?: string } = {}
): UseSpeechRecognitionResult {
  const lang = options.lang ?? "hi-IN";

  const [supported, setSupported] = useState<boolean>(false);
  const [listening, setListening] = useState<boolean>(false);
  const [partialTranscript, setPartial] = useState<string>("");
  const [finalTranscript, setFinal] = useState<string>("");
  const [error, setError] = useState<SpeechErrorKind>(null);

  const instanceRef = useRef<SpeechRecognitionInstance | null>(null);
  const unmountedRef = useRef<boolean>(false);

  // Feature detect on mount. Done in an effect so SSR never touches `window`.
  // The setState looks like a cascading render trap to the React lint rule,
  // but here it's exactly the documented pattern for one-shot post-mount
  // capability detection — there's nothing to "subscribe to" since the
  // detected value cannot change between mount and unmount.
  //
  // unmountedRef MUST be reset in the effect body (not just at the cleanup).
  // React strict-mode double-mounts every component on dev: the cleanup of
  // the first mount runs immediately, setting unmountedRef.current = true.
  // Without resetting it on the re-mount, every subsequent callback (start /
  // onstart / onresult / onend / onerror) treats the hook as torn down and
  // bails out, so listening never flips to true.
  useEffect(() => {
    unmountedRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(getSpeechRecognitionCtor() !== null);
    return () => {
      unmountedRef.current = true;
      try {
        instanceRef.current?.abort();
      } catch {
        // Best-effort cleanup; some implementations throw on double-abort.
      }
      instanceRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    if (unmountedRef.current) return;
    if (listening) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setSupported(false);
      return;
    }
    // Tear down any prior instance so its dangling handlers can't race the
    // new session's state. Recognizer instances are cheap to recreate.
    try {
      instanceRef.current?.abort();
    } catch {
      // ignore
    }

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;

    rec.onstart = () => {
      if (unmountedRef.current) return;
      setListening(true);
      setError(null);
    };

    rec.onresult = (event) => {
      if (unmountedRef.current) return;
      let interim = "";
      let nextFinal = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const res = event.results[i];
        if (!res || res.length === 0) continue;
        const alt = res[0];
        const text = String(alt?.transcript ?? "");
        if (res.isFinal) {
          nextFinal += text;
        } else {
          interim += text;
        }
      }
      setPartial(interim.trim());
      if (nextFinal) {
        // Append rather than replace — `continuous: false` typically delivers
        // one final per session, but a defensive append keeps multi-final
        // implementations correct.
        setFinal((prev) => (prev ? `${prev} ${nextFinal}`.trim() : nextFinal.trim()));
      }
    };

    rec.onerror = (event) => {
      if (unmountedRef.current) return;
      const kind = String(event?.error ?? "");
      switch (kind) {
        case "not-allowed":
        case "service-not-allowed":
          setError("permission-denied");
          setSupported(true);
          break;
        case "no-speech":
        case "aborted":
          // Benign — leave error null so the UI can return to idle.
          setError("no-speech");
          break;
        default:
          setError("error");
          break;
      }
      setListening(false);
    };

    rec.onend = () => {
      if (unmountedRef.current) return;
      setListening(false);
    };

    instanceRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      // Most browsers throw InvalidStateError if start() is called twice
      // back-to-back. Treat as a benign retry guard.
      const msg = err instanceof Error ? err.message : String(err);
      if (/already started|invalidstate/i.test(msg)) return;
      setError("error");
      setListening(false);
    }
  }, [lang, listening]);

  const stop = useCallback(() => {
    const rec = instanceRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      // ignore — onend will fire either way in most implementations
    }
  }, []);

  const reset = useCallback(() => {
    try {
      instanceRef.current?.abort();
    } catch {
      // ignore
    }
    instanceRef.current = null;
    setPartial("");
    setFinal("");
    // permission-denied is a DEVICE-LEVEL signal that persists for the
    // session — the user has explicitly blocked microphone access and that
    // doesn't change until they regrant it in browser settings or the page
    // reloads. Clearing it on reset would silently switch the UI back to the
    // mic-first surface on the next step, only to fail again on the next
    // start(). Keep it; clear all other error kinds so a benign no-speech
    // doesn't stick across attempts.
    setError((prev) => (prev === "permission-denied" ? prev : null));
    setListening(false);
  }, []);

  return {
    supported,
    listening,
    partialTranscript,
    finalTranscript,
    error,
    start,
    stop,
    reset,
  };
}
