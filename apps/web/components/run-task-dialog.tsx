"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bot, FlaskConical, Play } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, near } from "@/lib/utils";
import type { RunResponse, Task } from "@/lib/types";

export function RunTaskDialog({
  task,
  open,
  onOpenChange,
}: {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { meta } = useAuth();
  const queryClient = useQueryClient();
  const [mode, setMode] = React.useState<"live" | "scripted">(meta?.aiConfigured ? "live" : "scripted");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!meta?.aiConfigured) setMode("scripted");
  }, [meta?.aiConfigured]);

  const start = useMutation({
    mutationFn: () =>
      api<RunResponse>(`/tasks/${task.id}/runs`, {
        method: "POST",
        body: JSON.stringify({ mode, scenario: null }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["task", task.id] });
      await queryClient.invalidateQueries({ queryKey: ["task-events", task.id] });
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
      onOpenChange(false);
      const { toast } = await import("sonner");
      toast.success("Run queued", {
        description: "Two agent jobs were committed to the durable queue.",
      });
    },
    onError: (mutationError) => {
      setError(mutationError instanceof ApiError ? mutationError.message : "The run could not be started.");
    },
  });

  const blocked =
    task.status !== "active" ||
    task.budget.availableYocto === "0" ||
    task.agents.every((agent) => agent.status !== "registered");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run task</DialogTitle>
          <DialogDescription>
            Both registered workers claim separate jobs. Each reserves from the same shared budget
            before buying its assigned document extraction.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="text-[var(--foreground-muted)]">Available</span>
              <span className="financial-value font-medium">{near(task.budget.availableYocto)} testNEAR</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3 text-[12px]">
              <span className="text-[var(--foreground-muted)]">Per purchase limit</span>
              <span className="financial-value">{near(task.policy.maxPerOperationYocto)} testNEAR</span>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={!meta?.aiConfigured}
              onClick={() => setMode("live")}
              className={cn(
                "rounded-[10px] border p-3.5 text-left transition-colors",
                mode === "live"
                  ? "border-[var(--primary)] bg-[var(--surface-hover)]"
                  : "border-[var(--border)] hover:bg-[var(--surface-hover)]",
                !meta?.aiConfigured && "cursor-not-allowed opacity-50",
              )}
              aria-pressed={mode === "live"}
            >
              <Bot className="size-4" />
              <p className="mt-2 text-[13px] font-medium">Live agents</p>
              <p className="mt-1 text-[11px] leading-4 text-[var(--foreground-secondary)]">
                {meta?.aiConfigured
                  ? meta.aiPrivateInference
                    ? `Private inference on NEAR AI Cloud (TEE) · ${meta.aiModel} · every response signature is verified`
                    : `OpenAI-compatible model · ${meta.aiModel}`
                  : "Unavailable: AI_API_KEY is not configured."}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setMode("scripted")}
              className={cn(
                "rounded-[10px] border p-3.5 text-left transition-colors",
                mode === "scripted"
                  ? "border-[var(--primary)] bg-[var(--surface-hover)]"
                  : "border-[var(--border)] hover:bg-[var(--surface-hover)]",
              )}
              aria-pressed={mode === "scripted"}
            >
              <FlaskConical className="size-4" />
              <p className="mt-2 text-[13px] font-medium">Scripted fixture</p>
              <p className="mt-1 text-[11px] leading-4 text-[var(--foreground-secondary)]">
                No model. Real contract, provider and accounting. Clearly labelled.
              </p>
            </button>
          </div>

          {blocked ? (
            <div className="flex items-start gap-2 rounded-[8px] bg-[var(--warning-background)] px-3 py-2 text-[12px] leading-5 text-[var(--warning)]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {task.status !== "active"
                  ? "The task is not active. Fund a draft task or resume a paused one first."
                  : "No available budget or no registered agents."}
              </span>
            </div>
          ) : null}

          <p className="text-[11px] leading-5 text-[var(--foreground-muted)]">
            Model inference is billed to the API operator separately. PoolGuard only enforces the
            on-chain purchases routed through its contract.
          </p>
          {error ? <p className="text-[12px] text-[var(--danger)]">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => start.mutate()} loading={start.isPending} disabled={blocked}>
            <Play /> Start run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
