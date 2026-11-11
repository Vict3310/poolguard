"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileCheck2, LogOut, MonitorSmartphone, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { HoldButton } from "@/components/ui/hold-button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, relative } from "@/lib/utils";

function Panel({ id, title, description, children }: { id?: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <section id={id} className="workspace-panel scroll-mt-24 overflow-hidden">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="mt-0.5 text-[12px] text-[var(--foreground-muted)]">{description}</p>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Firefox\//.test(userAgent) ? "Firefox" : /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const os = /Windows/.test(userAgent) ? "Windows" : /Mac OS X/.test(userAgent) ? "macOS" : /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Linux/.test(userAgent) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export function DataPrivacySettings() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accountId } = useAuth();
  const [confirmText, setConfirmText] = React.useState("");
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ["account-sessions"],
    queryFn: () =>
      api<{ sessions: Array<{ id: string; current: boolean; userAgent: string | null; createdAt: string; lastSeenAt: string; expiresAt: string }> }>(
        "/account/sessions",
      ),
  });
  const consents = useQuery({
    queryKey: ["account-consents"],
    queryFn: () =>
      api<{ current: { terms: string; privacy: string }; records: Array<{ document: string; version: string; acceptedAt: string }> }>("/account/consents"),
  });

  const revoke = useMutation({
    mutationFn: (body: { session_id?: string; all_others?: boolean; all?: boolean }) =>
      api<{ revoked: number }>("/account/sessions/revoke", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async (result, body) => {
      const { toast } = await import("sonner");
      toast.success(`Signed out of ${result.revoked} session${result.revoked === 1 ? "" : "s"}`);
      if (body.all) {
        queryClient.clear();
        router.push("/login?reason=signed-out");
        return;
      }
      await sessions.refetch();
    },
  });

  const remove = useMutation({
    mutationFn: () => api<{ deleted: boolean; tasks: number }>("/account/delete", { method: "POST", body: JSON.stringify({ confirm: confirmText }) }),
    onSuccess: async () => {
      queryClient.clear();
      try {
        for (const key of ["poolguard:task-draft", "poolguard:onboarding", "poolguard:onboarding-stage", "poolguard:upload-notice"]) {
          window.localStorage.removeItem(key);
        }
      } catch {
        /* ignore */
      }
      router.push("/login?reason=signed-out");
    },
    onError: (error) => setDeleteError(error instanceof ApiError ? error.message : "Deletion failed. Nothing was removed."),
  });

  return (
    <div className="space-y-6">
      <Panel id="data" title="Data and privacy" description="Download what PoolGuard stores about you, in a format you can use elsewhere.">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm">
            <a href="/api/account/export?format=json" download>
              <Download /> Everything (JSON)
            </a>
          </Button>
          {(["tasks", "operations", "activity"] as const).map((dataset) => (
            <Button key={dataset} asChild variant="ghost" size="sm">
              <a href={`/api/account/export?format=csv&dataset=${dataset}`} download>
                <Download /> {dataset[0]!.toUpperCase() + dataset.slice(1)} (CSV)
              </a>
            </Button>
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-5 text-[var(--foreground-muted)]">
          The JSON export includes your decrypted documents. On-chain records are public and not included; read them from the
          contract or an explorer. See the <Link href="/privacy" className="underline underline-offset-2">Privacy Policy</Link>.
        </p>
      </Panel>

      <Panel title="Active sessions" description="Devices currently signed in to your account.">
        {sessions.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {(sessions.data?.sessions ?? []).map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="flex items-center gap-3">
                  <MonitorSmartphone className="size-4 text-[var(--foreground-muted)]" />
                  <span>
                    <span className="block text-[13px] font-medium">
                      {deviceLabel(session.userAgent)}
                      {session.current ? <span className="ml-2 rounded-full bg-[var(--action-soft)] px-2 py-0.5 text-[10px] text-[var(--action)]">This device</span> : null}
                    </span>
                    <span className="block text-[11px] text-[var(--foreground-muted)]">
                      Signed in {formatDate(session.createdAt)} · active {relative(session.lastSeenAt)}
                    </span>
                  </span>
                </span>
                {!session.current ? (
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate({ session_id: session.id })}>
                    Sign out
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => revoke.mutate({ all_others: true })} loading={revoke.isPending && Boolean(revoke.variables?.all_others)}>
            Sign out other devices
          </Button>
          <Button size="sm" variant="ghost" onClick={() => revoke.mutate({ all: true })}>
            <LogOut /> Sign out everywhere
          </Button>
        </div>
      </Panel>

      <Panel title="Consent history" description="Which versions of the Terms and Privacy Policy you accepted.">
        {consents.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : (consents.data?.records ?? []).length === 0 ? (
          <p className="text-[13px] text-[var(--foreground-muted)]">No acceptance recorded yet.</p>
        ) : (
          <ul className="space-y-2 text-[13px]">
            {(consents.data?.records ?? []).map((record) => (
              <li key={`${record.document}-${record.version}-${record.acceptedAt}`} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <FileCheck2 className="size-3.5 text-[var(--success)]" />
                  {record.document === "terms" ? "Terms of Use" : "Privacy Policy"} {record.version}
                  {consents.data && record.version === consents.data.current[record.document as "terms" | "privacy"] ? (
                    <span className="text-[11px] text-[var(--foreground-muted)]">current</span>
                  ) : null}
                </span>
                <span className="text-[12px] text-[var(--foreground-muted)]">{formatDate(record.acceptedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Delete my data" description="Remove your tasks, documents, activity, sessions and account from PoolGuard.">
        <ul className="space-y-1 text-[13px] leading-5 text-[var(--foreground-secondary)]">
          <li>• Deletes off-chain data: tasks, documents, purchase records, activity, sessions and consent records.</li>
          <li>
            • <strong>Does not</strong> touch the blockchain. Task names, payments and budgets stay on chain, and any unspent
            budget stays withdrawable by your wallet.
          </li>
          <li>• One audit entry records that a deletion happened. Backups expire on their own schedule.</li>
          <li>• Download your data first if you want a copy. This can’t be undone.</li>
        </ul>
        <label className="mt-4 block text-[13px] font-medium" htmlFor="delete-confirm">
          Type your account id <span className="mono text-[12px]">{accountId}</span> to confirm
        </label>
        <Input id="delete-confirm" className="mt-1.5 max-w-sm" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} autoComplete="off" />
        {deleteError ? <p role="alert" className="mt-2 text-[13px] text-[var(--danger)]">{deleteError}</p> : null}
        <HoldButton
          className="mt-4"
          variant="destructive"
          size="default"
          hint="Hold to delete your data"
          disabled={confirmText !== accountId}
          loading={remove.isPending}
          onConfirm={() => {
            setDeleteError(null);
            remove.mutate();
          }}
        >
          <Trash2 /> Hold to delete my data
        </HoldButton>
      </Panel>
    </div>
  );
}
