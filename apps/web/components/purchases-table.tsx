"use client";

import { ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import { StatusBadge } from "@/components/status-badge";
import { near, relative, serviceLabel, shortId } from "@/lib/utils";
import type { Operation } from "@/lib/types";

export function PurchasesTable({
  operations,
  onSelect,
}: {
  operations: Operation[];
  onSelect: (operation: Operation) => void;
}) {
  if (operations.length === 0) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-[13px] font-medium text-[var(--foreground-secondary)]">No purchases yet</p>
        <p className="mx-auto mt-1 max-w-sm text-[12px] leading-5 text-[var(--foreground-muted)]">
          A purchase appears here after an agent quotes a catalog service and the contract accepts
          its reservation.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {["Service", "Agent", "Amount", "Payment", "Delivery", "Time", ""].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className={`py-2.5 text-[11px] font-medium text-[var(--foreground-muted)] ${
                    heading === "Amount" ? "text-right" : ""
                  }`}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {operations.map((operation) => (
              <motion.tr
                key={operation.id}
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                tabIndex={0}
                role="button"
                aria-label={`Open operation ${serviceLabel(operation.serviceId)}`}
                className="group h-[58px] cursor-pointer transition-colors duration-150 hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)]"
                onClick={() => onSelect(operation)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(operation);
                  }
                }}
              >
                <td className="max-w-[260px] py-2 pr-4">
                  <span className="block truncate text-[13px] font-medium">{serviceLabel(operation.serviceId)}</span>
                  <span className="mono mt-0.5 block truncate text-[10px] text-[var(--foreground-muted)]">
                    {shortId(operation.chainOperationId, 10, 6)}
                  </span>
                </td>
                <td className="py-2 pr-4 text-[12px] text-[var(--foreground-secondary)]">{operation.agent.label}</td>
                <td className="financial-value py-2 pr-4 text-right text-[13px]">{near(operation.amountYocto)}</td>
                <td className="py-2 pr-4">
                  <StatusBadge kind="payment" value={operation.paymentState} />
                </td>
                <td className="py-2 pr-4">
                  <StatusBadge kind="fulfillment" value={operation.fulfillmentState} />
                </td>
                <td className="py-2 pr-2 text-[11px] text-[var(--foreground-muted)]">{relative(operation.createdAt)}</td>
                <td className="py-2 text-right">
                  <ChevronRight className="ml-auto size-3.5 text-[var(--foreground-muted)] transition-transform group-hover:translate-x-0.5" />
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-[var(--border)] md:hidden">
        {operations.map((operation) => (
          <li key={operation.id}>
            <button
              type="button"
              className="w-full px-4 py-3.5 text-left hover:bg-[var(--surface-hover)]"
              onClick={() => onSelect(operation)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{serviceLabel(operation.serviceId)}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--foreground-muted)]">
                    {operation.agent.label} · {relative(operation.createdAt)}
                  </p>
                </div>
                <p className="financial-value shrink-0 text-[13px] font-medium">{near(operation.amountYocto)}</p>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <StatusBadge kind="payment" value={operation.paymentState} />
                <StatusBadge kind="fulfillment" value={operation.fulfillmentState} />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
