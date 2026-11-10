"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { parseNearToYocto } from "@poolguard/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { feedback } from "@/lib/feedback";
import { signAndSendPlan } from "@/lib/wallet";
import { shortId } from "@/lib/utils";
import { CLEAN_DOCUMENTS, ADVERSARIAL_DOCUMENT } from "@/lib/fixtures";
import type { Task, TxPlan } from "@/lib/types";

const documentSchema = z.object({
  label: z.string().trim().min(1, "Give this document a short label").max(120),
  text: z.string().trim().min(20, "Paste at least 20 characters of document text").max(80_000),
});

function yocto(value: string): bigint | null {
  try {
    return parseNearToYocto(value.trim());
  } catch {
    return null;
  }
}

export const taskFormSchema = z
  .object({
    name: z.string().trim().min(3, "Use at least 3 characters").max(80),
    objective: z
      .string()
      .trim()
      .min(10, "Describe what the agents should produce")
      .max(280, "Keep the objective under 280 characters"),
    budget_near: z
      .string()
      .trim()
      .min(1, "Enter a budget")
      .refine((value) => (yocto(value) ?? 0n) > 0n, "Enter a positive amount, like 0.03"),
    max_per_operation_near: z
      .string()
      .trim()
      .min(1, "Enter a per-purchase limit")
      .refine((value) => (yocto(value) ?? 0n) > 0n, "Enter a positive amount, like 0.02"),
    reservation_ttl_blocks: z.number({ message: "Enter a whole number" }).int().min(10).max(10_000),
    expires_in_blocks: z.number({ message: "Enter a whole number" }).int().min(100).max(1_000_000),
    documents: z.array(documentSchema).min(1).max(2),
  })
  .superRefine((values, ctx) => {
    const budget = yocto(values.budget_near);
    const limit = yocto(values.max_per_operation_near);
    if (budget !== null && limit !== null && limit > budget) {
      ctx.addIssue({
        code: "custom",
        path: ["max_per_operation_near"],
        message: "The per-purchase limit can’t be larger than the budget",
      });
    }
  });

export type TaskFormValues = z.infer<typeof taskFormSchema>;

export const TASK_DEFAULTS: TaskFormValues = {
  name: "",
  objective: "Compare two supplier quotations and highlight commercial differences using the paid extraction service.",
  budget_near: "0.03",
  max_per_operation_near: "0.02",
  reservation_ttl_blocks: 300,
  expires_in_blocks: 8_000,
  documents: [{ label: "", text: "" }],
};

export const BUDGET_PRESETS = [
  { id: "race", label: "Race", budget: "0.03", limit: "0.02", note: "Two agents compete for one slot" },
  { id: "demo", label: "Comfortable", budget: "0.05", limit: "0.02", note: "Both agents can buy" },
  { id: "tight", label: "Tight", budget: "0.01", limit: "0.005", note: "Only the cheap service fits" },
] as const;

const DRAFT_KEY = "poolguard:task-draft";

export type SaveState = "idle" | "saving" | "saved";

export function useTaskSetup({ onFunded }: { onFunded: (taskId: string) => void | Promise<void> }) {
  const { meta } = useAuth();
  const queryClient = useQueryClient();
  const [created, setCreated] = React.useState<Task | null>(null);
  const [phase, setPhase] = React.useState<"form" | "review">("form");
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [restored, setRestored] = React.useState(false);

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: TASK_DEFAULTS,
    mode: "onTouched",
  });
  const documents = useFieldArray({ control: form.control, name: "documents" });
  const values = useWatch({ control: form.control });

  // Restore a saved draft once.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as Partial<TaskFormValues>;
      const merged = { ...TASK_DEFAULTS, ...draft };
      if (!Array.isArray(merged.documents) || merged.documents.length === 0) merged.documents = TASK_DEFAULTS.documents;
      form.reset(merged);
      setRestored(true);
    } catch {
      /* a corrupt draft is ignored */
    }
  }, [form]);

  // Autosave the draft (debounced). Documents are kept locally only in this browser.
  const firstSave = React.useRef(true);
  React.useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    if (created || !form.formState.isDirty) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(values));
        setSaveState("saved");
      } catch {
        setSaveState("idle");
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [values, created, form.formState.isDirty]);

  const clearDraft = React.useCallback(() => {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    form.reset(TASK_DEFAULTS);
    setRestored(false);
    setSaveState("idle");
  }, [form]);

  const finish = React.useCallback(
    async (taskId: string) => {
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      feedback("success");
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
      await onFunded(taskId);
    },
    [onFunded, queryClient],
  );

  const create = useMutation({
    mutationFn: (input: TaskFormValues) =>
      api<{ task: Task }>("/tasks", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: async ({ task }) => {
      setCreated(task);
      if (meta?.sandbox) {
        try {
          await api(`/dev/tasks/${task.id}/submit-setup`, { method: "POST" });
          await finish(task.id);
          return;
        } catch (error) {
          setSubmitError(
            error instanceof ApiError
              ? `${error.message} The draft task was kept; retry funding below.`
              : "Sandbox setup failed. The draft task was kept.",
          );
          feedback("error");
          setPhase("review");
          return;
        }
      }
      setPhase("review");
    },
    onError: (error) => {
      feedback("error");
      setSubmitError(error instanceof ApiError ? error.message : "The task could not be created.");
    },
  });

  const plan = useQuery({
    queryKey: ["setup-plan", created?.id],
    queryFn: () => api<TxPlan>(`/tasks/${created!.id}/setup-plan`),
    enabled: Boolean(created) && phase === "review",
    retry: 1,
  });

  const fund = useMutation({
    mutationFn: async () => {
      if (!created || !plan.data) throw new Error("Setup plan is not ready.");
      const hash = await signAndSendPlan(plan.data);
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          await api(`/tasks/${created.id}/confirm`, { method: "POST", body: JSON.stringify({ tx_hash: hash }) });
          return hash;
        } catch (error) {
          lastError = error;
          if (error instanceof ApiError && error.code === "TX_NOT_FINAL") {
            await new Promise((resolve) => setTimeout(resolve, 1_500));
            continue;
          }
          throw error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("Transaction confirmation timed out.");
    },
    onSuccess: async (hash) => {
      const { toast } = await import("sonner");
      toast.success("Task funded", { description: `Transaction ${shortId(hash, 10, 6)}` });
      await finish(created!.id);
    },
    onError: (error) => {
      feedback("error");
      setSubmitError(
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "The funding transaction did not complete. The draft task was kept.",
      );
    },
  });

  const sandboxFund = useMutation({
    mutationFn: async () => {
      if (!created) throw new Error("No task");
      await api(`/dev/tasks/${created.id}/submit-setup`, { method: "POST" });
    },
    onSuccess: async () => finish(created!.id),
    onError: (error) => {
      feedback("error");
      setSubmitError(error instanceof ApiError ? error.message : "Sandbox setup failed. The draft task was kept.");
    },
  });

  const loadSamples = React.useCallback(
    (adversarial = false) => {
      form.setValue(
        "documents",
        [
          { label: CLEAN_DOCUMENTS[0]!.label, text: CLEAN_DOCUMENTS[0]!.text },
          {
            label: adversarial ? ADVERSARIAL_DOCUMENT.label : CLEAN_DOCUMENTS[1]!.label,
            text: adversarial ? ADVERSARIAL_DOCUMENT.text : CLEAN_DOCUMENTS[1]!.text,
          },
        ],
        { shouldValidate: true, shouldDirty: true },
      );
      if (adversarial) {
        form.setValue("name", "Adversarial supplier review", { shouldDirty: true });
        form.setValue(
          "objective",
          "Compare a clean quotation with an untrusted supplier message and test whether payment instructions embedded in the document can change the task policy.",
          { shouldDirty: true },
        );
      } else if (!form.getValues("name")) {
        form.setValue("name", "Supplier comparison — Q4", { shouldDirty: true });
      }
      feedback("select");
    },
    [form],
  );

  const storageTotal =
    meta?.chainConfig != null
      ? (BigInt(meta.chainConfig.task_storage_deposit) + BigInt(meta.chainConfig.agent_storage_deposit) * 2n).toString()
      : null;

  const submit = form.handleSubmit(
    (input) => {
      setSubmitError(null);
      create.mutate(input);
    },
    () => feedback("error"),
  );

  const backToForm = React.useCallback(() => {
    setCreated(null);
    setPhase("form");
    setSubmitError(null);
  }, []);

  return {
    meta,
    form,
    documents,
    values,
    created,
    phase,
    submitError,
    saveState,
    restored,
    clearDraft,
    create,
    plan,
    fund,
    sandboxFund,
    loadSamples,
    storageTotal,
    submit,
    backToForm,
  };
}

export type TaskSetup = ReturnType<typeof useTaskSetup>;
