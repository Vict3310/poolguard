"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Keyboard, LogOut, RotateCcw, ShieldCheck, Volume2, Vibrate, Wind } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { NetworkBadge } from "@/components/network-badge";
import { CopyButton } from "@/components/copy-button";
import { useAuth } from "@/components/auth-provider";
import { usePreferences, type MotionPreference } from "@/components/preferences-provider";
import { SHORTCUTS, useCommandPalette } from "@/components/command-palette";
import { Button } from "@/components/ui/button";
import { Segmented, Switch } from "@/components/ui/switch";
import { feedback, vibrationSupported } from "@/lib/feedback";
import { clearOnboardingStatus } from "@/lib/onboarding";
import { rise, stagger } from "@/lib/motion";

export default function SettingsPage() {
  const router = useRouter();
  const { accountId, meta, signOut } = useAuth();
  const { preferences, setPreference, reducedMotion } = usePreferences();
  const { openShortcuts } = useCommandPalette();
  const [canVibrate, setCanVibrate] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  React.useEffect(() => setCanVibrate(vibrationSupported()), []);

  return (
    <div className="mx-auto max-w-[820px]">
      <PageHeader title="Settings" description="Your session, how the interface feels, and where to find developer details." />
      <motion.div className="mt-8 space-y-6" initial="hidden" animate="show" variants={stagger(0.06)}>
        <Section title="Account" description="Sessions are verified with a NEP-413 message signature, or a labelled sandbox session locally.">
          <Row label="Signed in as">
            <span className="flex items-center gap-2">
              <span className="mono truncate text-[13px]">{accountId}</span>
              {accountId ? <CopyButton value={accountId} label="Copy account id" /> : null}
            </span>
          </Row>
          <Row label="Network">
            <NetworkBadge network={meta?.network} sandbox={meta?.sandbox} />
          </Row>
          <Row label="Verification">
            {meta?.sandbox ? (
              <span className="text-[13px] text-[var(--foreground-secondary)]">Sandbox session · no wallet signature</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--success)]">
                <ShieldCheck className="size-3.5" /> NEP-413 signature verified
              </span>
            )}
          </Row>
          <div className="px-5 py-4">
            <Button
              variant="secondary"
              loading={signingOut}
              onClick={async () => {
                setSigningOut(true);
                await signOut();
                router.push("/login?reason=signed-out");
              }}
            >
              <LogOut /> Sign out
            </Button>
          </div>
        </Section>

        <Section title="Experience" description="Motion, sound and vibration are personal and stored only in this browser.">
          <Row label="Motion" hint={reducedMotion ? "Animations are reduced right now." : "Animations follow PoolGuard’s calm motion system."} icon={Wind}>
            <Segmented<MotionPreference>
              id="motion"
              label="Motion preference"
              value={preferences.motion}
              onChange={(value) => setPreference("motion", value)}
              options={[
                { value: "system", label: "System" },
                { value: "reduced", label: "Reduced" },
                { value: "full", label: "Full" },
              ]}
            />
          </Row>
          <Row label="Sound" hint="Quiet tones for success and errors. Off by default so you can focus." icon={Volume2}>
            <Switch label="Sound effects" checked={preferences.sound} onCheckedChange={(value) => setPreference("sound", value)} />
          </Row>
          <Row
            label="Vibration"
            hint={canVibrate ? "Short pulses on supported phones." : "This browser doesn’t support vibration (common on iPhone and desktop)."}
            icon={Vibrate}
          >
            <Switch label="Vibration" disabled={!canVibrate} checked={preferences.haptics} onCheckedChange={(value) => setPreference("haptics", value)} />
          </Row>
          <div className="flex flex-wrap gap-2 px-5 py-4">
            <Button size="sm" variant="ghost" onClick={() => feedback("success")} disabled={!preferences.sound && !preferences.haptics}>
              Preview success feedback
            </Button>
            <Button size="sm" variant="ghost" onClick={() => feedback("error")} disabled={!preferences.sound && !preferences.haptics}>
              Preview error feedback
            </Button>
          </div>
        </Section>

        <Section title="Keyboard" description="Move around without the mouse.">
          <ul className="divide-y divide-[var(--border)]">
            {SHORTCUTS.slice(0, 5).map((shortcut) => (
              <li key={shortcut.label} className="flex items-center justify-between gap-4 px-5 py-3 text-[13px]">
                <span className="text-[var(--foreground-secondary)]">{shortcut.label}</span>
                <span className="flex gap-1">
                  {shortcut.keys.map((key) => (
                    <span key={key} className="kbd">
                      {key}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <div className="px-5 py-4">
            <Button size="sm" variant="secondary" onClick={openShortcuts}>
              <Keyboard /> All shortcuts
            </Button>
          </div>
        </Section>

        <Section title="Guided setup" description="Walk through the introduction and create a task with sample documents again.">
          <div className="px-5 py-4">
            <Button
              variant="secondary"
              onClick={() => {
                clearOnboardingStatus();
                router.push("/onboarding");
              }}
            >
              <RotateCcw /> Restart guided setup
            </Button>
          </div>
        </Section>

        <Section title="Developer" description="Details for the SDK and for verifying chain state yourself.">
          <Row label="Contract">
            <span className="flex items-center gap-2">
              <span className="mono truncate text-[12px]">{meta?.contractId ?? "—"}</span>
              {meta?.contractId ? <CopyButton value={meta.contractId} label="Copy contract id" /> : null}
            </span>
          </Row>
          <Row label="Approved provider">
            <span className="mono truncate text-[12px]">{meta?.providerAccountId ?? "—"}</span>
          </Row>
          <Row label="API origin">
            <span className="mono truncate text-[12px]">{meta?.apiOrigin ?? "—"}</span>
          </Row>
          <Row label="AI mode">
            <span className="text-[13px] text-[var(--foreground-secondary)]">
              {meta?.aiConfigured ? `Live model · ${meta.aiModel}` : "Scripted fixtures (no AI key configured)"}
            </span>
          </Row>
        </Section>
      </motion.div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <motion.section variants={rise} className="workspace-panel overflow-hidden">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="mt-0.5 text-[12px] text-[var(--foreground-muted)]">{description}</p>
      </div>
      <div className="divide-y divide-[var(--border)]">{children}</div>
    </motion.section>
  );
}

function Row({
  label,
  hint,
  icon: Icon,
  children,
}: {
  label: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? <Icon className="mt-0.5 size-4 shrink-0 text-[var(--foreground-muted)]" /> : null}
        <div className="min-w-0">
          <p className="text-[13px] font-medium">{label}</p>
          {hint ? <p className="mt-0.5 text-[12px] leading-5 text-[var(--foreground-muted)]">{hint}</p> : null}
        </div>
      </div>
      <div className="min-w-0 sm:max-w-[60%]">{children}</div>
    </div>
  );
}
