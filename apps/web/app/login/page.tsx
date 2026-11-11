"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  FlaskConical,
  KeyRound,
  Loader2,
  PenLine,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { NetworkBadge } from "@/components/network-badge";
import { PoolVignette } from "@/components/pool-vignette";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DrawnCheck } from "@/components/ui/drawn-check";
import { destinationAfterSignIn } from "@/lib/onboarding";
import { api, ApiError } from "@/lib/api";
import { LEGAL_VERSIONS } from "@poolguard/shared";
import { feedback } from "@/lib/feedback";
import { STAGE_COPY, useWalletSignIn, type SignInStage } from "@/lib/use-wallet-sign-in";
import { duration, ease, rise, spring, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";

const WALLETS = [
  { name: "Sender", note: "Browser extension" },
  { name: "Nightly", note: "Extension and mobile" },
  { name: "Meteor", note: "Web and extension" },
  { name: "HERE", note: "Mobile wallet" },
];

const STEPS: Array<{ icon: React.ComponentType<{ className?: string }>; title: string; body: string; stages: SignInStage[] }> = [
  { icon: Wallet, title: "Connect", body: "Pick a NEAR testnet wallet.", stages: ["connecting"] },
  { icon: PenLine, title: "Sign a message", body: "Free. No transaction, no fee.", stages: ["signing", "verifying"] },
  { icon: Check, title: "You’re in", body: "Your workspace opens.", stages: ["success"] },
];

const SANDBOX_STEPS: typeof STEPS = [
  { icon: FlaskConical, title: "Start session", body: "One click, local only.", stages: ["connecting"] },
  { icon: ShieldCheck, title: "Real contract", body: "Limits still enforced.", stages: ["signing", "verifying"] },
  { icon: Check, title: "You’re in", body: "Your workspace opens.", stages: ["success"] },
];

const REASONS: Record<string, { tone: "info" | "warning"; text: string }> = {
  expired: { tone: "warning", text: "Your session ended. Sign in again to pick up where you left off." },
  "signed-out": { tone: "info", text: "You’re signed out. Your tasks and budgets stay on chain." },
};

export default function LoginPage() {
  return (
    <React.Suspense fallback={<LoginSkeleton />}>
      <LoginScreen />
    </React.Suspense>
  );
}

function LoginScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { meta, loading, authenticated, startDevSession, devSessionPending } = useAuth();
  const next = params.get("next");
  const reason = REASONS[params.get("reason") ?? ""];
  const [sandboxStage, setSandboxStage] = React.useState<"idle" | "working" | "success">("idle");
  const [sandboxError, setSandboxError] = React.useState<string | null>(null);
  const [sandboxErrorCode, setSandboxErrorCode] = React.useState<string | null>(null);
  const [agreed, setAgreed] = React.useState(false);
  const agreedRef = React.useRef(false);
  agreedRef.current = agreed;
  const leaving = React.useRef(false);

  const goIn = React.useCallback(async () => {
    if (leaving.current) return;
    leaving.current = true;
    // Record the Terms/Privacy acceptance given on this screen.
    if (agreedRef.current) {
      await api("/account/consent", {
        method: "POST",
        body: JSON.stringify({ terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy }),
      }).catch(() => undefined);
    }
    await queryClient.invalidateQueries();
    const destination = await destinationAfterSignIn(next);
    // Let the success state register before the route changes.
    await new Promise((resolve) => setTimeout(resolve, 650));
    router.replace(destination);
  }, [next, queryClient, router]);

  const wallet = useWalletSignIn(goIn);

  // Already signed in (for example, a stale bookmark to /login): go straight in.
  React.useEffect(() => {
    if (!loading && authenticated && wallet.stage === "idle" && sandboxStage === "idle") void goIn();
  }, [authenticated, loading, wallet.stage, sandboxStage, goIn]);

  const sandbox = meta?.network === "sandbox" || meta?.sandbox;

  const startSandbox = async () => {
    setSandboxError(null);
    setSandboxStage("working");
    try {
      await startDevSession();
      setSandboxStage("success");
      feedback("success");
      await goIn();
    } catch (error) {
      setSandboxStage("idle");
      setSandboxError(error instanceof Error ? error.message : "The sandbox session could not start.");
      setSandboxErrorCode(error instanceof ApiError ? error.code : null);
      feedback("error");
    }
  };

  const activeStage: SignInStage = sandbox
    ? sandboxStage === "success"
      ? "success"
      : sandboxStage === "working"
        ? "verifying"
        : "idle"
    : wallet.stage;

  return (
    <div className="grid min-h-dvh bg-[var(--background)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Story side */}
      <aside className="grain relative hidden overflow-hidden border-r border-[var(--border)] bg-[var(--surface-muted)] lg:flex lg:flex-col">
        <div className="grid-lines pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
        <div className="relative flex items-center justify-between px-10 pt-8">
          <Brand />
          <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] text-[var(--foreground-muted)] hover:text-[var(--foreground)]">
            <ArrowLeft className="size-3.5" /> Home
          </Link>
        </div>
        <div className="relative flex flex-1 flex-col items-center justify-center px-10 py-12">
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease }}
            className="w-full max-w-[440px]"
          >
            <PoolVignette />
          </motion.div>
          <motion.div
            className="mt-10 max-w-[440px] text-center"
            initial="hidden"
            animate="show"
            variants={stagger(0.08, 0.25)}
          >
            <motion.h2 variants={rise} className="text-[22px] font-semibold tracking-[-0.02em]">
              Give agents room to work.
            </motion.h2>
            <motion.p variants={rise} className="mt-2 text-[14px] leading-6 text-[var(--foreground-secondary)]">
              One shared budget, approved providers and a per-purchase limit — all enforced by a NEAR
              contract, not by the model.
            </motion.p>
          </motion.div>
        </div>
        <p className="relative px-10 pb-8 text-[11px] text-[var(--foreground-muted)]">
          Testnet prototype. Not audited. Test tokens have no monetary value.
        </p>
      </aside>

      {/* Sign-in side */}
      <main id="main" className="flex min-h-dvh flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between lg:hidden">
          <Brand />
          <Link href="/" className="text-[13px] text-[var(--foreground-muted)]">
            Home
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <motion.div
            className="w-full max-w-[420px]"
            initial="hidden"
            animate="show"
            variants={stagger(0.07, 0.05)}
          >
            <motion.div variants={rise} className="flex items-center gap-2">
              {loading ? <Skeleton className="h-6 w-28" /> : <NetworkBadge network={meta?.network} sandbox={meta?.sandbox} />}
            </motion.div>
            <motion.h1 variants={rise} className="mt-4 text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] sm:text-[34px]">
              Sign in to PoolGuard
            </motion.h1>
            <motion.p variants={rise} className="mt-2.5 text-[15px] leading-6 text-[var(--foreground-secondary)]">
              {sandbox
                ? "This is a local sandbox. Start a labelled sandbox session — every reservation and payment still runs on a real NEAR node."
                : "Prove you own a NEAR account by signing a one-time message. It isn’t a transaction and costs nothing."}
            </motion.p>

            <AnimatePresence initial={false}>
              {reason ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <p
                    role="status"
                    className={cn(
                      "mt-5 rounded-[10px] px-3.5 py-2.5 text-[13px] leading-5",
                      reason.tone === "warning"
                        ? "bg-[var(--warning-background)] text-[var(--warning)]"
                        : "bg-[var(--info-background)] text-[var(--info)]",
                    )}
                  >
                    {reason.text}
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <motion.div variants={rise} className="mt-7">
              {wallet.errorCode === "ACCOUNT_NOT_ALLOWED" || sandboxErrorCode === "ACCOUNT_NOT_ALLOWED" ? (
                <InviteOnly
                  onBack={() => {
                    wallet.reset();
                    setSandboxError(null);
                    setSandboxErrorCode(null);
                  }}
                />
              ) : wallet.stage === "review" && wallet.challenge ? (
                <MessageReview message={wallet.challenge.message} onSign={() => void wallet.confirm()} onCancel={wallet.reset} />
              ) : loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : !agreed ? (
                <ConsentGate agreed={agreed} onChange={setAgreed} />
              ) : sandbox ? (
                <SandboxPanel
                  enabled={Boolean(meta?.devSessionEnabled)}
                  account={meta?.ownerAccountId ?? null}
                  stage={sandboxStage}
                  pending={devSessionPending}
                  error={sandboxError}
                  onStart={() => void startSandbox()}
                />
              ) : (
                <WalletPanel
                  stage={wallet.stage}
                  busy={wallet.busy}
                  error={wallet.error}
                  onSignIn={() => void wallet.signIn()}
                  onRetry={wallet.reset}
                  devSessionEnabled={Boolean(meta?.devSessionEnabled)}
                  onSandbox={() => void startSandbox()}
                />
              )}
              {agreed && wallet.stage !== "review" ? (
                <p className="mt-3 text-[11px] text-[var(--foreground-muted)]">
                  You agreed to the <Link href="/terms" className="underline underline-offset-2">Terms</Link> and{" "}
                  <Link href="/privacy" className="underline underline-offset-2">Privacy Policy</Link>.{" "}
                  <button type="button" className="underline underline-offset-2" onClick={() => setAgreed(false)}>
                    Change
                  </button>
                </p>
              ) : null}
            </motion.div>

            <motion.ol variants={rise} className="mt-8 grid grid-cols-3 gap-2" aria-label="Sign-in steps">
              {(sandbox ? SANDBOX_STEPS : STEPS).map((step, index) => {
                const reached = stepReached(activeStage, index);
                const current = step.stages.includes(activeStage);
                return (
                  <li key={step.title} className="relative">
                    <div
                      className={cn(
                        "h-1 overflow-hidden rounded-full bg-[var(--surface-selected)]",
                      )}
                    >
                      <motion.div
                        className="h-full bg-[var(--foreground)]"
                        initial={false}
                        animate={{ width: reached ? "100%" : current ? "55%" : "0%" }}
                        transition={spring.gentle}
                      />
                    </div>
                    <div className="mt-2.5 flex items-center gap-1.5">
                      <step.icon className={cn("size-3.5", reached || current ? "text-[var(--foreground)]" : "text-[var(--foreground-muted)]")} />
                      <span className="text-[12px] font-medium">{step.title}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-4 text-[var(--foreground-muted)]">{step.body}</p>
                  </li>
                );
              })}
            </motion.ol>

            <motion.ul variants={rise} className="mt-8 space-y-2 border-t border-[var(--border)] pt-5 text-[12px] text-[var(--foreground-secondary)]">
              <li className="flex items-center gap-2">
                <KeyRound className="size-3.5 text-[var(--accent)]" /> PoolGuard never asks for a seed phrase or private key.
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck className="size-3.5 text-[var(--accent)]" /> The backend never signs for the owner. Funding always needs your wallet.
              </li>
            </motion.ul>
          </motion.div>
        </div>
        <p className="text-center text-[11px] text-[var(--foreground-muted)] lg:hidden">
          Testnet prototype. Not audited. Test tokens have no monetary value.
        </p>
      </main>
    </div>
  );
}

function stepReached(stage: SignInStage, index: number): boolean {
  const order: Record<SignInStage, number> = {
    idle: -1,
    error: -1,
    connecting: 0,
    review: 1,
    signing: 1,
    verifying: 1,
    success: 3,
  };
  return order[stage] > index;
}

function SandboxPanel({
  enabled,
  account,
  stage,
  pending,
  error,
  onStart,
}: {
  enabled: boolean;
  account: string | null;
  stage: "idle" | "working" | "success";
  pending: boolean;
  error: string | null;
  onStart: () => void;
}) {
  if (!enabled) {
    return (
      <p className="rounded-[10px] bg-[var(--danger-background)] px-3.5 py-3 text-[13px] text-[var(--danger)]">
        Sandbox sessions are disabled. Set <span className="mono">ALLOW_DEV_SESSION=true</span> for local demos only.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <StageButton
        stage={stage === "success" ? "success" : stage === "working" || pending ? "verifying" : "idle"}
        idleLabel="Use sandbox session"
        idleIcon={FlaskConical}
        workingLabel="Starting the sandbox session…"
        onClick={onStart}
      />
      {account ? (
        <p className="flex items-center justify-between rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[12px]">
          <span className="text-[var(--foreground-muted)]">Session account</span>
          <span className="mono text-[var(--foreground)]">{account}</span>
        </p>
      ) : null}
      <ErrorNote error={error} />
    </div>
  );
}

function WalletPanel({
  stage,
  busy,
  error,
  onSignIn,
  onRetry,
  devSessionEnabled,
  onSandbox,
}: {
  stage: SignInStage;
  busy: boolean;
  error: string | null;
  onSignIn: () => void;
  onRetry: () => void;
  devSessionEnabled: boolean;
  onSandbox: () => void;
}) {
  return (
    <div className="space-y-4">
      <StageButton
        stage={stage === "error" ? "idle" : stage}
        idleLabel={stage === "error" ? "Try again" : "Connect a wallet"}
        idleIcon={Wallet}
        workingLabel={stage === "connecting" || stage === "signing" || stage === "verifying" ? STAGE_COPY[stage] : ""}
        onClick={() => {
          if (stage === "error") onRetry();
          onSignIn();
        }}
      />
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--foreground-muted)]">Supported wallets</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {WALLETS.map((item) => (
            <button
              key={item.name}
              type="button"
              disabled={busy}
              onClick={onSignIn}
              className="lift flex items-center gap-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-left disabled:opacity-60"
            >
              <span className="flex size-8 items-center justify-center rounded-[8px] bg-[var(--surface-muted)] text-[12px] font-semibold">
                {item.name.slice(0, 1)}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{item.name}</span>
                <span className="block truncate text-[11px] text-[var(--foreground-muted)]">{item.note}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-[var(--foreground-muted)]">
          Each opens the NEAR wallet selector. Message signing (NEP-413) is required.
        </p>
      </div>
      <ErrorNote error={error} />
      {devSessionEnabled ? (
        <Button variant="ghost" size="sm" onClick={onSandbox}>
          <FlaskConical /> Use local sandbox session instead
        </Button>
      ) : null}
    </div>
  );
}

function StageButton({
  stage,
  idleLabel,
  idleIcon: IdleIcon,
  workingLabel,
  onClick,
}: {
  stage: SignInStage;
  idleLabel: string;
  idleIcon: React.ComponentType<{ className?: string }>;
  workingLabel: string;
  onClick: () => void;
}) {
  const working = stage === "connecting" || stage === "signing" || stage === "verifying";
  const success = stage === "success";
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={working || success}
      aria-busy={working || undefined}
      whileTap={{ scale: 0.97 }}
      transition={spring.snappy}
      className={cn(
        "relative flex h-12 w-full items-center justify-center overflow-hidden rounded-[14px] text-[15px] font-medium text-[var(--action-foreground)] shadow-[inset_0_1px_0_rgb(255_255_255_/_35%),0_8px_24px_rgb(132_134_245_/_28%)] transition-colors duration-200",
        success ? "bg-[var(--success)]" : "bg-[var(--action)] hover:bg-[var(--action-hover)]",
        working && "cursor-progress",
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {success ? (
          <motion.span
            key="success"
            className="flex items-center gap-2"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.fast, ease }}
          >
            <DrawnCheck /> Signed in — opening your workspace
          </motion.span>
        ) : working ? (
          <motion.span
            key={workingLabel || "working"}
            className="flex items-center gap-2"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: duration.fast, ease }}
          >
            <Loader2 className="size-4 animate-spin" /> {workingLabel || "Working…"}
          </motion.span>
        ) : (
          <motion.span
            key="idle"
            className="flex items-center gap-2"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: duration.fast, ease }}
          >
            <IdleIcon className="size-4" /> {idleLabel}
            <ArrowRight className="size-4 opacity-70" />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function ErrorNote({ error }: { error: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {error ? (
        <motion.p
          role="alert"
          key={error}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="shake flex items-start gap-2 overflow-hidden rounded-[10px] bg-[var(--danger-background)] px-3.5 py-2.5 text-[13px] leading-5 text-[var(--danger)]"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

function LoginSkeleton() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-[420px] space-y-4">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}

/** Terms and Privacy agreement shown before any sign-in control. */
function ConsentGate({ agreed, onChange }: { agreed: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-[14px] font-medium">Before you sign in</p>
      <ul className="mt-2 space-y-1.5 text-[13px] leading-5 text-[var(--foreground-secondary)]">
        <li>• PoolGuard runs on NEAR testnet. Tokens have no monetary value and the software is not audited.</li>
        <li>• Task names and payments are written on a public blockchain, permanently.</li>
        <li>• Agents are AI and can make mistakes; the contract, not the AI, controls spending.</li>
      </ul>
      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-[10px] bg-[var(--surface-muted)] p-3 text-[13px] leading-5">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--action)]"
        />
        <span>
          I’m 18 or older and I agree to the{" "}
          <Link href="/terms" target="_blank" className="font-medium text-[var(--action)] underline underline-offset-2">
            Terms of Use
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" className="font-medium text-[var(--action)] underline underline-offset-2">
            Privacy Policy
          </Link>
          .
        </span>
      </label>
    </div>
  );
}

/** Shows the exact NEP-413 message before the wallet is asked to sign it. */
function MessageReview({ message, onSign, onCancel }: { message: string; onSign: () => void; onCancel: () => void }) {
  return (
    <div className="space-y-3">
      <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-[14px] font-medium">You’re about to sign this message</p>
        <pre className="mono mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-[var(--surface-muted)] p-3 text-[11px] leading-5 text-[var(--foreground-secondary)]">
          {message}
        </pre>
        <ul className="mt-3 space-y-1 text-[12px] leading-5 text-[var(--foreground-secondary)]">
          <li>• It proves you own this account. It is <strong>not a transaction</strong>.</li>
          <li>• Signing costs nothing and <strong>moves no funds</strong>.</li>
          <li>• Your wallet should show the same text. If it doesn’t, cancel.</li>
        </ul>
      </div>
      <Button size="lg" variant="action" className="w-full" onClick={onSign}>
        <PenLine /> Sign in your wallet
      </Button>
      <Button variant="ghost" className="w-full" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/** Shown when the account is not on the sign-in allowlist. */
function InviteOnly({ onBack }: { onBack: () => void }) {
  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5">
      <span className="flex size-10 items-center justify-center rounded-full bg-[var(--action-soft)] text-[var(--action)]">
        <KeyRound className="size-5" />
      </span>
      <h2 className="mt-4 text-[18px] font-semibold">Access is invite-only for now</h2>
      <p className="mt-2 text-[14px] leading-6 text-[var(--foreground-secondary)]">
        This deployment only lets invited NEAR accounts sign in while it’s being tested. Nothing was signed or spent.
      </p>
      <p className="mt-2 text-[13px] text-[var(--foreground-secondary)]">
        To ask for access, <Link href="/contact" className="font-medium text-[var(--action)] underline underline-offset-2">contact the operator</Link>.
      </p>
      <Button variant="secondary" className="mt-4" onClick={onBack}>
        Try a different account
      </Button>
    </div>
  );
}
