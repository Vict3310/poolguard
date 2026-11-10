"use client";

import * as React from "react";
import { ViewTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  Activity,
  BookOpen,
  FlaskConical,
  LayoutGrid,
  ListChecks,
  Menu,
  Search,
  Settings,
  Users,
  X,
} from "lucide-react";
import { CommandPaletteProvider, useCommandPalette } from "@/components/command-palette";
import { spring } from "@/lib/motion";
import { Brand } from "@/components/brand";
import { ConnectWallet } from "@/components/connect-wallet";
import { NetworkBadge } from "@/components/network-badge";
import { useAuth } from "@/components/auth-provider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/app", label: "Overview", icon: LayoutGrid },
  { href: "/app/tasks", label: "Tasks", icon: ListChecks },
  { href: "/app/agents", label: "Agents", icon: Users },
  { href: "/app/activity", label: "Activity", icon: Activity },
];

const SECONDARY = [
  { href: "/app/demo", label: "Demo lab", icon: FlaskConical },
  { href: "/docs", label: "Documentation", icon: BookOpen },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
  indicatorId,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onNavigate?: () => void;
  indicatorId: string;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-9 items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] transition-colors duration-150",
        active
          ? "font-medium text-[var(--foreground)]"
          : "text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]",
      )}
    >
      {active ? (
        <motion.span
          layoutId={indicatorId}
          className="absolute inset-0 rounded-[7px] bg-[var(--surface-selected)]"
          transition={spring.glide}
        />
      ) : null}
      <Icon
        className={cn(
          "relative size-4 transition-transform duration-150 group-hover:scale-105",
          active ? "text-[var(--foreground)]" : "text-[var(--foreground-muted)]",
        )}
      />
      <span className="relative">{label}</span>
    </Link>
  );
}

function SidebarContents({ onNavigate, indicatorId = "nav-indicator" }: { onNavigate?: () => void; indicatorId?: string }) {
  const pathname = usePathname();
  const { meta } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Brand />
      </div>
      <div className="px-3.5 pb-2 pt-3">
        <p className="px-2.5 pb-1.5 text-[10px] font-medium uppercase tracking-[0.09em] text-[var(--foreground-muted)]">
          Workspace
        </p>
        <nav aria-label="Primary" className="space-y-0.5">
          {NAV.map((item) => (
            <NavItem key={item.href} {...item} active={isActive(pathname, item.href)} onNavigate={onNavigate} indicatorId={indicatorId} />
          ))}
        </nav>
      </div>
      <div className="px-3.5 pt-4">
        <p className="px-2.5 pb-1.5 text-[10px] font-medium uppercase tracking-[0.09em] text-[var(--foreground-muted)]">
          Practice
        </p>
        <nav aria-label="Secondary" className="space-y-0.5">
          {SECONDARY.map((item) => (
            <NavItem key={item.href} {...item} active={isActive(pathname, item.href)} onNavigate={onNavigate} indicatorId={indicatorId} />
          ))}
        </nav>
      </div>
      <div className="mt-auto border-t border-[var(--border)] p-4">
        <div className="flex items-center justify-between gap-2">
          <NetworkBadge network={meta?.network} sandbox={meta?.sandbox} />
          <span className="text-[10px] text-[var(--foreground-muted)]">v0.1</span>
        </div>
        <p className="mt-2 text-[11px] leading-4 text-[var(--foreground-muted)]">
          Testnet prototype. Not audited. Tokens have no monetary value.
        </p>
        <p className="mono mt-2 truncate text-[10px] text-[var(--foreground-muted)]" title={meta?.contractId}>
          {meta?.contractId ?? "contract loading…"}
        </p>
      </div>
    </div>
  );
}

function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const labels: Record<string, string> = {
    app: "Workspace",
    tasks: "Tasks",
    new: "New task",
    agents: "Agents",
    activity: "Activity",
    demo: "Demo lab",
    docs: "Documentation",
    operations: "Operation",
    settings: "Settings",
  };
  const label = segments.length === 1 ? "Overview" : labels[segments[1] ?? ""] ?? "Workspace";
  const isTaskDetail = segments[0] === "app" && segments[1] === "tasks" && segments[2] && segments[2] !== "new";
  const isOperation = segments[1] === "operations" && segments[2];
  return (
    <div className="flex min-w-0 items-center gap-2 text-[13px]">
      <span className="hidden text-[var(--foreground-muted)] sm:inline">Workspace</span>
      <span aria-hidden className="hidden text-[var(--border-strong)] sm:inline">
        /
      </span>
      <span className="truncate font-medium text-[var(--foreground)]">
        {isTaskDetail ? "Task detail" : isOperation ? "Purchase evidence" : label}
      </span>
    </div>
  );
}

function SearchButton() {
  const { open } = useCommandPalette();
  const [mac, setMac] = React.useState(true);
  React.useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);
  return (
    <button
      type="button"
      onClick={open}
      className="group hidden h-9 items-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] pl-2.5 pr-1.5 text-[13px] text-[var(--foreground-muted)] transition-[border-color,box-shadow] duration-150 hover:border-[#d6d8d0] hover:shadow-[0_2px_8px_rgb(24_28_20_/_5%)] md:inline-flex"
      aria-label="Open command palette"
    >
      <Search className="size-3.5" />
      <span className="pr-6">Search or jump to…</span>
      <span className="kbd">{mac ? "⌘" : "Ctrl"}</span>
      <span className="kbd">K</span>
    </button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <CommandPaletteProvider>
      <AppShellFrame>{children}</AppShellFrame>
    </CommandPaletteProvider>
  );
}

function AppShellFrame({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const pathname = usePathname();
  React.useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="min-h-dvh bg-[var(--background)]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 border-r border-[var(--border)] bg-[var(--surface-muted)] lg:block">
        <SidebarContents />
      </aside>
      <div className="lg:pl-56">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-[var(--border)] bg-[var(--background)]/95 px-4 backdrop-blur sm:px-6 lg:px-10">
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-[7px] text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)] lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
          <Breadcrumb />
          <div className="ml-auto flex items-center gap-2.5">
            <SearchButton />
            <span className="hidden text-[11px] text-[var(--foreground-muted)] xl:inline">
              testNEAR · no monetary value
            </span>
            <ConnectWallet compact />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <ViewTransition key={pathname} enter="page-in" exit="page-out" default="none">
            <div>{children}</div>
          </ViewTransition>
        </main>
      </div>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent variant="side" className="max-w-[300px] border-l-0 border-r" hideClose>
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <div className="relative flex h-full flex-col bg-[var(--surface-muted)]">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 z-10 inline-flex size-9 items-center justify-center rounded-[7px] text-[var(--foreground-muted)] hover:bg-[var(--surface-hover)]"
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
            <SidebarContents onNavigate={() => setMobileOpen(false)} indicatorId="nav-indicator-mobile" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { loading, authenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const wasAuthenticated = React.useRef(false);

  React.useEffect(() => {
    if (authenticated) {
      wasAuthenticated.current = true;
      return;
    }
    if (loading) return;
    const params = new URLSearchParams({ next: pathname });
    // A session that disappears mid-visit expired or was revoked elsewhere.
    if (wasAuthenticated.current) params.set("reason", "expired");
    router.replace(`/login?${params.toString()}`);
  }, [authenticated, loading, pathname, router]);

  if (loading || !authenticated) {
    return (
      <div className="mx-auto max-w-5xl space-y-4" aria-busy="true" aria-label="Loading workspace">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
        <div className="workspace-panel mt-6 p-6">
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
