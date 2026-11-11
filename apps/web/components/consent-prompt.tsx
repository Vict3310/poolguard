"use client";

import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { FileCheck2 } from "lucide-react";
import { LEGAL_VERSIONS } from "@poolguard/shared";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import type { Session } from "@/lib/types";

/** Re-prompt shown when the Terms or Privacy Policy changed since this account accepted them. */
export function ConsentPrompt({ session }: { session: Session }) {
  const queryClient = useQueryClient();
  const [agreed, setAgreed] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const accepted = session.consent?.accepted;
  const firstTime = !accepted?.terms && !accepted?.privacy;

  const accept = async () => {
    setPending(true);
    setError(null);
    try {
      await api("/account/consent", {
        method: "POST",
        body: JSON.stringify({ terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy }),
      });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    } catch (acceptError) {
      setError(acceptError instanceof ApiError ? acceptError.message : "Could not save your acceptance. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl py-10 sm:py-16">
      <span className="flex size-11 items-center justify-center rounded-full bg-[var(--action-soft)] text-[var(--action)]">
        <FileCheck2 className="size-5" />
      </span>
      <h1 className="mt-5 text-[26px] font-semibold tracking-[-0.03em]">
        {firstTime ? "Please review our terms" : "Our terms have changed"}
      </h1>
      <p className="mt-2 text-[15px] leading-6 text-[var(--foreground-secondary)]">
        {firstTime
          ? "Before you make changes in PoolGuard, please read and accept the current documents."
          : "We updated the documents below. Please review them before you make further changes."}
      </p>
      <ul className="mt-5 divide-y divide-[var(--border)] rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
        {(["terms", "privacy"] as const).map((document) => (
          <li key={document} className="flex items-center justify-between gap-4 px-4 py-3 text-[13px]">
            <Link href={document === "terms" ? "/terms" : "/privacy"} target="_blank" className="font-medium text-[var(--action)] underline underline-offset-2">
              {document === "terms" ? "Terms of Use" : "Privacy Policy"}
            </Link>
            <span className="text-[var(--foreground-muted)]">
              {accepted?.[document] ? `you accepted ${accepted[document]} · now ` : ""}
              {LEGAL_VERSIONS[document]}
            </span>
          </li>
        ))}
      </ul>
      <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-[14px] leading-5">
        <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} className="mt-0.5 size-4 accent-[var(--action)]" />
        I’m 18 or older and I accept the current Terms of Use and Privacy Policy.
      </label>
      {error ? <p role="alert" className="mt-3 text-[13px] text-[var(--danger)]">{error}</p> : null}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button variant="action" size="lg" disabled={!agreed} loading={pending} onClick={() => void accept()}>
          Accept and continue
        </Button>
        <Link href="/app/settings#data" className="text-[13px] text-[var(--foreground-muted)] underline underline-offset-4">
          Download or delete my data instead
        </Link>
      </div>
    </div>
  );
}
