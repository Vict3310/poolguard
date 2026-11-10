"use client";

import * as React from "react";
import { parseNearToYocto } from "@poolguard/shared";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Pause, Play, ShieldOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HoldButton } from "@/components/ui/hold-button";
import { Input, Label } from "@/components/ui/input";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CopyButton } from "@/components/copy-button";
import { useTaskAction } from "@/lib/use-task-action";
import { near, shortId } from "@/lib/utils";
import type { Task } from "@/lib/types";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
      <dt className="text-[12px] text-[var(--foreground-muted)]">{label}</dt>
      <dd className="max-w-[70%] text-right text-[12px] text-[var(--foreground)]">{children}</dd>
    </div>
  );
}

export function TaskPolicy({ task }: { task: Task }) {
  const action = useTaskAction(task.id);
  const [dialog, setDialog] = React.useState<"fund" | "withdraw" | "revoke" | null>(null);
  const [amount, setAmount] = React.useState("");
  const [agentToRevoke, setAgentToRevoke] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const close = () => {
    setDialog(null);
    setError(null);
    setAmount("");
    setAgentToRevoke(null);
  };

  const run = async (input: Parameters<typeof action.mutate>[0], success: string) => {
    setError(null);
    setNotice(null);
    try {
      await action.mutateAsync(input);
      setNotice(success);
      close();
      const { toast } = await import("sonner");
      toast.success(success);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Action failed.");
    }
  };

  const validateAmount = (): string | null => {
    try {
      const value = parseNearToYocto(amount);
      if (value <= 0n) return "Amount must be positive.";
      return null;
    } catch (parseError) {
      return parseError instanceof Error ? parseError.message : "Enter a decimal testNEAR amount.";
    }
  };

  return (
    <section id="policy" className="workspace-panel overflow-hidden scroll-mt-24">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-[16px] font-semibold">Policy and access</h2>
          <p className="mt-0.5 text-[12px] text-[var(--foreground-muted)]">
            Written to the contract. The backend cannot change these values.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setDialog("fund")}
          >
            <ArrowUpFromLine /> Fund
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDialog("withdraw")}>
            <ArrowDownToLine /> Withdraw
          </Button>
          {task.paused ? (
            <Button
              size="sm"
              onClick={() => void run({ action: "resume" }, "Task resumed")}
              loading={action.isPending && action.variables?.action === "resume"}
            >
              <Play /> Resume
            </Button>
          ) : (
            <HoldButton
              hint="Hold to pause all agents"
              onConfirm={() => void run({ action: "pause" }, "Task paused")}
              loading={action.isPending && action.variables?.action === "pause"}
            >
              <Pause /> Hold to pause
            </HoldButton>
          )}
        </div>
      </div>

      {error && dialog === null ? (
        <div className="flex items-start gap-2 border-t border-[var(--border)] bg-[var(--danger-background)] px-5 py-2.5 text-[12px] text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {error}
        </div>
      ) : null}
      {notice ? (
        <div className="border-t border-[var(--border)] bg-[var(--success-background)] px-5 py-2.5 text-[12px] text-[var(--success)]">
          {notice}
        </div>
      ) : null}

      <dl className="divide-y divide-[var(--border)] border-t border-[var(--border)] px-5">
        <Row label="Owner account">
          <span className="mono inline-flex items-center gap-1 text-[11px]">
            {shortId(task.ownerAccountId, 16, 8)} <CopyButton value={task.ownerAccountId} label="Copy owner" />
          </span>
        </Row>
        <Row label="Policy version">{task.policy.version}</Row>
        <Row label="Per-purchase limit">
          <span className="financial-value">{near(task.policy.maxPerOperationYocto)} testNEAR</span>
        </Row>
        <Row label="Reservation lifetime">{task.policy.reservationTtlBlocks.toLocaleString()} blocks</Row>
        <Row label="Task expiry block">{task.policy.expiresAtBlock.toLocaleString()}</Row>
        <Row label="Allowed providers">
          <div className="flex flex-col items-end gap-1">
            {task.policy.allowedProviders.map((provider) => (
              <span key={provider} className="mono inline-flex items-center gap-1 text-[11px]">
                {shortId(provider, 18, 8)} <CopyButton value={provider} label="Copy provider" />
              </span>
            ))}
          </div>
        </Row>
        <Row label="Accounting invariant">
          {task.budget.invariantHolds === true ? (
            <span className="inline-flex items-center gap-1 text-[var(--success)]">
              <ShieldCheck className="size-3" /> Conserved on chain
            </span>
          ) : task.budget.invariantHolds === false ? (
            <span className="text-[var(--danger)]">Mismatch — investigate</span>
          ) : (
            <span className="text-[var(--foreground-muted)]">Not available from cache</span>
          )}
        </Row>
      </dl>

      <div className="border-t border-[var(--border)] px-5 py-4">
        <h3 className="text-[13px] font-semibold">Authorized agents</h3>
        <div className="mt-2 divide-y divide-[var(--border)]">
          {task.agents.map((agent) => (
            <div key={agent.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium">
                  {agent.label}
                  <span
                    className={
                      agent.status === "registered"
                        ? "ml-2 rounded-[4px] bg-[var(--success-background)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--success)]"
                        : "ml-2 rounded-[4px] bg-[var(--danger-background)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--danger)]"
                    }
                  >
                    {agent.status}
                  </span>
                </p>
                <p className="mono mt-0.5 truncate text-[11px] text-[var(--foreground-muted)]">{agent.accountId}</p>
                <p className="mono mt-0.5 truncate text-[10px] text-[var(--foreground-muted)]" title={agent.publicKey ?? ""}>
                  Key {agent.publicKey ? shortId(agent.publicKey, 16, 8) : "not registered"}
                </p>
              </div>
              {agent.status === "registered" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[var(--danger)] hover:bg-[var(--danger-background)]"
                  onClick={() => {
                    setAgentToRevoke(agent.accountId);
                    setDialog("revoke");
                  }}
                >
                  <ShieldOff /> Revoke
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-4 text-[var(--foreground-muted)]">
          Revocation blocks future reserve and execute calls. It does not reverse a transfer that was
          already dispatched.
        </p>
      </div>

      <Dialog open={dialog === "fund"} onOpenChange={(open) => (open ? null : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fund task</DialogTitle>
            <DialogDescription>
              Funds move from the owner wallet into the task pool. The backend never signs this
              transaction.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Label htmlFor="fund-amount">Amount (testNEAR)</Label>
            <Input
              id="fund-amount"
              inputMode="decimal"
              placeholder="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            {error ? <p className="text-[12px] text-[var(--danger)]">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button
              loading={action.isPending}
              onClick={() => {
                const validation = validateAmount();
                if (validation) return setError(validation);
                void run({ action: "fund", amount_near: amount }, "Task funded");
              }}
            >
              Fund task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "withdraw"} onOpenChange={(open) => (open ? null : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw available funds</DialogTitle>
            <DialogDescription>
              Only unreserved funds can be withdrawn. This transaction attaches a separate
              non-refundable storage deposit for the async withdrawal record.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Label htmlFor="withdraw-amount">Amount (testNEAR)</Label>
            <Input
              id="withdraw-amount"
              inputMode="decimal"
              placeholder="0.005"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <p className="financial-value text-[11px] text-[var(--foreground-muted)]">
              Additional storage deposit:{" "}
              {task.setup.withdrawalStorageDepositYocto
                ? `${near(task.setup.withdrawalStorageDepositYocto)} testNEAR`
                : "loading from contract"}
            </p>
            <p className="text-[11px] leading-5 text-[var(--foreground-muted)]">
              A timeout does not prove failure. PoolGuard checks the original withdrawal state before
              suggesting another action.
            </p>
            {error ? <p className="text-[12px] text-[var(--danger)]">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button
              loading={action.isPending}
              onClick={() => {
                const validation = validateAmount();
                if (validation) return setError(validation);
                void run({ action: "withdraw", amount_near: amount }, "Withdrawal dispatched");
              }}
            >
              Start withdrawal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "revoke"} onOpenChange={(open) => (open ? null : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke agent</DialogTitle>
            <DialogDescription>
              {agentToRevoke
                ? `${agentToRevoke} will no longer be able to reserve or execute on this task.`
                : "Choose an agent."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-[12px] leading-5 text-[var(--foreground-secondary)]">
              Revocation takes effect on chain and blocks future execution. It does not reverse an
              already-dispatched transfer or erase the audit trail.
            </p>
            {error ? <p className="mt-3 text-[12px] text-[var(--danger)]">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <HoldButton
              variant="destructive"
              size="default"
              hint="Hold to revoke this agent"
              loading={action.isPending}
              onConfirm={() => {
                if (!agentToRevoke) return setError("No agent selected.");
                void run({ action: "revoke_agent", agent_account_id: agentToRevoke }, "Agent revoked");
              }}
            >
              <ShieldOff /> Hold to revoke
            </HoldButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
