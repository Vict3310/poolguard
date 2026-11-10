"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight,
  Check,
  Maximize2,
  Circle,
  Clock3,
  Copy,
  ExternalLink,
  Loader2,
  RotateCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { api, ApiError, copyText } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { CopyButton } from "@/components/copy-button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatTime, near, serviceLabel, shortId } from "@/lib/utils";
import type { Operation } from "@/lib/types";
import { DrawnCheck } from "@/components/ui/drawn-check";
import { duration, ease, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

type StepState = "done" | "active" | "pending" | "failed";

function Step({
  label,
  detail,
  state,
  last,
  index = 0,
}: {
  label: string;
  detail?: string;
  state: StepState;
  last?: boolean;
  index?: number;
}) {
  const icon =
    state === "done" ? (
      <DrawnCheck className="size-3.5" delay={0.12 + index * 0.08} />
    ) : state === "active" ? (
      <Loader2 className="size-3.5 animate-spin" />
    ) : state === "failed" ? (
      <X className="size-3.5" />
    ) : (
      <Circle className="size-2.5" />
    );
  return (
    <motion.li
      className="relative flex gap-3 pb-5 last:pb-0"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.base, ease, delay: index * 0.07 }}
    >
      {!last ? (
        <span aria-hidden className="absolute left-[13px] top-6 h-[calc(100%-16px)] w-px overflow-hidden bg-[var(--border)]">
          {state === "done" ? (
            <motion.span
              className="block w-full bg-[var(--success)]/40"
              initial={{ height: 0 }}
              animate={{ height: "100%" }}
              transition={{ duration: duration.slow, ease, delay: 0.2 + index * 0.08 }}
            />
          ) : null}
        </span>
      ) : null}
      <span
        className={
          state === "done"
            ? "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--success-background)] text-[var(--success)]"
            : state === "failed"
              ? "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--danger-background)] text-[var(--danger)]"
              : state === "active"
                ? "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--warning-background)] text-[var(--warning)]"
                : "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-muted)]"
        }
      >
        {icon}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-[13px] font-medium leading-5 text-[var(--foreground)]">{label}</p>
        {detail ? <p className="mt-0.5 text-[12px] leading-5 text-[var(--foreground-muted)]">{detail}</p> : null}
      </div>
    </motion.li>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
  copy = false,
  href,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
  copy?: boolean;
  href?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
      <dt className="text-[12px] text-[var(--foreground-muted)]">{label}</dt>
      <dd className="flex max-w-[75%] items-center gap-1 text-right text-[12px] text-[var(--foreground)]">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="mono inline-flex items-center gap-1 break-all text-[var(--accent)] underline-offset-2 hover:underline"
          >
            {value} <ExternalLink className="size-3 shrink-0" />
          </a>
        ) : (
          <span className={mono ? "mono break-all" : "break-words"}>{value ?? "—"}</span>
        )}
        {copy && typeof value === "string" ? <CopyButton value={value} label={`Copy ${label}`} /> : null}
      </dd>
    </div>
  );
}

export function OperationDetail({ operation, variant = "drawer" }: { operation: Operation; variant?: "drawer" | "page" }) {
  const Header = variant === "drawer" ? DialogHeader : PlainHeader;
  const Title = variant === "drawer" ? DialogTitle : PlainTitle;
  const Body = variant === "drawer" ? DialogBody : PlainBody;
  const Footer = variant === "drawer" ? DialogFooter : PlainFooter;
  const queryClient = useQueryClient();
  const [showTechnical, setShowTechnical] = React.useState(false);
  const recovery = useMutation({
    mutationFn: () => api(`/operations/${operation.id}/recover`, { method: "POST" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["operation", operation.id] });
      await queryClient.invalidateQueries({ queryKey: ["task"] });
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
      const { toast } = await import("sonner");
      toast.success("Recovery queued", {
        description: "PoolGuard will check the original operation before any new action.",
      });
    },
    onError: async (error) => {
      const { toast } = await import("sonner");
      toast.error("Recovery not queued", {
        description: error instanceof ApiError ? error.message : "Unexpected error",
      });
    },
  });

  const paid = operation.paymentState === "paid";
  const pending = operation.paymentState === "payout_pending";
  const failed = operation.paymentState === "payout_failed";
  const delivered = operation.fulfillmentState === "delivered" || operation.delivery?.status === "delivered";
  const deliveryFailed = operation.fulfillmentState === "delivery_failed";
  const paymentSubmitted = operation.payoutAttempts > 0;

  const submittedDetail = operation.transactions.find((tx) => tx.kind === "EXECUTE");
  const settlementDetail = paid
    ? operation.settledAtBlock
      ? `Settled at block ${operation.settledAtBlock}`
      : "Settled on chain"
    : failed
      ? operation.lastError ?? "Transfer failed"
      : pending
        ? "Waiting for the contract callback"
        : "Not dispatched";

  return (
    <>
      <Header>
        <div className="flex flex-wrap items-center gap-2">
          <Title>{serviceLabel(operation.serviceId)}</Title>
          <StatusBadge kind="payment" value={operation.paymentState} />
          <StatusBadge kind="fulfillment" value={operation.fulfillmentState} />
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="financial-value text-[24px] font-medium leading-none">
            {near(operation.amountYocto)}
          </span>
          <span className="text-[12px] text-[var(--foreground-secondary)]">testNEAR</span>
          <span className="text-[12px] text-[var(--foreground-muted)]">
            · {operation.agent.label} · policy v{operation.policyVersion}
          </span>
          {variant === "drawer" ? (
            <Link
              href={`/app/operations/${operation.id}`}
              className="ml-auto inline-flex items-center gap-1 text-[12px] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
            >
              <Maximize2 className="size-3" /> Open as page
            </Link>
          ) : null}
        </div>
      </Header>
      <Body className="space-y-6">
        {operation.needsRecovery || pending ? (
          <div className="rounded-[10px] border border-[var(--warning)]/30 bg-[var(--warning-background)] p-4">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
              <div>
                <p className="text-[13px] font-medium text-[var(--warning)]">
                  Payment outcome is still being checked.
                </p>
                <p className="mt-1 text-[12px] leading-5 text-[var(--warning)]">
                  PoolGuard will look up the original operation before attempting another action.
                  There is no “pay again” path for this operation.
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => recovery.mutate()}
                  loading={recovery.isPending}
                >
                  <RotateCw /> Check status
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <ol>
          <Step
            index={0}
            label="Requested"
            detail={`${operation.agent.label} · ${formatDate(operation.createdAt)}`}
            state="done"
          />
          <Step
            index={1}
            label="Authorized and reserved"
            detail={`Policy v${operation.policyVersion} · reservation expires at block ${operation.reservationExpiresAtBlock}`}
            state="done"
          />
          <Step
            index={2}
            label="Payment submitted"
            detail={
              paymentSubmitted
                ? submittedDetail?.txHash
                  ? `Transaction ${shortId(submittedDetail.txHash, 12, 8)}`
                  : "Transfer dispatched to the provider"
                : "Not dispatched"
            }
            state={paymentSubmitted ? "done" : pending || paid ? "done" : "pending"}
          />
          <Step
            index={3}
            label={paid ? "Payment settled" : failed ? "Payment failed" : "Payment settlement"}
            detail={settlementDetail}
            state={paid ? "done" : failed ? "failed" : pending ? "active" : "pending"}
          />
          <Step
            index={4}
            label={delivered ? "Result delivered" : deliveryFailed ? "Delivery failed" : "Result delivery"}
            detail={
              delivered
                ? operation.delivery?.deliveredAt
                  ? `Stored by provider · ${formatDate(operation.delivery.deliveredAt)}`
                  : "Stored by the provider"
                : deliveryFailed
                  ? "The provider could not return a result. Payment remains settled and separate."
                  : paid
                    ? "Paid, awaiting structured output"
                    : "Requires settled payment"
            }
            state={delivered ? "done" : deliveryFailed ? "failed" : paid ? "active" : "pending"}
            last
          />
        </ol>

        {delivered ? (
          <div className="rounded-[10px] border border-[var(--success)]/20 bg-[var(--success-background)] p-4">
            <p className="text-[13px] font-medium text-[var(--success)]">Useful result is available</p>
            <p className="mt-1 text-[12px] leading-5 text-[var(--success)]">
              Payment settled and the provider returned a stored extraction. The two states stay
              separate: a paid operation can still have a failed delivery.
            </p>
            <Link
              href={`/app/tasks/${operation.taskId}#result`}
              className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--success)] underline-offset-2 hover:underline"
            >
              View result in task <ArrowUpRight className="size-3" />
            </Link>
          </div>
        ) : null}

        <div>
          <button
            type="button"
            className="flex w-full items-center justify-between border-y border-[var(--border)] py-3 text-left text-[13px] font-medium"
            onClick={() => setShowTechnical((value) => !value)}
            aria-expanded={showTechnical}
          >
            Technical evidence
            <span className="text-[11px] font-normal text-[var(--foreground-muted)]">
              <span className="inline-flex items-center gap-1.5">
              {showTechnical ? "Hide" : "Show IDs and transactions"}
              <motion.span animate={{ rotate: showTechnical ? 180 : 0 }} transition={spring.snappy} className="inline-block">
                ▾
              </motion.span>
            </span>
            </span>
          </button>
          <AnimatePresence initial={false}>
          {showTechnical ? (
            <motion.dl
              className="divide-y divide-[var(--border)] overflow-hidden"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: duration.base, ease }}
            >
              <DetailRow label="Operation ID" value={operation.chainOperationId} mono copy />
              <DetailRow label="Local operation" value={operation.id} mono copy />
              <DetailRow label="Request hash" value={operation.requestHash} mono copy />
              <DetailRow label="Output schema hash" value={operation.outputSchemaHash} mono copy />
              <DetailRow label="Agent account" value={operation.agent.accountId} mono copy />
              <DetailRow label="Provider account" value={operation.providerAccountId} mono copy />
              <DetailRow label="Policy version" value={operation.policyVersion} />
              <DetailRow label="Payout attempts" value={operation.payoutAttempts} />
              <DetailRow label="Recovery attempts" value={operation.recoveryAttempts} />
              <DetailRow label="Reservation expiry" value={`Block ${operation.reservationExpiresAtBlock}`} />
              <DetailRow
                label="Latest transaction"
                value={submittedDetail?.txHash ?? operation.transactions[0]?.txHash ?? "—"}
                mono
                copy
                href={operation.explorerUrl ?? null}
              />
              {(operation.transactions ?? []).map((tx) => (
                <DetailRow
                  key={tx.id}
                  label={`${tx.kind} · ${tx.status}`}
                  value={tx.txHash ?? "—"}
                  mono
                  copy
                  href={
                    tx.txHash && operation.explorerUrl
                      ? `https://testnet.nearblocks.io/txns/${tx.txHash}`
                      : null
                  }
                />
              ))}
              {!operation.explorerUrl ? (
                <p className="pt-3 text-[11px] leading-5 text-[var(--foreground-muted)]">
                  Local sandbox transactions have no public explorer. The hash is still recorded and
                  can be queried from the sandbox RPC.
                </p>
              ) : null}
            </motion.dl>
          ) : null}
          </AnimatePresence>
        </div>
      </Body>
      <Footer>
        <p className="mr-auto text-[11px] leading-4 text-[var(--foreground-muted)]">
          Created {formatDate(operation.createdAt)} · updated {formatTime(operation.updatedAt)}
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            void copyText(operation.chainOperationId);
            void import("sonner").then(({ toast }) => toast.success("Operation ID copied"));
          }}
        >
          <Copy /> Copy operation ID
        </Button>
      </Footer>
    </>
  );
}

export function OperationDrawer({
  operationId,
  open,
  onOpenChange,
}: {
  operationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const query = useQuery({
    queryKey: ["operation", operationId],
    queryFn: () => api<{ operation: Operation }>(`/operations/${operationId}`).then((value) => value.operation),
    enabled: Boolean(operationId) && open,
    refetchInterval: (queryResult) => {
      const value = queryResult.state.data;
      return value && (value.needsRecovery || value.paymentState === "payout_pending") ? 2_000 : false;
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="side" className="p-0">
        {query.isLoading ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : query.error ? (
          <div className="p-6">
            <DialogTitle>Operation unavailable</DialogTitle>
            <p className="mt-2 text-[13px] text-[var(--danger)]">
              {query.error instanceof ApiError ? query.error.message : "The operation could not be loaded."}
            </p>
            <Button variant="secondary" className="mt-4" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : query.data ? (
          <OperationDetail operation={query.data} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PlainHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("border-b border-[var(--border)] px-5 py-5 sm:px-6", className)}>{children}</div>;
}
function PlainTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="text-[20px] font-semibold tracking-[-0.02em]">{children}</h1>;
}
function PlainBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-5 py-5 sm:px-6", className)}>{children}</div>;
}
function PlainFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-5 py-4 sm:px-6", className)}>{children}</div>
  );
}
