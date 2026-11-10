"use client";

import * as React from "react";
import { MotionConfig } from "motion/react";

export type MotionPreference = "system" | "reduced" | "full";

export interface Preferences {
  motion: MotionPreference;
  sound: boolean;
  haptics: boolean;
}

const DEFAULTS: Preferences = { motion: "system", sound: false, haptics: false };
const STORAGE_KEY = "poolguard:preferences";

interface PreferencesContextValue {
  preferences: Preferences;
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  /** True when the user (or their OS) asked for reduced motion. */
  reducedMotion: boolean;
}

const PreferencesContext = React.createContext<PreferencesContextValue | null>(null);

function readStored(): Preferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      motion: parsed.motion === "reduced" || parsed.motion === "full" ? parsed.motion : "system",
      sound: parsed.sound === true,
      haptics: parsed.haptics === true,
    };
  } catch {
    return DEFAULTS;
  }
}

function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = React.useState<Preferences>(DEFAULTS);
  const systemReduced = useSystemReducedMotion();

  React.useEffect(() => {
    setPreferences(readStored());
  }, []);

  const setPreference = React.useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
      setPreferences((current) => {
        const next = { ...current, [key]: value };
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* storage may be unavailable; the preference still applies for this visit */
        }
        return next;
      });
    },
    [],
  );

  const reducedMotion =
    preferences.motion === "reduced" || (preferences.motion === "system" && systemReduced);

  React.useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? "reduced" : "full";
  }, [reducedMotion]);

  React.useEffect(() => {
    feedbackSettings.sound = preferences.sound;
    feedbackSettings.haptics = preferences.haptics;
  }, [preferences.sound, preferences.haptics]);

  const value = React.useMemo(
    () => ({ preferences, setPreference, reducedMotion }),
    [preferences, setPreference, reducedMotion],
  );

  return (
    <PreferencesContext.Provider value={value}>
      <MotionConfig reducedMotion={reducedMotion ? "always" : "never"}>{children}</MotionConfig>
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const value = React.useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used inside PreferencesProvider");
  return value;
}

/** Module-level mirror so non-React code (toasts, mutations) can give feedback. */
export const feedbackSettings = { sound: false, haptics: false };
