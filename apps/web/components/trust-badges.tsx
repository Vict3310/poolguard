"use client";

import { Cpu, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Run } from "@/lib/types";

/** How a worker's signing key is held: OutLayer TEE custody or a restricted key in server env. */
export function CustodyBadge({ custody, className }: { custody?: "local" | "outlayer"; className?: string }) {
  if (custody === "outlayer") {
    return (
      <Tooltip content="The signing key never leaves OutLayer's secure enclave. OutLayer's policy is checked before every signature, then the PoolGuard contract checks the task policy.">
        <span className={cn("inline-flex items-center gap-1 font-medium text-[var(--accent)]", className)}>
          <LockKeyhole className="size-3" /> OutLayer TEE custody
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content="A function-call key restricted to the PoolGuard contract's worker methods, held in server configuration.">
      <span className={cn("inline-flex items-center gap-1", className)}>
        <KeyRound className="size-3" /> Restricted key
      </span>
    </Tooltip>
  );
}

/** NEAR AI Cloud private inference, with the run's verified signature count. */
export function PrivateInferenceBadge({ run, className }: { run?: Run; className?: string }) {
  const report = run?.privateInference;
  if (!report) return null;
  const all = report.totalCount > 0 && report.verifiedCount === report.totalCount;
  return (
    <Tooltip
      content={
        report.scope ??
        "Inference ran on NEAR AI Cloud inside a TEE; each response signature was checked against the attested key."
      }
    >
      <span
        className={cn(
          "inline-flex items-center gap-1 font-medium",
          all ? "text-[var(--success)]" : "text-[var(--warning)]",
          className,
        )}
      >
        {all ? <ShieldCheck className="size-3" /> : <Cpu className="size-3" />}
        Private inference · {report.verifiedCount}/{report.totalCount} signed
      </span>
    </Tooltip>
  );
}
