"use client";

import * as React from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { StatusScreen } from "@/components/status-screen";
import { Button } from "@/components/ui/button";

export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = (error as { digest?: string } | null)?.digest;
  return (
    <StatusScreen
      code="!"
      title="Something didn’t load."
      body="This screen hit an error. Your tasks and budgets are safe — they live on chain, not in this page."
      actions={
        <>
          <Button size="lg" onClick={() => retry()}>
            <RotateCcw /> Try again
          </Button>
          <Button size="lg" variant="secondary" asChild>
            <Link href="/">Home</Link>
          </Button>
        </>
      }
      detail={digest ? <p className="mono text-[11px] text-[var(--foreground-muted)]">Reference {digest}</p> : null}
    />
  );
}
