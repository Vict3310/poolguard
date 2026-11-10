import { feedbackSettings } from "@/components/preferences-provider";

export type FeedbackKind = "tap" | "select" | "success" | "error";

/**
 * Optional physical feedback. Both channels are off by default and controlled in
 * Settings. Vibration works only where the browser supports it (mostly Android
 * Chrome); everywhere else this is a silent no-op, so every interaction must
 * still have a visual response.
 */
const VIBRATION: Record<FeedbackKind, number | number[]> = {
  tap: 8,
  select: 12,
  success: [14, 40, 22],
  error: [30, 50, 30],
};

/** Short, quiet tones: one soft click, a two-note chime, a low double pulse. */
const TONES: Record<FeedbackKind, Array<{ freq: number; at: number; length: number }>> = {
  tap: [{ freq: 880, at: 0, length: 0.03 }],
  select: [{ freq: 740, at: 0, length: 0.04 }],
  success: [
    { freq: 660, at: 0, length: 0.09 },
    { freq: 990, at: 0.09, length: 0.14 },
  ],
  error: [
    { freq: 220, at: 0, length: 0.08 },
    { freq: 196, at: 0.12, length: 0.1 },
  ],
};

let audioContext: AudioContext | null = null;

function playTone(kind: FeedbackKind) {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioContext ??= new Ctor();
    const ctx = audioContext;
    const start = ctx.currentTime;
    for (const tone of TONES[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = tone.freq;
      gain.gain.setValueAtTime(0.0001, start + tone.at);
      gain.gain.exponentialRampToValueAtTime(0.06, start + tone.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.at + tone.length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + tone.at);
      osc.stop(start + tone.at + tone.length + 0.02);
    }
  } catch {
    /* audio is decorative; never let it break an interaction */
  }
}

export function feedback(kind: FeedbackKind) {
  if (typeof window === "undefined") return;
  if (feedbackSettings.haptics && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(VIBRATION[kind]);
    } catch {
      /* unsupported */
    }
  }
  if (feedbackSettings.sound) playTone(kind);
}

export function vibrationSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}
