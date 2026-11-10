"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Copy, LogOut, Settings, ShieldCheck, Wallet } from "lucide-react";
import { copyText } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { NetworkBadge } from "@/components/network-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { shortId } from "@/lib/utils";

export function ConnectWallet({ compact = false }: { compact?: boolean }) {
  const { meta, loading, authenticated, accountId, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  if (loading) return <Skeleton className="h-9 w-36" />;

  if (authenticated && accountId) {
    return (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] pl-1.5 pr-2.5 text-[13px] font-medium hover:bg-[var(--surface-hover)]"
            aria-label={`Account menu for ${accountId}`}
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-[var(--primary)] text-[10px] font-semibold text-white">
              {accountId.slice(0, 2).toUpperCase()}
            </span>
            <span className={compact ? "sr-only" : "hidden sm:inline"}>{shortId(accountId, 10, 6)}</span>
            <ChevronDown className="size-3.5 text-[var(--foreground-muted)]" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            className="z-[60] w-64 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-popover)]"
          >
            <div className="px-2.5 py-2">
              <p className="text-[12px] text-[var(--foreground-muted)]">Signed in as</p>
              <p className="mono mt-0.5 truncate text-[13px] text-[var(--foreground)]">{accountId}</p>
              <div className="mt-2 flex items-center gap-2">
                <NetworkBadge network={meta?.network} sandbox={meta?.sandbox} />
                {meta?.sandbox ? (
                  <span className="text-[11px] text-[var(--foreground-muted)]">No wallet signature</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[var(--success)]">
                    <ShieldCheck className="size-3" /> NEP-413 verified
                  </span>
                )}
              </div>
            </div>
            <DropdownMenu.Separator className="my-1 h-px bg-[var(--border)]" />
            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-[var(--surface-hover)]"
              onSelect={() => router.push("/app/settings")}
            >
              <Settings className="size-3.5" /> Settings
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-[var(--surface-hover)]"
              onSelect={() => {
                void copyText(accountId);
                void import("sonner").then(({ toast }) => toast.success("Account id copied"));
              }}
            >
              <Copy className="size-3.5" /> Copy account id
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-[var(--surface-hover)]"
              onSelect={() => void signOut().then(() => router.push("/login?reason=signed-out"))}
            >
              <LogOut className="size-3.5" /> Sign out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    );
  }

  return (
    <Button asChild size="sm" className="h-9">
      <Link href={`/login?next=${encodeURIComponent(pathname || "/app")}`}>
        <Wallet />
        Sign in
      </Link>
    </Button>
  );
}
