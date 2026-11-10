"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { signAndSendPlan } from "@/lib/wallet";
import type { Task, TxPlan } from "@/lib/types";

export type TaskAction =
  | { action: "pause" | "resume" }
  | { action: "fund" | "withdraw"; amount_near: string }
  | { action: "revoke_agent"; agent_account_id: string };

async function confirmWithRetry(taskId: string, txHash: string, input: TaskAction) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await api<Task>(`/tasks/${taskId}/actions/confirm`, {
        method: "POST",
        body: JSON.stringify({
          tx_hash: txHash,
          action: input.action,
          agent_account_id: input.action === "revoke_agent" ? input.agent_account_id : undefined,
        }),
      });
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
}

export function useTaskAction(taskId: string) {
  const { meta } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TaskAction) => {
      if (meta?.sandbox) {
        return api<Task>(`/dev/tasks/${taskId}/actions`, {
          method: "POST",
          body: JSON.stringify(input),
        });
      }
      const plan = await api<TxPlan>(`/tasks/${taskId}/actions/plan`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      const txHash = await signAndSendPlan(plan);
      return confirmWithRetry(taskId, txHash, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
      await queryClient.invalidateQueries({ queryKey: ["task-events", taskId] });
    },
  });
}
