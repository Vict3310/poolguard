"use client";

import { AlertTriangle, CheckCircle2, Download, FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import type { TaskResult } from "@/lib/types";

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function ResultSection({ result }: { result: TaskResult }) {
  const download = () => {
    const rows = [
      ["Document", "Agent", "Supplier", "Quotes", "Delivery terms", "Missing fields", "Warnings", "Delivered"],
      ...result.entries.map((entry) => [
        entry.documentLabel,
        entry.agentLabel,
        entry.supplier ?? "",
        entry.quotes.map((quote) => `${quote.amount} ${quote.currency}`).join("; "),
        entry.deliveryTerms.join("; "),
        entry.missingFields.join("; "),
        entry.warnings.join("; "),
        entry.deliveredAt ? formatDate(entry.deliveredAt) : "",
      ]),
    ];
    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "poolguard-comparison.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (result.entries.length === 0) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-[13px] font-medium text-[var(--foreground-secondary)]">No delivered result yet</p>
        <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-[var(--foreground-muted)]">
          Results appear only after a provider independently verifies finalized payment and returns a
          stored extraction. Paid and delivered are separate states.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-[12px] text-[var(--foreground-secondary)]">
          <CheckCircle2 className="size-4 text-[var(--success)]" />
          {result.entries.length} {result.entries.length === 1 ? "document" : "documents"} extracted by the paid service
        </div>
        <Button size="sm" variant="secondary" onClick={download}>
          <Download /> Download CSV
        </Button>
      </div>

      {result.incomplete ? (
        <div className="flex items-start gap-2.5 border-b border-[var(--border)] bg-[var(--warning-background)] px-5 py-3 text-[12px] leading-5 text-[var(--warning)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong className="font-medium">Partial comparison.</strong> At least one agent has not
            delivered a result. The entries below are real outputs, not a generic success state.
          </p>
        </div>
      ) : null}

      {result.differences.length > 0 ? (
        <div className="border-b border-[var(--border)] px-5 py-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
            Commercial differences
          </p>
          <ul className="mt-1.5 space-y-1">
            {result.differences.map((difference) => (
              <li key={difference} className="text-[12px] leading-5 text-[var(--foreground-secondary)]">
                · {difference}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {["Document", "Supplier", "Quoted amount", "Delivery", "Gaps"].map((heading) => (
                <th key={heading} scope="col" className="py-2.5 text-[11px] font-medium text-[var(--foreground-muted)]">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {result.entries.map((entry) => (
              <tr key={entry.operationId} className="align-top">
                <td className="max-w-[240px] py-3 pr-4">
                  <p className="text-[13px] font-medium">{entry.documentLabel}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--foreground-muted)]">
                    {entry.agentLabel} · {entry.deliveredAt ? formatDate(entry.deliveredAt) : "delivered"}
                  </p>
                  <p className="mono mt-0.5 truncate text-[10px] text-[var(--foreground-muted)]" title={entry.operationId}>
                    {entry.operationId.slice(0, 16)}…
                  </p>
                </td>
                <td className="py-3 pr-4 text-[13px]">{entry.supplier ?? "Not identified"}</td>
                <td className="financial-value py-3 pr-4 text-[13px]">
                  {entry.quotes.length === 0
                    ? "Not stated"
                    : entry.quotes.map((quote) => `${quote.amount} ${quote.currency}`).join(" · ")}
                </td>
                <td className="max-w-[260px] py-3 pr-4 text-[12px] leading-5 text-[var(--foreground-secondary)]">
                  {entry.deliveryTerms.length === 0 ? "Not stated" : entry.deliveryTerms.join("; ")}
                </td>
                <td className="max-w-[220px] py-3 text-[12px] leading-5">
                  {entry.missingFields.length > 0 ? (
                    <span className="text-[var(--warning)]">{entry.missingFields.join("; ")}</span>
                  ) : (
                    <span className="text-[var(--foreground-muted)]">None extracted</span>
                  )}
                  {entry.warnings.length > 0 ? (
                    <ul className="mt-1.5 space-y-1">
                      {entry.warnings.map((warning) => (
                        <li key={warning} className="flex items-start gap-1 text-[11px] text-[var(--danger)]">
                          <FileWarning className="mt-0.5 size-3 shrink-0" />
                          {warning}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-[var(--border)] lg:hidden">
        {result.entries.map((entry) => (
          <li key={entry.operationId} className="px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium">{entry.documentLabel}</p>
                <p className="mt-0.5 text-[11px] text-[var(--foreground-muted)]">{entry.agentLabel}</p>
              </div>
              <p className="financial-value text-right text-[12px]">
                {entry.quotes.length === 0
                  ? "No quote"
                  : entry.quotes.map((quote) => `${quote.amount} ${quote.currency}`).join(" · ")}
              </p>
            </div>
            <dl className="mt-3 space-y-1.5 text-[12px]">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-[var(--foreground-muted)]">Supplier</dt>
                <dd>{entry.supplier ?? "Not identified"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-[var(--foreground-muted)]">Delivery</dt>
                <dd className="text-[var(--foreground-secondary)]">
                  {entry.deliveryTerms.length === 0 ? "Not stated" : entry.deliveryTerms.join("; ")}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-[var(--foreground-muted)]">Gaps</dt>
                <dd className="text-[var(--warning)]">
                  {entry.missingFields.length === 0 ? "None extracted" : entry.missingFields.join("; ")}
                </dd>
              </div>
            </dl>
            {entry.warnings.length > 0 ? (
              <div className="mt-2 rounded-[6px] bg-[var(--danger-background)] px-2.5 py-2 text-[11px] leading-4 text-[var(--danger)]">
                {entry.warnings.join(" ")}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
