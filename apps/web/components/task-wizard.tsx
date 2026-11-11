"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import {
  Globe,
  LockKeyhole,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CloudCheck,
  FileText,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Wallet,
} from "lucide-react";
import { parseNearToYocto } from "@poolguard/shared";
import { NetworkBadge } from "@/components/network-badge";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BUDGET_PRESETS, type TaskFormValues, type TaskSetup } from "@/lib/use-task-setup";
import { duration, ease, spring } from "@/lib/motion";
import { feedback } from "@/lib/feedback";
import { cn, near } from "@/lib/utils";
import { ApiError } from "@/lib/api";

export const WIZARD_STEPS = [
  { id: "basics", title: "Basics", hint: "Name and goal" },
  { id: "documents", title: "Documents", hint: "What agents read" },
  { id: "budget", title: "Budget", hint: "Limits on chain" },
  { id: "review", title: "Review", hint: "Check and fund" },
] as const;

const UPLOAD_NOTICE_KEY = "poolguard:upload-notice";

/** Plain statement of what funding moves and what can and can't be undone. */
function FundingExplainer({ storageTotal, budget, sandbox }: { storageTotal: string | null; budget: string; sandbox: boolean }) {
  return (
    <div className="rounded-[10px] border border-[var(--warning)]/25 bg-[var(--warning-background)] p-3.5 text-[12px] leading-5 text-[var(--warning)]">
      <p className="font-medium">What funding does</p>
      <ul className="mt-1.5 space-y-1">
        <li>
          • Moves <strong>{budget || "the budget"} testNEAR</strong> plus{" "}
          <strong>{storageTotal ? `${near(storageTotal)} testNEAR` : "the"} storage deposits</strong> from{" "}
          {sandbox ? "the sandbox owner account" : "your wallet"} into the PoolGuard contract. Testnet tokens have no monetary value.
        </li>
        <li>• You can withdraw budget that isn’t reserved, at any time.</li>
        <li>
          • <strong>Can’t be undone:</strong> storage deposits are not refundable, payments to the provider are final, and
          everything written on chain stays public.
        </li>
      </ul>
    </div>
  );
}

const STEP_FIELDS: Array<Array<keyof TaskFormValues | `documents.${number}.${"label" | "text"}`>> = [
  ["name", "objective"],
  ["documents"],
  ["budget_near", "max_per_operation_near", "reservation_ttl_blocks", "expires_in_blocks"],
  [],
];

function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      <AnimatePresence initial={false} mode="wait">
        {error ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: duration.fast }}
          >
            <FieldHint error>{error}</FieldHint>
          </motion.div>
        ) : hint ? (
          <motion.div key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <FieldHint>{hint}</FieldHint>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function FileButton({ onLoad }: { onLoad: (text: string, filename: string) => void }) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".txt,.md,text/plain,text/markdown"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.size > 80_000) {
            onLoad("", file.name);
            return;
          }
          void file.text().then((text) => onLoad(text, file.name));
          event.target.value = "";
        }}
      />
      <Button type="button" size="sm" variant="ghost" onClick={() => ref.current?.click()}>
        <Upload /> Upload text file
      </Button>
    </>
  );
}

export function Stepper({ step, onJump }: { step: number; onJump?: (index: number) => void }) {
  return (
    <ol className="relative grid grid-cols-4 gap-2" aria-label="Task setup steps">
      {WIZARD_STEPS.map((item, index) => {
        const done = index < step;
        const current = index === step;
        return (
          <li key={item.id}>
            <button
              type="button"
              disabled={!onJump || index > step}
              onClick={() => onJump?.(index)}
              aria-current={current ? "step" : undefined}
              className="group w-full text-left disabled:cursor-default"
            >
              <div className="relative h-1 overflow-hidden rounded-full bg-[var(--surface-selected)]">
                <motion.div
                  className={cn("absolute inset-y-0 left-0", current ? "bg-[var(--action)]" : "bg-[var(--foreground)]")}
                  initial={false}
                  animate={{ width: done ? "100%" : current ? "40%" : "0%" }}
                  transition={spring.gentle}
                />
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors duration-200",
                    done
                      ? "border-[var(--action)] bg-[var(--action)] text-[var(--action-foreground)]"
                      : current
                        ? "border-[var(--action)] bg-[var(--action-soft)] text-[var(--action)]"
                        : "border-[var(--border-strong)] text-[var(--foreground-muted)]",
                  )}
                >
                  {done ? <Check className="size-3" /> : index + 1}
                </span>
                <span className={cn("text-[13px] font-medium", current ? "text-[var(--action)]" : done ? "text-[var(--foreground)]" : "text-[var(--foreground-muted)]")}>
                  {item.title}
                </span>
              </div>
              <p className="mt-0.5 hidden pl-7 text-[11px] text-[var(--foreground-muted)] sm:block">{item.hint}</p>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function SaveIndicator({ state }: { state: TaskSetup["saveState"] }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {state === "idle" ? null : (
        <motion.span
          key={state}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: duration.fast }}
          className="inline-flex items-center gap-1.5 text-[12px] text-[var(--foreground-muted)]"
          role="status"
        >
          {state === "saving" ? <Loader2 className="size-3 animate-spin" /> : <CloudCheck className="size-3.5 text-[var(--success)]" />}
          {state === "saving" ? "Saving draft…" : "Draft saved on this device"}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** Proportional pool preview: how many purchases at the limit fit in the budget. */
export function PoolPreview({ budget, limit }: { budget: string; limit: string }) {
  let slots = 0;
  let valid = false;
  try {
    const b = parseNearToYocto(budget.trim());
    const l = parseNearToYocto(limit.trim());
    if (b > 0n && l > 0n) {
      valid = true;
      slots = Number(b / l);
    }
  } catch {
    valid = false;
  }
  const shown = Math.min(slots, 10);
  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[12px] font-medium">Pool preview</p>
        <p className="text-[11px] text-[var(--foreground-muted)]">
          {valid ? `${slots} full-price purchase${slots === 1 ? "" : "s"} fit` : "Enter both amounts"}
        </p>
      </div>
      <div className="mt-3 flex h-9 items-end gap-1.5">
        <AnimatePresence initial={false}>
          {Array.from({ length: shown }).map((_, index) => (
            <motion.span
              key={index}
              layout
              initial={{ opacity: 0, scaleY: 0.2 }}
              animate={{ opacity: 1, scaleY: 1 }}
              exit={{ opacity: 0, scaleY: 0.2 }}
              transition={{ ...spring.snappy, delay: index * 0.03 }}
              style={{ originY: 1 }}
              className="h-full flex-1 rounded-[5px] bg-[var(--accent)]"
            />
          ))}
        </AnimatePresence>
        {valid && slots === 0 ? (
          <span className="text-[12px] text-[var(--danger)]">The limit is larger than the budget.</span>
        ) : null}
        {slots > 10 ? <span className="pl-1 text-[11px] text-[var(--foreground-muted)]">+{slots - 10}</span> : null}
      </div>
      <p className="mt-2 text-[11px] leading-4 text-[var(--foreground-muted)]">
        With two agents, a budget that fits only one full-price purchase forces them to compete.
      </p>
    </div>
  );
}

export function TaskWizard({
  setup,
  variant = "page",
  cancelHref = "/app/tasks",
}: {
  setup: TaskSetup;
  variant?: "page" | "onboarding";
  cancelHref?: string;
}) {
  const { form, documents, values, meta } = setup;
  const [step, setStep] = React.useState(0);
  const [direction, setDirection] = React.useState(1);
  const shake = useAnimationControls();
  const errors = form.formState.errors;
  const [uploadNotice, setUploadNotice] = React.useState(false);
  const [uploadNoticeError, setUploadNoticeError] = React.useState(false);
  React.useEffect(() => {
    try {
      setUploadNotice(window.localStorage.getItem(UPLOAD_NOTICE_KEY) === "accepted");
    } catch {
      /* storage unavailable: ask again */
    }
  }, []);
  const acceptUploadNotice = (value: boolean) => {
    setUploadNotice(value);
    setUploadNoticeError(false);
    try {
      if (value) window.localStorage.setItem(UPLOAD_NOTICE_KEY, "accepted");
      else window.localStorage.removeItem(UPLOAD_NOTICE_KEY);
    } catch {
      /* ignore */
    }
  };
  const custodyOutlayer = (meta?.workerAccounts ?? []).some((worker) => worker.custody === "outlayer");

  const go = async (target: number) => {
    if (target > step) {
      const fields = STEP_FIELDS[step] ?? [];
      let ok = fields.length === 0 ? true : await form.trigger(fields as never, { shouldFocus: true });
      if (ok && step === 1 && !uploadNotice) {
        ok = false;
        setUploadNoticeError(true);
      }
      if (!ok) {
        void shake.start({ x: [0, -7, 7, -5, 5, -2, 0], transition: { duration: 0.42 } });
        feedback("error");
        return;
      }
      feedback("tap");
    }
    setDirection(target > step ? 1 : -1);
    setStep(target);
  };

  if (setup.phase === "review" && setup.created) {
    return <FundingReview setup={setup} />;
  }

  const last = step === WIZARD_STEPS.length - 1;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        if (!last) {
          event.preventDefault();
          void go(step + 1);
          return;
        }
        void setup.submit(event);
      }}
      className={cn(variant === "page" && "grid gap-6 lg:grid-cols-[minmax(0,760px)_300px] lg:items-start")}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Stepper step={step} onJump={(index) => void go(index)} />
          </div>
        </div>
        <div className="mt-3 flex min-h-5 items-center justify-between gap-3">
          <SaveIndicator state={setup.saveState} />
          {setup.restored ? (
            <button
              type="button"
              onClick={() => {
                setup.clearDraft();
                setStep(0);
              }}
              className="text-[12px] text-[var(--foreground-muted)] underline-offset-4 hover:text-[var(--foreground)] hover:underline"
            >
              Start over
            </button>
          ) : null}
        </div>

        <div className="relative mt-4 overflow-x-clip">
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.section
              key={step}
              custom={direction}
              variants={{
                enter: (dir: number) => ({ opacity: 0, x: dir * 24 }),
                center: { opacity: 1, x: 0 },
                exit: (dir: number) => ({ opacity: 0, x: dir * -24 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: duration.base, ease }}
              className="workspace-panel p-5 sm:p-6"
            >
              <motion.div animate={shake}>
                {step === 0 ? (
                  <div className="space-y-5">
                    <StepHeading
                      title="What should the agents do?"
                      body="The name and objective help agents choose a service. They never grant spending authority."
                    />
                    <Field label="Task name" htmlFor="name" error={errors.name?.message}>
                      <Input
                        id="name"
                        autoFocus={variant === "page"}
                        placeholder="Supplier comparison — Q4"
                        {...form.register("name")}
                        aria-invalid={Boolean(errors.name)}
                        aria-describedby="name-public"
                      />
                    </Field>
                    <p id="name-public" className="-mt-3 flex items-start gap-2 rounded-[8px] bg-[var(--info-background)] px-3 py-2 text-[12px] leading-5 text-[var(--info)]">
                      <Globe className="mt-0.5 size-3.5 shrink-0" />
                      The task name is written on the NEAR blockchain, where it is public and permanent. Don’t include names,
                      personal details or anything confidential.
                    </p>
                    <Field
                      label="Objective"
                      htmlFor="objective"
                      hint={`${(values.objective ?? "").length}/280 · Plain language. Agents read this next to the untrusted documents.`}
                      error={errors.objective?.message}
                    >
                      <Textarea id="objective" rows={3} className="min-h-[96px]" {...form.register("objective")} aria-invalid={Boolean(errors.objective)} />
                    </Field>
                  </div>
                ) : null}

                {step === 1 ? (
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <StepHeading
                        title="What will they read?"
                        body="Up to two short text documents. They’re encrypted at rest and never posted on chain."
                      />
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" size="sm" variant="secondary" onClick={() => setup.loadSamples(false)}>
                          <Sparkles /> Load samples
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setup.loadSamples(true)}>
                          Load adversarial fixture
                        </Button>
                      </div>
                    </div>
                    <div
                      className={cn(
                        "mt-4 rounded-[10px] border p-3.5 text-[12px] leading-5 transition-colors",
                        uploadNoticeError ? "border-[var(--danger)]/40 bg-[var(--danger-background)]" : "border-[var(--border)] bg-[var(--surface-muted)]",
                      )}
                    >
                      <p className="font-medium text-[var(--foreground)]">Where your documents go</p>
                      <p className="mt-1 text-[var(--foreground-secondary)]">
                        Documents are encrypted at rest in PoolGuard’s database, then sent to the AI model
                        {meta?.aiPrivateInference ? " (inside NEAR AI Cloud’s enclave)" : ""} and to the extraction provider so the agents
                        can work. They are never written on chain. You can delete them later in Settings.
                      </p>
                      <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-[var(--foreground)]">
                        <input
                          type="checkbox"
                          checked={uploadNotice}
                          onChange={(event) => acceptUploadNotice(event.target.checked)}
                          className="mt-0.5 size-4 shrink-0 accent-[var(--action)]"
                        />
                        I won’t upload personal, sensitive or confidential information, or anything I’m not allowed to share.
                      </label>
                      {uploadNoticeError ? (
                        <p role="alert" className="mt-1.5 text-[var(--danger)]">Please confirm this before continuing.</p>
                      ) : null}
                    </div>
                    <div className="mt-4 space-y-4">
                      <AnimatePresence initial={false}>
                        {documents.fields.map((field, index) => {
                          const docErrors = errors.documents?.[index];
                          return (
                            <motion.div
                              key={field.id}
                              layout
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: duration.base, ease }}
                              className="overflow-hidden"
                            >
                              <div className="rounded-[10px] border border-[var(--border)] p-4">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[12px] font-medium text-[var(--foreground-secondary)]">Document {index + 1}</p>
                                  <div className="flex items-center gap-1">
                                    <FileButton
                                      onLoad={(text, filename) => {
                                        if (!text) {
                                          form.setError(`documents.${index}.text`, {
                                            message: "File is larger than 80 KB. Paste a shorter excerpt.",
                                          });
                                          return;
                                        }
                                        form.setValue(`documents.${index}.text`, text, { shouldValidate: true });
                                        form.setValue(`documents.${index}.label`, filename.replace(/\.(txt|md)$/i, ""), { shouldValidate: true });
                                      }}
                                    />
                                    {documents.fields.length > 1 ? (
                                      <Button
                                        type="button"
                                        size="icon-sm"
                                        variant="ghost"
                                        aria-label={`Remove document ${index + 1}`}
                                        onClick={() => documents.remove(index)}
                                      >
                                        <Trash2 />
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="mt-3 space-y-3">
                                  <Field label="Label" htmlFor={`document-label-${index}`} error={docErrors?.label?.message}>
                                    <Input
                                      id={`document-label-${index}`}
                                      placeholder="Supplier A — quotation"
                                      {...form.register(`documents.${index}.label`)}
                                      aria-invalid={Boolean(docErrors?.label)}
                                    />
                                  </Field>
                                  <Field label="Document text" htmlFor={`document-text-${index}`} error={docErrors?.text?.message}>
                                    <Textarea
                                      id={`document-text-${index}`}
                                      rows={8}
                                      className="min-h-[170px] font-mono text-[12px] leading-5"
                                      placeholder="Paste the supplier quotation text here."
                                      {...form.register(`documents.${index}.text`)}
                                      aria-invalid={Boolean(docErrors?.text)}
                                    />
                                  </Field>
                                </div>
                              </div>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                      {documents.fields.length < 2 ? (
                        <Button type="button" size="sm" variant="secondary" onClick={() => documents.append({ label: "", text: "" })}>
                          <Plus /> Add second document
                        </Button>
                      ) : null}
                      <p className="flex items-start gap-2 text-[11px] leading-5 text-[var(--foreground-muted)]">
                        <FileText className="mt-0.5 size-3.5 shrink-0" />
                        Fixtures are labelled demonstration inputs. The paid service extracts structured fields; it does not pay the supplier.
                      </p>
                    </div>
                  </div>
                ) : null}

                {step === 2 ? (
                  <div className="space-y-5">
                    <StepHeading
                      title="How much can they spend?"
                      body="One shared pool. The contract rejects any reservation over the remaining balance or the per-purchase limit."
                    />
                    <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Budget presets">
                      {BUDGET_PRESETS.map((preset) => {
                        const active = values.budget_near === preset.budget && values.max_per_operation_near === preset.limit;
                        return (
                          <motion.button
                            key={preset.id}
                            type="button"
                            whileTap={{ scale: 0.97 }}
                            transition={spring.snappy}
                            aria-pressed={active}
                            onClick={() => {
                              form.setValue("budget_near", preset.budget, { shouldValidate: true, shouldDirty: true });
                              form.setValue("max_per_operation_near", preset.limit, { shouldValidate: true, shouldDirty: true });
                              feedback("select");
                            }}
                            className={cn(
                              "relative rounded-[10px] border p-3 text-left transition-colors duration-150",
                              active ? "border-[var(--action)] bg-[var(--action-soft)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]",
                            )}
                          >
                            {active ? (
                              <motion.span layoutId="preset-ring" className="absolute inset-0 rounded-[10px] ring-2 ring-[var(--action)]" transition={spring.glide} />
                            ) : null}
                            <span className="relative block text-[13px] font-medium">{preset.label}</span>
                            <span className="financial-value relative mt-0.5 block text-[12px] text-[var(--foreground-secondary)]">
                              {preset.budget} · max {preset.limit}
                            </span>
                            <span className="relative mt-1 block text-[11px] text-[var(--foreground-muted)]">{preset.note}</span>
                          </motion.button>
                        );
                      })}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Task budget (testNEAR)" htmlFor="budget" hint="Exact decimal, never rounded." error={errors.budget_near?.message}>
                        <Input id="budget" inputMode="decimal" placeholder="0.03" {...form.register("budget_near")} aria-invalid={Boolean(errors.budget_near)} />
                      </Field>
                      <Field label="Per-purchase limit (testNEAR)" htmlFor="limit" hint="Must be ≤ the task budget." error={errors.max_per_operation_near?.message}>
                        <Input id="limit" inputMode="decimal" placeholder="0.02" {...form.register("max_per_operation_near")} aria-invalid={Boolean(errors.max_per_operation_near)} />
                      </Field>
                    </div>
                    <PoolPreview budget={values.budget_near ?? ""} limit={values.max_per_operation_near ?? ""} />
                    <details className="group rounded-[10px] border border-[var(--border)] px-4 py-3">
                      <summary className="cursor-pointer list-none text-[13px] font-medium marker:hidden">
                        <span className="inline-flex items-center gap-2">
                          <ArrowRight className="size-3.5 transition-transform duration-200 group-open:rotate-90" /> Timing (advanced)
                        </span>
                      </summary>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <Field label="Reservation lifetime (blocks)" htmlFor="ttl" hint="About 1 block per second. A payout must start before this runs out." error={errors.reservation_ttl_blocks?.message}>
                          <Input id="ttl" type="number" min={10} max={10000} {...form.register("reservation_ttl_blocks", { valueAsNumber: true })} />
                        </Field>
                        <Field label="Task expiry (blocks from now)" htmlFor="expiry" hint="After this, no new reservations or payments." error={errors.expires_in_blocks?.message}>
                          <Input id="expiry" type="number" min={100} max={1000000} {...form.register("expires_in_blocks", { valueAsNumber: true })} />
                        </Field>
                      </div>
                    </details>
                  </div>
                ) : null}

                {step === 3 ? (
                  <div className="space-y-5">
                    <StepHeading
                      title="Review before funding"
                      body="This is written to the contract in one owner transaction. Workers can’t change any of it later."
                    />
                    <dl className="divide-y divide-[var(--border)] rounded-[10px] border border-[var(--border)]">
                      <ReviewRow label="Task" value={values.name || "—"} onEdit={() => void go(0)} />
                      <ReviewRow
                        label="Documents"
                        value={(values.documents ?? []).map((doc) => doc?.label || "Untitled").join(", ") || "—"}
                        onEdit={() => void go(1)}
                      />
                      <ReviewRow label="Budget" value={`${values.budget_near || "—"} testNEAR`} mono onEdit={() => void go(2)} />
                      <ReviewRow label="Per purchase" value={`${values.max_per_operation_near || "—"} testNEAR`} mono onEdit={() => void go(2)} />
                      <ReviewRow
                        label="Setup storage"
                        value={setup.storageTotal ? `${near(setup.storageTotal)} testNEAR · non-refundable` : "Loading…"}
                        mono
                      />
                    </dl>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-muted)] p-3.5">
                        <p className="text-[12px] font-medium">Approved provider</p>
                        <p className="mono mt-1 truncate text-[11px] text-[var(--foreground-secondary)]">{meta?.providerAccountId ?? "Loading…"}</p>
                      </div>
                      {(meta?.workerAccounts ?? []).map((worker) => (
                        <div key={worker.accountId} className="rounded-[10px] border border-[var(--border)] p-3.5">
                          <p className="text-[12px] font-medium">Agent {worker.slot}</p>
                          <p className="mono mt-1 truncate text-[11px] text-[var(--foreground-secondary)]">{worker.accountId}</p>
                        </div>
                      ))}
                    </div>
                    <FundingExplainer storageTotal={setup.storageTotal} budget={values.budget_near ?? ""} sandbox={Boolean(meta?.sandbox)} />
                    {custodyOutlayer ? (
                      <div className="rounded-[10px] border border-[var(--border)] p-3.5 text-[12px] leading-5 text-[var(--foreground-secondary)]">
                        <p className="flex items-center gap-1.5 font-medium text-[var(--foreground)]">
                          <LockKeyhole className="size-3.5 text-[var(--action)]" /> Agent keys are held by a third party
                        </p>
                        <p className="mt-1">
                          This deployment keeps the agents’ signing keys in OutLayer’s secure enclave, not on PoolGuard’s servers.
                          OutLayer checks its own spending policy before signing. If OutLayer is unavailable, agents can’t sign
                          until it returns; nothing is paid twice, and your task funds stay in the contract under your control.
                        </p>
                      </div>
                    ) : (
                      <p className="text-[11px] leading-5 text-[var(--foreground-muted)]">
                        Worker keys are restricted function-call keys. Their allowance limits gas only; the contract policy limits spending.
                      </p>
                    )}
                  </div>
                ) : null}
              </motion.div>
            </motion.section>
          </AnimatePresence>
        </div>

        <AnimatePresence initial={false}>
          {setup.submitError ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div role="alert" className="mt-4 flex items-start gap-2 rounded-[8px] bg-[var(--danger-background)] px-3 py-2 text-[12px] leading-5 text-[var(--danger)]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {setup.submitError}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {step === 0 ? (
            <Button type="button" variant="ghost" asChild>
              <Link href={cancelHref}>Cancel</Link>
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={() => void go(step - 1)}>
              <ArrowLeft /> Back
            </Button>
          )}
          {last ? (
            <Button type="submit" variant="action" loading={setup.create.isPending} size="lg">
              {setup.create.isPending ? (meta?.sandbox ? "Creating and funding…" : "Creating…") : "Review and fund task"}
            </Button>
          ) : (
            <Button type="submit" variant="action" size="lg">
              Continue <ArrowRight />
            </Button>
          )}
        </div>
      </div>

      {variant === "page" ? <SummaryAside setup={setup} /> : null}
    </form>
  );
}

function StepHeading({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="text-[18px] font-semibold tracking-[-0.01em]">{title}</h2>
      <p className="mt-1 max-w-xl text-[13px] leading-5 text-[var(--foreground-secondary)]">{body}</p>
    </div>
  );
}

function ReviewRow({ label, value, mono, onEdit }: { label: string; value: string; mono?: boolean; onEdit?: () => void }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3 text-[13px]">
      <dt className="shrink-0 text-[var(--foreground-secondary)]">{label}</dt>
      <dd className="flex min-w-0 items-baseline gap-3">
        <span className={cn("truncate text-right", mono && "financial-value")}>{value}</span>
        {onEdit ? (
          <button type="button" onClick={onEdit} className="shrink-0 text-[12px] text-[var(--action)] hover:text-[var(--action-hover)] hover:underline">
            Edit
          </button>
        ) : null}
      </dd>
    </div>
  );
}

function SummaryAside({ setup }: { setup: TaskSetup }) {
  const { values, meta } = setup;
  const rows: Array<[string, string]> = [
    ["Budget", `${values.budget_near || "—"} testNEAR`],
    ["Per purchase", `${values.max_per_operation_near || "—"} testNEAR`],
    ["Reservation", `${values.reservation_ttl_blocks || "—"} blocks`],
    ["Expiry", `${values.expires_in_blocks || "—"} blocks`],
  ];
  return (
    <aside className="workspace-panel sticky top-24 hidden p-5 lg:block">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold">Summary</h2>
        <NetworkBadge network={meta?.network} sandbox={meta?.sandbox} />
      </div>
      <dl className="mt-4 space-y-3 text-[12px]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-[var(--foreground-muted)]">{label}</dt>
            <dd className="financial-value relative h-4 overflow-hidden font-medium">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={value}
                  className="block"
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -10, opacity: 0 }}
                  transition={{ duration: duration.fast, ease }}
                >
                  {value}
                </motion.span>
              </AnimatePresence>
            </dd>
          </div>
        ))}
        <div className="border-t border-[var(--border)] pt-3">
          <dt className="text-[var(--foreground-muted)]">Setup storage</dt>
          <dd className="financial-value mt-1 font-medium">{setup.storageTotal ? `${near(setup.storageTotal)} testNEAR` : "Loading…"}</dd>
          <dd className="mt-1 text-[10px] leading-4 text-[var(--foreground-muted)]">Separate from the budget and non-refundable in this MVP.</dd>
        </div>
      </dl>
      <p className="mt-4 text-[10px] leading-4 text-[var(--foreground-muted)]">{meta?.contractId ? `Contract ${meta.contractId}` : "Contract loading"}</p>
    </aside>
  );
}

/** Owner wallet handoff for a created draft (testnet), or a sandbox retry. */
export function FundingReview({ setup }: { setup: TaskSetup }) {
  const { plan, meta, created } = setup;
  if (!created) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: duration.slow, ease }} className="mx-auto max-w-[760px] space-y-6">
      <div className="workspace-panel p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--warning-background)] text-[var(--warning)]">
            <Wallet className="size-4" />
          </span>
          <div>
            <h2 className="text-[16px] font-semibold">Approve “{created.name}” in your wallet</h2>
            <p className="mt-1 text-[13px] leading-5 text-[var(--foreground-secondary)]">
              One wallet approval creates the task, funds the pool and registers both agents. PoolGuard can’t fund it for you.
            </p>
          </div>
        </div>

        {plan.isLoading ? (
          <div className="mt-5 space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : plan.error ? (
          <div className="mt-4 rounded-[8px] bg-[var(--danger-background)] p-3 text-[13px] text-[var(--danger)]">
            {plan.error instanceof ApiError ? plan.error.message : "Could not build the setup plan."}
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => void plan.refetch()}>
              Retry
            </Button>
          </div>
        ) : plan.data ? (
          <>
            <dl className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
              <Row label="Network" value={meta?.network === "sandbox" ? "Local sandbox" : "NEAR testnet"} />
              <Row label="Budget funding" value={`${near(plan.data.summary?.budgetFundingYocto)} testNEAR`} />
              <Row
                label="Storage deposits (non-refundable)"
                value={`${near(plan.data.summary?.storageDepositYocto)} + 2 × ${near(plan.data.summary?.perAgentDepositYocto)}`}
              />
              <Row label="Total attached to the transaction" value={`${near(plan.data.total_deposit_yocto)} testNEAR`} strong />
            </dl>
            <ol className="mt-4 space-y-1.5">
              {plan.data.actions.map((action, index) => (
                <motion.li
                  key={action.method_name}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 * index, duration: duration.base, ease }}
                  className="flex items-baseline justify-between gap-3 text-[12px]"
                >
                  <span className="mono">{action.method_name}</span>
                  <span className="financial-value text-[var(--foreground-muted)]">{near(action.deposit_yocto)} testNEAR</span>
                </motion.li>
              ))}
            </ol>
            <p className="mt-4 rounded-[8px] bg-[var(--surface-muted)] px-3 py-2 text-[11px] leading-5 text-[var(--foreground-secondary)]">
              Closing the wallet dialog is not proof the transaction failed. If you’re unsure, reopen the draft task — PoolGuard checks the chain before anything else.
            </p>
            {meta?.sandbox ? (
              <Button className="mt-5 w-full sm:w-auto" onClick={() => setup.sandboxFund.mutate()} loading={setup.sandboxFund.isPending}>
                <ShieldCheck /> Fund sandbox task
              </Button>
            ) : (
              <Button className="mt-5 w-full sm:w-auto" variant="action" size="lg" onClick={() => setup.fund.mutate()} loading={setup.fund.isPending}>
                <Wallet /> {setup.fund.isPending ? "Waiting for your wallet…" : "Approve in wallet"}
              </Button>
            )}
          </>
        ) : null}

        <AnimatePresence initial={false}>
          {setup.submitError ? (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div role="alert" className="mt-4 flex items-start gap-2 rounded-[8px] bg-[var(--danger-background)] px-3 py-2 text-[12px] leading-5 text-[var(--danger)]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {setup.submitError}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" asChild>
          <Link href={`/app/tasks/${created.id}`}>
            <ArrowLeft /> Open draft task
          </Link>
        </Button>
        <Button variant="ghost" onClick={setup.backToForm}>
          Back to form
        </Button>
      </div>
    </motion.div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-3 text-[13px]", strong && "font-medium")}>
      <dt className={strong ? undefined : "text-[var(--foreground-secondary)]"}>{label}</dt>
      <dd className="financial-value text-right">{value}</dd>
    </div>
  );
}
