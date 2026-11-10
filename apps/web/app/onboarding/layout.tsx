import type { Metadata } from "next";
import { AuthGate } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Guided setup",
  description: "Set up your first shared agent budget in a few short steps.",
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)]">
      <AuthGate>{children}</AuthGate>
    </div>
  );
}
