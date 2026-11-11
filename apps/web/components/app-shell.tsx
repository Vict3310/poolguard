"use client";

import * as React from "react";
import { ViewTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  Activity,
  BookOpen,
  ChevronLeft,
  FlaskConical,
  House,
  LayoutGrid,
  ListChecks,
  Menu,
  Search,
  Settings,
  ShieldAlert,
  Users,
  X,
} from "lucide-react";
import { CommandPaletteProvider, useCommandPalette } from "@/components/command-palette";
import { AnnouncementBanner } from "@/components/site/announcement-banner";
import { ConsentPrompt } from "@/components/consent-prompt";
import { spring } from "@/lib/motion";
import { PoolGuardMark } from "@/components/brand";
import { ConnectWallet } from "@/components/connect-wallet";
import { NetworkBadge } from "@/components/network-badge";
import { LiveTicker } from "@/components/live-ticker";
import { useAuth } from "@/components/auth-provider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Overview } from "@/lib/types";

type NavLink = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tag?: string;
  count?: number;
};

const SIDEBAR_KEY = "poolguard:sidebar";

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({
  href,
  label,
  icon: Icon,
  tag,
  count,
  active,
  onNavigate,
  indicatorId,
}: NavLink & { active: boolean; onNavigate?: () => void; indicatorId: string }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-11 items-center gap-3 rounded-full px-4 text-[14px] transition-colors duration-150",
        active ? "text-[var(--foreground)]" : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]",
      )}
    >
      {active ? (
        <motion.span layoutId={indicatorId} className="rail-active absolute inset-0 rounded-full" transition={spring.glide} />
      ) : (
        <span aria-hidden className="absolute inset-0 rounded-full bg-[rgb(255_255_255_/_4%)] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
      )}
      <Icon className="relative size-[18px] shrink-0" strokeWidth={1.6} />
      <span className="relative truncate">{label}</span>
      {tag ? <span className="relative rounded-full bg-[var(--action-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--action)]">{tag}</span> : null}
      {count ? (
        <span className="relative ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--action-soft)] px-1.5 text-[11px] font-medium text-[var(--action)]">
          {count}
        </span>
      ) : null}
    </Link>
  );
}

function useNavGroups(): Array<{ label: string; items: NavLink[] }> {
  const { session } = useAuth();
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("/overview"), staleTime: 6_000 });
  const taskCount = overview.data?.tasks.length;
  const recoveries = overview.data?.pendingRecoveries;
  return [
    { label: "Overview", items: [{ href: "/app", label: "Dashboard", icon: LayoutGrid }] },
    {
      label: "Workspace",
      items: [
        { href: "/app/tasks", label: "Tasks", icon: ListChecks, count: taskCount || undefined },
        { href: "/app/agents", label: "Agents", icon: Users },
      ],
    },
    { label: "Activity", items: [{ href: "/app/activity", label: "Activity", icon: Activity, count: recoveries || undefined }] },
    {
      label: "Others",
      items: [
        { href: "/app/demo", label: "Demo lab", icon: FlaskConical, tag: "Lab" },
        { href: "/docs", label: "Documentation", icon: BookOpen },
        { href: "/app/settings", label: "Settings", icon: Settings },
        ...(session?.isAdmin ? [{ href: "/app/admin", label: "Admin", icon: ShieldAlert }] : []),
      ],
    },
  ];
}

/** Expanded navigation: a clean floating panel, no extra chrome. */
function SidebarContents({
  onNavigate,
  indicatorId = "nav-indicator",
  onToggle,
}: {
  onNavigate?: () => void;
  indicatorId?: string;
  onToggle?: () => void;
}) {
  const pathname = usePathname();
  const groups = useNavGroups();
  return (
    <div className="flex h-full flex-col p-3">
      <div className="flex items-center justify-between gap-2 py-2 pl-3 pr-1">
        <Link href="/" className="flex items-center gap-2.5 rounded-full" aria-label="PoolGuard home">
          <PoolGuardMark className="size-6 drop-shadow-[0_2px_10px_rgb(165_166_246_/_35%)]" />
          <span className="text-[15px] font-medium tracking-[-0.01em]">PoolGuard</span>
        </Link>
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            className="inline-flex size-9 items-center justify-center rounded-full text-[var(--foreground-muted)] transition-colors hover:bg-[rgb(255_255_255_/_5%)] hover:text-[var(--foreground)]"
          >
            <ChevronLeft className="size-4" />
          </button>
        ) : null}
      </div>
      <nav aria-label="Primary" className="scrollbar-quiet mt-4 flex-1 space-y-5 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-4 pb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--foreground-muted)]/70">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItem key={item.href} {...item} active={isActive(pathname, item.href)} onNavigate={onNavigate} indicatorId={indicatorId} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}

/** Collapsed navigation: a minimal floating pill of round icon buttons. */
function NavRail({ onExpand }: { onExpand: () => void }) {
  const pathname = usePathname();
  const groups = useNavGroups();
  return (
    <motion.nav
      aria-label="Primary"
      initial={{ opacity: 0, x: -12, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={spring.glide}
      className="rail-pill scrollbar-quiet flex h-full flex-col items-center gap-1 overflow-y-auto rounded-full p-2"
    >
      <RailTip label="PoolGuard home">
        <Link href="/" aria-label="PoolGuard home" className="mb-1 inline-flex size-11 items-center justify-center rounded-full text-[var(--foreground)]">
          <PoolGuardMark className="size-6 drop-shadow-[0_2px_10px_rgb(165_166_246_/_35%)]" />
        </Link>
      </RailTip>
      {groups.map((group, groupIndex) => (
        <React.Fragment key={group.label}>
          {groupIndex > 0 ? <span aria-hidden className="my-1 h-px w-5 bg-[var(--border-strong)]/60" /> : null}
          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <RailTip key={item.href} label={item.label} badge={item.count}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className={cn(
                    "group relative inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-150",
                    active ? "text-[var(--foreground)]" : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]",
                  )}
                >
                  {active ? (
                    <motion.span layoutId="rail-indicator" className="rail-active absolute inset-0 rounded-full" transition={spring.glide} />
                  ) : (
                    <span aria-hidden className="absolute inset-0 scale-90 rounded-full bg-[rgb(255_255_255_/_5%)] opacity-0 transition-[opacity,transform] duration-150 group-hover:scale-100 group-hover:opacity-100" />
                  )}
                  <Icon className="relative size-[18px]" strokeWidth={1.6} />
                  {item.count ? <span aria-hidden className="absolute right-2 top-2 size-1.5 rounded-full bg-[var(--action)]" /> : null}
                </Link>
              </RailTip>
            );
          })}
        </React.Fragment>
      ))}
      <span aria-hidden className="mt-auto" />
      <RailTip label="Expand sidebar">
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand sidebar"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--foreground-muted)] transition-colors hover:bg-[rgb(255_255_255_/_5%)] hover:text-[var(--foreground)]"
        >
          <ChevronLeft className="size-4 rotate-180" />
        </button>
      </RailTip>
    </motion.nav>
  );
}

/** Name label that pops out to the right of a rail button on hover or keyboard focus. */
function RailTip({ label, badge, children }: { label: string; badge?: number; children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Root delayDuration={0}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side="right" sideOffset={14} className="rail-tip z-[60] inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[#141419]/95 py-1.5 pl-3.5 pr-3.5 text-[13px] font-medium text-[var(--foreground)] shadow-[var(--shadow-popover)] backdrop-blur-xl">
          {label}
          {badge ? <span className="rounded-full bg-[var(--action-soft)] px-1.5 text-[11px] text-[var(--action)]">{badge}</span> : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

const LABELS: Record<string, string> = {
  tasks: "Tasks",
  new: "New task",
  agents: "Agents",
  activity: "Activity",
  demo: "Demo lab",
  operations: "Purchase evidence",
  settings: "Settings",
  admin: "Admin",
};

function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const section = segments[1];
  const isTaskDetail = section === "tasks" && segments[2] && segments[2] !== "new";
  const parent = !section ? "Overview" : section === "tasks" && segments[2] ? "Tasks" : "Overview";
  const current = !section ? "Dashboard" : isTaskDetail ? "Task detail" : segments[2] === "new" ? "New task" : LABELS[section] ?? "Workspace";
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-3 text-[16px]">
      <Link href="/app" aria-label="Dashboard" className="text-[var(--foreground-secondary)] transition-colors hover:text-[var(--foreground)]">
        <House className="size-6" strokeWidth={1.25} />
      </Link>
      <span className="hidden text-[var(--foreground-muted)] sm:inline">{parent}</span>
      <span aria-hidden className="hidden text-[var(--foreground-muted)] sm:inline">
        /
      </span>
      <span aria-current="page" className="truncate text-[var(--foreground)]">
        {current}
      </span>
    </nav>
  );
}

function HeaderNetwork() {
  const { meta } = useAuth();
  return <NetworkBadge network={meta?.network} sandbox={meta?.sandbox} className="hidden h-11 rounded-full px-4 xl:inline-flex" />;
}

function SearchButton() {
  const { open } = useCommandPalette();
  const [mac, setMac] = React.useState(true);
  React.useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);
  return (
    <button
      type="button"
      onClick={open}
      className="group hidden h-11 w-[260px] items-center gap-2.5 rounded-[14px] border border-[var(--border)] bg-[#0c0c10] pl-4 pr-2 text-[15px] text-[var(--foreground-muted)] transition-colors duration-150 hover:border-[var(--border-strong)] md:inline-flex xl:w-[320px]"
      aria-label="Open command palette"
    >
      <span className="flex-1 text-left">Search…</span>
      <Search className="size-4 opacity-70" />
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
  const [collapsed, setCollapsed] = React.useState(false);
  const pathname = usePathname();
  React.useEffect(() => setMobileOpen(false), [pathname]);
  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === "collapsed");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = () =>
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, value ? "expanded" : "collapsed");
      } catch {
        /* ignore */
      }
      return !value;
    });

  return (
    <div className="min-h-dvh">
      {collapsed ? (
        <aside className="fixed bottom-4 left-4 top-4 z-30 hidden lg:block">
          <NavRail onExpand={toggle} />
        </aside>
      ) : (
        <aside className="fixed bottom-4 left-4 top-4 z-30 hidden w-[248px] lg:block">
          <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={spring.glide} className="rail-pill h-full rounded-[28px]">
          <SidebarContents onToggle={toggle} />
          </motion.div>
        </aside>
      )}
      <div className={cn("transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]", collapsed ? "lg:pl-[92px]" : "lg:pl-[276px]")}>
        <AnnouncementBanner />
        <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[rgb(8_8_10_/_82%)] backdrop-blur-xl">
          <div className="flex h-[88px] items-center gap-3 px-4 sm:px-6 lg:px-10">
            <button
              type="button"
              className="icon-tile size-11 rounded-[12px] text-[var(--foreground-secondary)] lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="size-5" />
            </button>
            <Breadcrumb />
            <div className="ml-auto flex items-center gap-3">
              <HeaderNetwork />
              <SearchButton />
              <ConnectWallet compact />
            </div>
          </div>
          <LiveTicker />
        </header>
        <main id="main" className="mx-auto w-full max-w-[1480px] px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          <ViewTransition key={pathname} enter="page-in" exit="page-out" default="none">
            <div>{children}</div>
          </ViewTransition>
        </main>
      </div>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent variant="side" className="max-w-[320px] border-l-0 border-r bg-[#09090b]" hideClose>
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <div className="relative flex h-full flex-col bg-[#0b0b0e]">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-4 top-4 z-10 inline-flex size-9 items-center justify-center rounded-full text-[var(--foreground-muted)] hover:bg-[rgb(255_255_255_/_5%)] hover:text-[var(--foreground)]"
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
  const { loading, authenticated, session } = useAuth();
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

  if (!loading && authenticated && session?.consentRequired && pathname !== "/app/settings") {
    return <ConsentPrompt session={session} />;
  }

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
