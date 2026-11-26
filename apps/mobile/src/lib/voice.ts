// Hold-to-talk speech recognition. Uses the phone's own recogniser (Apple /
// Google) through expo-speech-recognition, which needs a real app build: in
// Expo Go the native module is missing, so `available` is false and the
// screens fall back to typing.

import { useCallback, useEffect, useRef, useState } from "react";

type Sub = { remove: () => void };
type SpeechModule = {
  start: (o: Record<string, unknown>) => void;
  stop: () => void;
  abort: () => void;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  isRecognitionAvailable: () => boolean;
  addListener: (event: string, fn: (e: never) => void) => Sub;
};

let mod: SpeechModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mod = require("expo-speech-recognition").ExpoSpeechRecognitionModule as SpeechModule;
} catch {
  mod = null;
}

export function voiceSupported(): boolean {
  try {
    return Boolean(mod?.isRecognitionAvailable());
  } catch {
    return false;
  }
}

export function useVoice(lang: "ar-SA" | "en-US", hints: string[] = []) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [final, setFinal] = useState(false);
  const subs = useRef<Sub[]>([]);

  useEffect(() => {
    if (!mod) return;
    const m = mod;
    subs.current = [
      m.addListener("start", () => setListening(true)),
      m.addListener("end", () => setListening(false)),
      m.addListener("result", (e: { isFinal: boolean; results: Array<{ transcript: string }> }) => {
        const all = e.results.map((r) => r.transcript).filter(Boolean);
        if (all[0]) setTranscript(all[0]);
        setAlternatives(all);
        if (e.isFinal) setFinal(true);
      }),
      m.addListener("error", (e: { error: string; message: string }) => {
        setListening(false);
        if (e.error !== "aborted") setError(e.error === "no-speech" ? "no-speech" : e.message || e.error);
        setFinal(true);
      }),
    ];
    return () => {
      subs.current.forEach((s) => s.remove());
      try {
        m.abort();
      } catch {}
    };
  }, []);

  const start = useCallback(async () => {
    if (!mod) return false;
    setError(null);
    setTranscript("");
    setAlternatives([]);
    setFinal(false);
    const perm = await mod.requestPermissionsAsync();
    if (!perm.granted) {
      setError("permission");
      return false;
    }
    mod.start({ lang, interimResults: true, maxAlternatives: 5, continuous: false, contextualStrings: hints.slice(0, 100), addsPunctuation: false });
    return true;
  }, [lang, hints]);

  const stop = useCallback(() => {
    try {
      mod?.stop();
    } catch {}
  }, []);

  return { available: mod !== null, listening, transcript, alternatives, final, error, start, stop };
}
