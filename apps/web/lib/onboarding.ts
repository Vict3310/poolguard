"use client";

import { api } from "@/lib/api";
import type { TaskSummary } from "@/lib/types";

const KEY = "poolguard:onboarding";

export type OnboardingStatus = "done" | "skipped" | null;

export function onboardingStatus(): OnboardingStatus {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "done" || value === "skipped" ? value : null;
  } catch {
    return null;
  }
}

export function setOnboardingStatus(status: Exclude<OnboardingStatus, null>) {
  try {
    window.localStorage.setItem(KEY, status);
  } catch {
    /* non-essential */
  }
}

export function clearOnboardingStatus() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* non-essential */
  }
}

/** Only same-origin workspace paths are accepted as a post-login destination. */
export function safeNext(next: string | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  if (next.startsWith("/login")) return null;
  return next;
}

/**
 * Where to go after signing in: the page the user asked for, else guided setup
 * for an account with no tasks that hasn't finished or skipped it, else Overview.
 */
export async function destinationAfterSignIn(next: string | null): Promise<string> {
  const requested = safeNext(next);
  if (requested && requested !== "/app") return requested;
  if (onboardingStatus()) return requested ?? "/app";
  try {
    const { tasks } = await api<{ tasks: TaskSummary[] }>("/tasks");
    if (tasks.length === 0) return "/onboarding";
  } catch {
    /* fall through to the workspace */
  }
  return requested ?? "/app";
}
