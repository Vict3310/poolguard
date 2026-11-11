"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CircleDollarSign,
  FlaskConical,
  KeyRound,
  Play,
  Repeat,
  ShieldCheck,
  Store,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { PoolVignette } from "@/components/pool-vignette";
import { TaskWizard } from "@/components/task-wizard";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { AnimatedNear } from "@/components/ui/animated-number";
import { DrawnCheck } from "@/components/ui/drawn-check";
import { api, ApiError } from "@/lib/api";
import { feedback } from "@/lib/feedback";
import { duration, ease, rise, spring, stagger } from "@/lib/motion";
import { setOnboardingStatus } from "@/lib/onboarding";
import { useTaskSetup } from "@/lib/use-task-setup";
import { cn } from "@/lib/utils";
import type { RunResponse, Task } from "@/lib/types";

const STAGES = ["Welcome", "Your agents", "Your first task", "First run"] as const;
const STORAGE_KEY = "poolguard:onboarding-stage";

export default function OnboardingPage() {
  const router = useRouter();
  const [stage, setStage] = React.useState(0);
  const [direction, setDirection] = React.useState(1);
  const [fundedTaskId, setFundedTaskId] = React.useState<string | null>(null);

  // Resume where the user left off (task creation keeps its own draft).
  React.useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as
        | { stage: number; taskId: string | null }
        | null;
      if (saved && saved.stage >= 0 && saved.stage < STAGES.length) {
        setStage(saved.taskId || saved.stage < 3 ? saved.stage : 2);
        setFundedTaskId(saved.taskId);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const goTo = React.useCallback(
    (next: number, taskId: string | null = fundedTaskId) => {
      setDirection(next > stage ? 1 : -1);
      setStage(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ stage: next, taskId }));
      } catch {
        /* ignore */
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [fundedTaskId, stage],
  );

  const finish = (destination: string, status: "done" | "skipped") => {
    setOnboardingStatus(status);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    router.push(destination);
  };

  const setup = useTaskSetup({
    onFunded: (taskId) => {
      setFundedTaskId(taskId);
      goTo(3, taskId);
    },
  });

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--background)]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1040px] items-center gap-4 px-5">
          <Brand href="/app" />
          <div className="mx-auto hidden w-full max-w-[420px] md:block">
            <ProgressRail stage={stage} />
          </div>
          <button
            type="button"
            onClick={() => finish("/app", "skipped")}
            className="ml-auto shrink-0 text-[13px] text-[var(--foreground-muted)] underline-offset-4 hover:text-[var(--foreground)] hover:underline md:ml-0"
          >
            Skip setup
          </button>
        </div>
        <div className="px-5 pb-3 md:hidden">
          <ProgressRail stage={stage} />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1040px] flex-1 overflow-x-clip px-5 py-8 sm:py-12">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={stage}
            custom={direction}
            variants={{
              enter: (dir: number) => ({ opacity: 0, x: dir * 28 }),
              center: { opacity: 1, x: 0 },
              exit: (dir: number) => ({ opacity: 0, x: dir * -28 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: duration.base, ease }}
          >
            {stage === 0 ? <Welcome onNext={() => goTo(1)} /> : null}
            {stage === 1 ? <MeetAgents onBack={() => goTo(0)} onNext={() => goTo(2)} /> : null}
            {stage === 2 ? (
              <div>
                <StageHeading
                  eyebrow="Step 3 of 4"
                  title="Set up your first task"
                  body="We’ve filled in sensible defaults. Load the sample documents and you can be live in under a minute."
                />
                <div className="mt-8">
                  <TaskWizard setup={setup} variant="onboarding" cancelHref="/app" />
                </div>
                <button
                  type="button"
                  onClick={() => goTo(1)}
                  className="mt-6 inline-flex items-center gap-1.5 text-[13px] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                >
                  <ArrowLeft className="size-3.5" /> Back to your agents
                </button>
              </div>
            ) : null}
            {stage === 3 && fundedTaskId ? (
              <FirstRun taskId={fundedTaskId} onDone={(destination) => finish(destination, "done")} />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function ProgressRail({ stage }: { stage: number }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] text-[var(--foreground-muted)]">
        <span className="font-medium text-[var(--foreground)]">{STAGES[stage]}</span>
        <span>
          {stage + 1} of {STAGES.length}
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--surface-selected)]">
        <motion.div
          className="h-full rounded-full bg-[var(--foreground)]"
          initial={false}
          animate={{ width: `${((stage + 1) / STAGES.length) * 100}%` }}
          transition={spring.gentle}
        />
      </div>
    </div>
  );
}

function StageHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <motion.div initial="hidden" animate="show" variants={stagger(0.07)}>
      <motion.p variants={rise} className="eyebrow">
        {eyebrow}
      </motion.p>
      <motion.h1 variants={rise} className="mt-3 max-w-2xl text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] sm:text-[38px]">
        {title}
      </motion.h1>
      <motion.p variants={rise} className="mt-3 max-w-xl text-[15px] leading-6 text-[var(--foreground-secondary)]">
        {body}
      </motion.p>
    </motion.div>
  );
}

const PRINCIPLES = [
  {
    icon: CircleDollarSign,
    title: "One shared budget",
    body: "Every agent reserves from the same pool before it buys. Two agents can never spend the same balance twice.",
  },
  {
    icon: Store,
    title: "Approved providers only",
    body: "You choose who can be paid and the most any single purchase may cost. The contract enforces it, not the model.",
  },
  {
    icon: Repeat,
    title: "One payment per purchase",
    body: "Retries reuse the same operation id. A dropped response is recovered from chain, never paid twice.",
  },
];

function Welcome({ onNext }: { onNext: () => void }) {
  const { accountId } = useAuth();
  return (
    <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div>
        <StageHeading
          eyebrow={accountId ? `Welcome, ${accountId}` : "Welcome"}
          title="Let agents spend — inside limits you set."
          body="PoolGuard gives a team of AI agents one budget to share, enforced by a NEAR contract. Here’s the idea in thirty seconds."
        />
        <motion.ul className="mt-8 space-y-3" initial="hidden" animate="show" variants={stagger(0.09, 0.25)}>
          {PRINCIPLES.map((item) => (
            <motion.li key={item.title} variants={rise} className="lift flex gap-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--surface-muted)] text-[var(--accent)]">
                <item.icon className="size-5" />
              </span>
              <span>
                <span className="block text-[15px] font-semibold">{item.title}</span>
                <span className="mt-1 block text-[13px] leading-5 text-[var(--foreground-secondary)]">{item.body}</span>
              </span>
            </motion.li>
          ))}
        </motion.ul>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="mt-8 flex flex-wrap items-center gap-3">
          <Button size="lg" variant="action" onClick={onNext}>
            Show me how <ArrowRight />
          </Button>
          <span className="text-[12px] text-[var(--foreground-muted)]">About two minutes · you can skip any time</span>
        </motion.div>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease, delay: 0.15 }}
        className="hidden justify-center lg:flex"
      >
        <PoolVignette />
      </motion.div>
    </div>
  );
}

function MeetAgents({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { meta } = useAuth();
  const workers = meta?.workerAccounts ?? [];
  return (
    <div>
      <StageHeading
        eyebrow="Step 2 of 4"
        title="Meet your two agents"
        body="Each agent is its own NEAR account with a restricted key. It can reserve and pay from your task — and nothing else."
      />
      <motion.div className="mt-8 grid gap-4 md:grid-cols-2" initial="hidden" animate="show" variants={stagger(0.12, 0.2)}>
        {(workers.length ? workers : [{ slot: 1, accountId: "agent-one" }, { slot: 2, accountId: "agent-two" }]).map((worker) => (
          <motion.div key={worker.accountId} variants={rise} className="lift rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-center gap-3">
              <motion.span
                className="flex size-11 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)]"
                initial={{ scale: 0.6, rotate: -8 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ ...spring.snappy, delay: 0.3 + worker.slot * 0.1 }}
              >
                <Bot className="size-5" />
              </motion.span>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold">Agent {worker.slot === 1 ? "one" : "two"}</p>
                <p className="mono truncate text-[12px] text-[var(--foreground-muted)]">{worker.accountId}</p>
              </div>
            </div>
            <ul className="mt-4 space-y-2 text-[13px] text-[var(--foreground-secondary)]">
              <li className="flex items-center gap-2">
                <KeyRound className="size-3.5 text-[var(--accent)]" />
                {"custody" in worker && worker.custody === "outlayer"
                  ? "Key sealed in OutLayer's secure enclave, with its own spend policy"
                  : "Key limited to reserve, execute and cancel"}
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck className="size-3.5 text-[var(--accent)]" /> Can’t change limits, add vendors or withdraw
              </li>
            </ul>
          </motion.div>
        ))}
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: duration.base }}
        className="mt-4 flex items-center gap-3 rounded-[12px] border border-dashed border-[var(--border-strong)]/50 bg-[var(--surface-muted)] p-4"
      >
        <Store className="size-5 shrink-0 text-[var(--foreground-muted)]" />
        <p className="text-[13px] leading-5 text-[var(--foreground-secondary)]">
          They buy from one approved provider:{" "}
          <span className="mono text-[var(--foreground)]">{meta?.providerAccountId ?? "…"}</span>, a fixed-price document
          extraction service.
        </p>
      </motion.div>
      {workers.some((worker) => worker.custody === "outlayer") ? (
        <p className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 text-[13px] leading-5 text-[var(--foreground-secondary)]">
          <strong className="text-[var(--foreground)]">Keys held by a third party.</strong> In this deployment the agents’ keys live
          in OutLayer’s secure enclave, not on PoolGuard’s servers. OutLayer checks its own spending policy before signing. If
          OutLayer is unavailable, agents pause until it returns; nothing is paid twice.
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
        <Button size="lg" variant="action" onClick={onNext}>
          Set up a task <ArrowRight />
        </Button>
      </div>
    </div>
  );
}

function FirstRun({ taskId, onDone }: { taskId: string; onDone: (destination: string) => void }) {
  const { meta } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const task = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api<{ task: Task }>(`/tasks/${taskId}`).then((value) => value.task),
  });
  const run = useMutation({
    mutationFn: () =>
      api<RunResponse>(`/tasks/${taskId}/runs`, {
        method: "POST",
        body: JSON.stringify({ mode: meta?.aiConfigured ? "live" : "scripted", scenario: null }),
      }),
    onSuccess: async () => {
      feedback("success");
      await queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      onDone(`/app/tasks/${taskId}`);
    },
    onError: (mutationError) => {
      feedback("error");
      setError(mutationError instanceof ApiError ? mutationError.message : "The run could not be started.");
    },
  });
  const budget = task.data?.budget;

  return (
    <div className="mx-auto max-w-[620px] text-center">
      <motion.div
        className="mx-auto flex size-16 items-center justify-center rounded-full bg-[var(--success-background)] text-[var(--success)]"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring.snappy}
      >
        <DrawnCheck className="size-8" delay={0.15} />
      </motion.div>
      <motion.div initial="hidden" animate="show" variants={stagger(0.08, 0.2)}>
        <motion.p variants={rise} className="eyebrow mt-6">
          Step 4 of 4
        </motion.p>
        <motion.h1 variants={rise} className="mt-3 text-[30px] font-semibold tracking-[-0.03em] sm:text-[36px]">
          Your pool is live.
        </motion.h1>
        <motion.p variants={rise} className="mx-auto mt-3 max-w-md text-[15px] leading-6 text-[var(--foreground-secondary)]">
          {task.data?.name ?? "Your task"} is funded on chain and both agents are registered. Start a run and watch them work.
        </motion.p>
        <motion.div variants={rise} className="mt-8 grid grid-cols-3 divide-x divide-[var(--border)] rounded-[14px] border border-[var(--border)] bg-[var(--surface)] py-5">
          {[
            ["Available", budget?.availableYocto],
            ["Reserved", budget?.reservedYocto],
            ["Spent", budget?.spentYocto],
          ].map(([label, value]) => (
            <div key={label} className="px-3">
              <p className="text-[12px] text-[var(--foreground-muted)]">{label}</p>
              <p className="financial-value mt-1 text-[22px] font-semibold tracking-[-0.02em]">
                {value == null ? <span className="text-[var(--foreground-muted)]">—</span> : <AnimatedNear yocto={value} />}
              </p>
            </div>
          ))}
        </motion.div>
        <motion.div variants={rise} className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button size="lg" variant="action" onClick={() => run.mutate()} loading={run.isPending}>
            <Play /> {meta?.aiConfigured ? "Run the agents" : "Run the agents (scripted)"}
          </Button>
          <Button size="lg" variant="secondary" onClick={() => onDone("/app/demo")}>
            <FlaskConical /> Try the demo lab
          </Button>
        </motion.div>
        {!meta?.aiConfigured ? (
          <motion.p variants={rise} className="mx-auto mt-4 max-w-md text-[12px] leading-5 text-[var(--foreground-muted)]">
            No AI key is configured, so agents follow a labelled script. Reservations, payments and the provider are still real.
          </motion.p>
        ) : null}
        <AnimatePresence>
          {error ? (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              role="alert"
              className={cn("shake mx-auto mt-4 max-w-md rounded-[8px] bg-[var(--danger-background)] px-3 py-2 text-[13px] text-[var(--danger)]")}
            >
              {error}
            </motion.p>
          ) : null}
        </AnimatePresence>
        <motion.div variants={rise} className="mt-6">
          <Link href={`/app/tasks/${taskId}`} onClick={() => onDone(`/app/tasks/${taskId}`)} className="text-[13px] text-[var(--foreground-muted)] underline-offset-4 hover:text-[var(--foreground)] hover:underline">
            Open the task without running
          </Link>
        </motion.div>
      </motion.div>
    </div>
  );
}
