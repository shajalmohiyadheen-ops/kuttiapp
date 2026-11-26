"use client";

// Hold-to-talk with the browser's own speech recognition. Works in Chrome on
// Android; on iPhone it is often missing or unreliable (especially from the home
// screen), so the screens always offer typing and only show the mic when it exists.

import { useCallback, useRef, useState } from "react";

interface Rec {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function ctor(): (new () => Rec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function voiceAvailable(): boolean {
  return ctor() !== null;
}

export function useVoice() {
  const [listening, setListening] = useState(false);
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const rec = useRef<Rec | null>(null);

  const start = useCallback(() => {
    const C = ctor();
    if (!C) return setError("unavailable");
    setAlternatives([]);
    setError(null);
    setDone(false);
    const r = new C();
    r.lang = "en-US";
    r.interimResults = true;
    r.maxAlternatives = 3;
    r.continuous = false;
    r.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      const alts = Array.from({ length: last.length }, (_, i) => last[i].transcript).filter(Boolean);
      if (alts.length) setAlternatives(alts);
    };
    r.onerror = (e) => {
      if (e.error !== "aborted") setError(e.error);
    };
    r.onend = () => {
      setListening(false);
      setDone(true);
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError("unavailable");
    }
  }, []);

  const stop = useCallback(() => {
    try {
      rec.current?.stop();
    } catch {}
  }, []);

  return { listening, alternatives, transcript: alternatives[0] ?? "", error, done, start, stop };
}
