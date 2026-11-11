"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "motion/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Activity,
  ArrowRight,
  BookOpen,
  FlaskConical,
  Keyboard,
  LayoutGrid,
  ListChecks,
  LogOut,
  Plus,
  Search,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { duration, ease } from "@/lib/motion";
import { feedback } from "@/lib/feedback";
import type { TaskSummary } from "@/lib/types";

interface PaletteContextValue {
  open: () => void;
  openShortcuts: () => void;
}

const PaletteContext = React.createContext<PaletteContextValue | null>(null);

export function useCommandPalette(): PaletteContextValue {
  return React.useContext(PaletteContext) ?? { open: () => undefined, openShortcuts: () => undefined };
}

const GO_SHORTCUTS: Record<string, { href: string; label: string }> = {
  o: { href: "/app", label: "Overview" },
  t: { href: "/app/tasks", label: "Tasks" },
  a: { href: "/app/agents", label: "Agents" },
  v: { href: "/app/activity", label: "Activity" },
  d: { href: "/app/demo", label: "Demo lab" },
  s: { href: "/app/settings", label: "Settings" },
};

export const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["⌘", "K"], label: "Open the command palette" },
  { keys: ["N"], label: "Create a task" },
  ...Object.entries(GO_SHORTCUTS).map(([key, item]) => ({ keys: ["G", key.toUpperCase()], label: `Go to ${item.label}` })),
  { keys: ["?"], label: "Show keyboard shortcuts" },
  { keys: ["Esc"], label: "Close dialogs and drawers" },
];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { authenticated, signOut } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const goPending = React.useRef<number | null>(null);

  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: () => api<{ tasks: TaskSummary[] }>("/tasks"),
    enabled: authenticated && open,
    staleTime: 10_000,
  });

  const navigate = React.useCallback(
    (href: string) => {
      setOpen(false);
      feedback("select");
      router.push(href);
    },
    [router],
  );

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector("[role='dialog']")) return;
      const key = event.key.toLowerCase();
      if (goPending.current !== null) {
        window.clearTimeout(goPending.current);
        goPending.current = null;
        const target = GO_SHORTCUTS[key];
        if (target) {
          event.preventDefault();
          router.push(target.href);
        }
        return;
      }
      if (key === "g") {
        goPending.current = window.setTimeout(() => {
          goPending.current = null;
        }, 900);
        return;
      }
      if (key === "n") {
        event.preventDefault();
        router.push("/app/tasks/new");
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const value = React.useMemo(
    () => ({ open: () => setOpen(true), openShortcuts: () => setShortcutsOpen(true) }),
    [],
  );

  return (
    <PaletteContext.Provider value={value}>
      {children}
      <PaletteDialog open={open} onOpenChange={setOpen} label="Command palette">
        <Command label="Command palette" loop className="flex max-h-[min(70dvh,520px)] flex-col">
          <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-4">
            <Search className="size-4 text-[var(--foreground-muted)]" />
            <Command.Input
              autoFocus
              placeholder="Search tasks, pages and actions…"
              className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-[var(--foreground-muted)]"
            />
            <span className="kbd">Esc</span>
          </div>
          <Command.List className="scrollbar-quiet overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-[13px] text-[var(--foreground-muted)]">
              Nothing matches. Try “task”, “demo” or “settings”.
            </Command.Empty>
            <Group heading="Actions">
              <Item icon={Plus} label="Create a task" hint="N" onSelect={() => navigate("/app/tasks/new")} />
              <Item icon={Sparkles} label="Start guided setup" onSelect={() => navigate("/onboarding")} />
              <Item icon={FlaskConical} label="Run a demo scenario" onSelect={() => navigate("/app/demo")} />
              <Item
                icon={Keyboard}
                label="Keyboard shortcuts"
                hint="?"
                onSelect={() => {
                  setOpen(false);
                  setShortcutsOpen(true);
                }}
              />
            </Group>
            <Group heading="Go to">
              <Item icon={LayoutGrid} label="Overview" hint="G O" onSelect={() => navigate("/app")} />
              <Item icon={ListChecks} label="Tasks" hint="G T" onSelect={() => navigate("/app/tasks")} />
              <Item icon={Users} label="Agents" hint="G A" onSelect={() => navigate("/app/agents")} />
              <Item icon={Activity} label="Activity" hint="G V" onSelect={() => navigate("/app/activity")} />
              <Item icon={FlaskConical} label="Demo lab" hint="G D" onSelect={() => navigate("/app/demo")} />
              <Item icon={Settings} label="Settings" hint="G S" onSelect={() => navigate("/app/settings")} />
              <Item icon={BookOpen} label="Documentation" onSelect={() => navigate("/docs")} />
            </Group>
            {tasks.data?.tasks.length ? (
              <Group heading="Tasks">
                {tasks.data.tasks.slice(0, 12).map((task) => (
                  <Item
                    key={task.id}
                    icon={ArrowRight}
                    label={task.name}
                    keywords={[task.chainTaskId, task.status]}
                    hint={task.status.replace("_", " ")}
                    onSelect={() => navigate(`/app/tasks/${task.id}`)}
                  />
                ))}
              </Group>
            ) : null}
            {authenticated ? (
              <Group heading="Account">
                <Item
                  icon={LogOut}
                  label="Sign out"
                  onSelect={() => {
                    setOpen(false);
                    void signOut().then(() => router.push("/login?reason=signed-out"));
                  }}
                />
              </Group>
            ) : null}
          </Command.List>
          <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-2.5 text-[11px] text-[var(--foreground-muted)]">
            <span className="flex items-center gap-1.5">
              <span className="kbd">↑</span>
              <span className="kbd">↓</span> to move
              <span className="kbd ml-2">↵</span> to open
            </span>
            <span>PoolGuard</span>
          </div>
        </Command>
      </PaletteDialog>
      <PaletteDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} label="Keyboard shortcuts">
        <div className="p-5">
          <h2 className="text-[16px] font-semibold">Keyboard shortcuts</h2>
          <p className="mt-1 text-[13px] text-[var(--foreground-secondary)]">
            Shortcuts work anywhere in the workspace, except while typing in a field.
          </p>
          <ul className="mt-4 divide-y divide-[var(--border)]">
            {SHORTCUTS.map((shortcut) => (
              <li key={shortcut.label} className="flex items-center justify-between gap-4 py-2.5 text-[13px]">
                <span className="text-[var(--foreground-secondary)]">{shortcut.label}</span>
                <span className="flex items-center gap-1">
                  {shortcut.keys.map((key) => (
                    <span key={key} className="kbd">
                      {key}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </PaletteDialog>
    </PaletteContext.Provider>
  );
}

function PaletteDialog({
  open,
  onOpenChange,
  label,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[70] bg-[rgb(0_0_0_/_45%)] backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: duration.fast }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed left-1/2 top-[14vh] z-[71] w-[calc(100%-32px)] max-w-[600px] -translate-x-1/2 overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_24px_64px_rgb(0_0_0_/_45%)]"
                initial={{ opacity: 0, scale: 0.97, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -4 }}
                transition={{ duration: duration.base, ease }}
              >
                <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
                {children}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="mb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-[var(--foreground-muted)]"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  icon: Icon,
  label,
  hint,
  keywords,
  onSelect,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  keywords?: string[];
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={label}
      keywords={keywords}
      onSelect={onSelect}
      className="flex h-10 cursor-pointer items-center gap-3 rounded-[8px] px-3 text-[14px] text-[var(--foreground-secondary)] transition-colors duration-100 data-[selected=true]:bg-[var(--surface-selected)] data-[selected=true]:text-[var(--foreground)]"
    >
      <Icon className="size-4 text-[var(--foreground-muted)]" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="text-[11px] capitalize text-[var(--foreground-muted)]">{hint}</span> : null}
    </Command.Item>
  );
}
