"use client";

import * as React from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { StatusScreen } from "@/components/status-screen";
import { Button } from "@/components/ui/button";

export default function WorkspaceError({ error, retry }: { error: unknown; retry: () => void }) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = (error as { digest?: string } | null)?.digest;
  return (
    <StatusScreen
      framed={false}
      code="!"
      title="This view hit a problem."
      body="Nothing was signed or spent. Try again, or go back to the overview — balances are always re-read from the contract."
      actions={
        <>
          <Button onClick={() => retry()}>
            <RotateCcw /> Try again
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/app">Back to overview</Link>
          </Button>
        </>
      }
      detail={digest ? <p className="mono text-[11px] text-[var(--foreground-muted)]">Reference {digest}</p> : null}
    />
  );
}
