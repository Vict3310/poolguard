"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusScreen } from "@/components/status-screen";
import { cn, near, relative, shortId } from "@/lib/utils";
import { spring } from "@/lib/motion";

const TABS = [
  ["overview", "Overview"],
  ["jobs", "Jobs"],
  ["operations", "Stuck operations"],
  ["withdrawals", "Withdrawals"],
  ["workers", "Workers"],
  ["contract", "Contract"],
  ["users", "Users & access"],
  ["tasks", "Tasks"],
  ["moderation", "Moderation"],
  ["usage", "Usage"],
  ["announcements", "Announcements"],
  ["audit", "Audit log"],
] as const;
type Tab = (typeof TABS)[number][0];

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function useAdmin<T = Any>(path: string, enabled = true) {
  return useQuery({ queryKey: ["admin", path], queryFn: () => api<T>(path), enabled, refetchInterval: 30_000, retry: 0 });
}

function useAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
    onSuccess: async () => {
      const { toast } = await import("sonner");
      toast.success("Done. The action was written to the audit log.");
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: async (error) => {
      const { toast } = await import("sonner");
      toast.error(error instanceof ApiError ? error.message : "Action failed");
    },
  });
}

function Pill({ tone, children }: { tone: "success" | "warning" | "danger" | "neutral"; children: React.ReactNode }) {
  const cls = {
    success: "bg-[var(--success-background)] text-[var(--success)]",
    warning: "bg-[var(--warning-background)] text-[var(--warning)]",
    danger: "bg-[var(--danger-background)] text-[var(--danger)]",
    neutral: "bg-[var(--surface-muted)] text-[var(--foreground-muted)]",
  }[tone];
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>{children}</span>;
}

const statusTone = (status: string) =>
  status === "up" || status === "SUCCEEDED" ? "success" : status === "degraded" || status === "QUEUED" || status === "RUNNING" ? "warning" : status === "not_configured" ? "neutral" : "danger";

function Card({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="workspace-panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {actions}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="px-5 py-6 text-[13px] text-[var(--foreground-muted)]">{empty}</p>;
  return (
    <table className="w-full min-w-[640px] text-left text-[12px]">
      <thead>
        <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
          {head.map((cell) => (
            <th key={cell} className="px-5 py-2.5 font-medium">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--border)]">
        {rows.map((row, index) => (
          <tr key={index} className="align-top">
            {row.map((cell, cellIndex) => (
              <td key={cellIndex} className="px-5 py-2.5">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Loading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export default function AdminPage() {
  const { session } = useAuth();
  const [tab, setTab] = React.useState<Tab>("overview");
  const operator = Boolean(session?.isOperator);

  if (!session?.isAdmin) {
    return (
      <StatusScreen
        framed={false}
        code="404"
        title="This page doesn’t exist."
        body="If you operate this deployment, add your account to ADMIN_ACCOUNTS."
        actions={null}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] text-[var(--foreground-secondary)]">
            <ShieldAlert className="size-3" /> Operator console · {operator ? "actions enabled" : "read-only"}
          </span>
        }
        title="Admin"
        description="Health, queues, money in flight, accounts and moderation. Every action here is written to the audit log."
      />
      <div className="scrollbar-quiet -mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Admin sections">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "relative h-8 shrink-0 rounded-full px-3 text-[12px] font-medium transition-colors",
              tab === id ? "text-[var(--action)]" : "text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)]",
            )}
          >
            {tab === id ? <motion.span layoutId="admin-tab" className="absolute inset-0 rounded-full bg-[var(--action-soft)] shadow-[inset_0_0_0_1px_rgb(165_166_246_/_16%)]" transition={spring.glide} /> : null}
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>
      {tab === "overview" ? <Overview /> : null}
      {tab === "jobs" ? <Jobs operator={operator} /> : null}
      {tab === "operations" ? <StuckOperations operator={operator} /> : null}
      {tab === "withdrawals" ? <Withdrawals /> : null}
      {tab === "workers" ? <Workers /> : null}
      {tab === "contract" ? <Contract /> : null}
      {tab === "users" ? <Users operator={operator} /> : null}
      {tab === "tasks" ? <Tasks operator={operator} /> : null}
      {tab === "moderation" ? <Moderation operator={operator} /> : null}
      {tab === "usage" ? <Usage /> : null}
      {tab === "announcements" ? <Announcements operator={operator} /> : null}
      {tab === "audit" ? <Audit /> : null}
    </div>
  );
}

function Overview() {
  const q = useAdmin("/admin/overview");
  if (q.isLoading) return <Loading />;
  if (!q.data) return <p className="text-[13px] text-[var(--danger)]">Overview unavailable.</p>;
  const d = q.data;
  const stats: Array<[string, string]> = [
    ["Tasks", String(d.totals.tasks)],
    ["Users", String(d.totals.users)],
    ["Available", `${near(d.totals.availableYocto)} Ⓝ`],
    ["Reserved", `${near(d.totals.reservedYocto)} Ⓝ`],
    ["Spent", `${near(d.totals.spentYocto)} Ⓝ`],
    ["Withdrawals pending", `${near(d.totals.withdrawalPendingYocto)} Ⓝ`],
    ["Stuck operations", String(d.stuckOperations)],
    ["Open flags", String(d.openFlags)],
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="workspace-panel p-4">
            <p className="text-[11px] text-[var(--foreground-muted)]">{label}</p>
            <p className="financial-value mt-1 text-[20px] font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <Card title="System health" actions={<Button size="sm" variant="ghost" onClick={() => void q.refetch()} loading={q.isFetching}><RefreshCw /> Recheck</Button>}>
        <Table
          head={["Component", "Status", "Detail", "Latency", "Checked"]}
          rows={(d.checks as Any[]).map((check) => [
            check.label,
            <Pill key="s" tone={statusTone(check.status)}>{check.status.replace("_", " ")}</Pill>,
            <span key="d" className="text-[var(--foreground-secondary)]">{check.detail}</span>,
            check.latencyMs != null ? `${check.latencyMs} ms` : "—",
            relative(check.checkedAt),
          ])}
          empty="No checks."
        />
      </Card>
      <Card title="Job queue">
        <Table
          head={["Status", "Count"]}
          rows={Object.entries(d.jobs as Record<string, number>).map(([status, count]) => [<Pill key="s" tone={statusTone(status)}>{status}</Pill>, count])}
          empty="No jobs yet."
        />
      </Card>
    </div>
  );
}

function Jobs({ operator }: { operator: boolean }) {
  const q = useAdmin("/admin/jobs");
  const act = useAction();
  if (q.isLoading) return <Loading />;
  return (
    <Card title="Queued, running, failed and dead-lettered jobs">
      <Table
        head={["Job", "Status", "Attempts", "Task", "Last error", ""]}
        rows={(q.data?.jobs ?? []).map((job: Any) => [
          <span key="k"><span className="font-medium">{job.kind}</span><br /><span className="mono text-[10px] text-[var(--foreground-muted)]">{shortId(job.id, 8, 4)}</span></span>,
          <Pill key="s" tone={statusTone(job.status)}>{job.status}</Pill>,
          `${job.attempts}/${job.maxAttempts}`,
          job.task ? `${job.task.name} · ${job.task.owner}` : "—",
          <span key="e" className="line-clamp-2 max-w-[260px] text-[var(--foreground-secondary)]">{job.lastError ?? "—"}</span>,
          operator ? (
            <span key="a" className="flex gap-1">
              {job.status === "FAILED" || job.status === "DEAD" ? <Button size="sm" variant="secondary" onClick={() => act.mutate({ path: `/admin/jobs/${job.id}/retry` })}>Retry</Button> : null}
              {job.status === "QUEUED" ? <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/admin/jobs/${job.id}/cancel` })}>Cancel</Button> : null}
            </span>
          ) : null,
        ])}
        empty="The queue is clear."
      />
    </Card>
  );
}

function StuckOperations({ operator }: { operator: boolean }) {
  const q = useAdmin("/admin/operations/stuck");
  const act = useAction();
  if (q.isLoading) return <Loading />;
  return (
    <Card title="Operations waiting on a payout callback, recovery or delivery">
      <Table
        head={["Operation", "Task", "Amount", "Payment", "Delivery", "Waiting", ""]}
        rows={(q.data?.operations ?? []).map((op: Any) => [
          <span key="o" className="mono text-[11px]">{shortId(op.operationId, 10, 4)}</span>,
          `${op.task.name} · ${op.task.owner}`,
          `${near(op.amountYocto)} Ⓝ`,
          <Pill key="p" tone={op.paymentState === "PAID" ? "success" : "warning"}>{op.paymentState}</Pill>,
          op.fulfillmentState,
          `${op.ageMinutes} min`,
          operator ? <Button key="a" size="sm" variant="secondary" onClick={() => act.mutate({ path: `/admin/operations/${op.id}/reconcile` })}>Reconcile from chain</Button> : null,
        ])}
        empty="Nothing is stuck."
      />
      <p className="border-t border-[var(--border)] px-5 py-3 text-[11px] text-[var(--foreground-muted)]">
        Reconciling reads the original operation from chain first. It never creates a new payment.
      </p>
    </Card>
  );
}

function Withdrawals() {
  const q = useAdmin("/admin/withdrawals");
  if (q.isLoading) return <Loading />;
  return (
    <Card title="Withdrawals that haven’t settled">
      <Table
        head={["Task", "Owner", "Pending (projection)", "On chain"]}
        rows={(q.data?.withdrawals ?? []).map((row: Any) => [
          row.task.name,
          row.task.owner,
          `${near(row.projectedPendingYocto)} Ⓝ`,
          row.chainPending ? (row.chainPending.length ? row.chainPending.map((w: Any) => `#${w.withdrawal_id}: ${near(w.amount)} Ⓝ`).join(", ") : "settled") : "unreadable",
        ])}
        empty="No pending withdrawals."
      />
    </Card>
  );
}

function Workers() {
  const q = useAdmin("/admin/workers");
  if (q.isLoading) return <Loading />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {(q.data?.workers ?? []).map((worker: Any) => (
        <section key={worker.accountId} className="workspace-panel p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[14px] font-semibold">Agent {worker.slot}</h2>
            <Pill tone={worker.warnings.length ? "warning" : "success"}>{worker.warnings.length ? `${worker.warnings.length} warning(s)` : "healthy"}</Pill>
          </div>
          <p className="mono mt-1 truncate text-[11px] text-[var(--foreground-muted)]">{worker.accountId}</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
            <dt className="text-[var(--foreground-muted)]">Custody</dt><dd>{worker.custody === "outlayer" ? "OutLayer TEE" : "Restricted key"}</dd>
            <dt className="text-[var(--foreground-muted)]">Balance</dt><dd>{worker.balanceNear ?? "—"} Ⓝ</dd>
            <dt className="text-[var(--foreground-muted)]">Key</dt><dd>{worker.keyStatus}</dd>
            <dt className="text-[var(--foreground-muted)]">Gas allowance left</dt><dd>{worker.allowanceNear ? `${worker.allowanceNear} Ⓝ` : "—"}</dd>
            {worker.outlayer ? (<><dt className="text-[var(--foreground-muted)]">OutLayer policy</dt><dd>{worker.outlayer.policy}</dd></>) : null}
          </dl>
          {worker.outlayer ? <p className="mt-2 text-[11px] text-[var(--foreground-muted)]">{worker.outlayer.quota}</p> : null}
          {worker.warnings.map((warning: string) => (
            <p key={warning} className="mt-2 rounded-[8px] bg-[var(--warning-background)] px-2.5 py-1.5 text-[12px] text-[var(--warning)]">{warning}</p>
          ))}
        </section>
      ))}
    </div>
  );
}

function Contract() {
  const q = useAdmin("/admin/contract");
  if (q.isLoading) return <Loading />;
  const d = q.data ?? {};
  return (
    <Card title={`Contract ${d.contractId ?? ""}`}>
      <div className="space-y-3 px-5 py-4 text-[13px]">
        <p className="flex flex-wrap items-center gap-2">
          Code hash
          {d.matches === true ? <Pill tone="success">matches {d.expectedSource}</Pill> : d.matches === false ? <Pill tone="danger">does NOT match {d.expectedSource}</Pill> : <Pill tone="neutral">no expected hash configured</Pill>}
        </p>
        <p className="mono break-all text-[11px] text-[var(--foreground-secondary)]">deployed: {d.deployedCodeHash ?? "—"}<br />expected: {d.expectedCodeHash ?? "—"}</p>
        <p className="text-[12px] text-[var(--foreground-secondary)]">Balance {d.balanceNear ?? "—"} Ⓝ · storage {d.storageBytes ?? "—"} bytes</p>
        <pre className="mono max-h-72 overflow-auto rounded-[8px] bg-[var(--surface-muted)] p-3 text-[11px]">{JSON.stringify(d.config, null, 2)}</pre>
      </div>
    </Card>
  );
}

function Users({ operator }: { operator: boolean }) {
  const q = useAdmin("/admin/users");
  const act = useAction();
  const [account, setAccount] = React.useState("");
  if (q.isLoading) return <Loading />;
  const d = q.data ?? { users: [], allowlist: [], envAllowlist: [] };
  const reason = (label: string) => window.prompt(`Reason to ${label}:`)?.trim();
  return (
    <div className="space-y-6">
      <Card title="Sign-in allowlist">
        <div className="space-y-3 px-5 py-4 text-[13px]">
          <p className="text-[12px] text-[var(--foreground-secondary)]">
            From AUTH_ALLOWED_ACCOUNTS: {d.envAllowlist.length ? d.envAllowlist.join(", ") : "none"}. When both lists are empty, anyone can sign in.
          </p>
          <ul className="space-y-1">
            {d.allowlist.map((row: Any) => (
              <li key={row.accountId} className="flex items-center justify-between gap-3">
                <span className="mono text-[12px]">{row.accountId}</span>
                {operator ? <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: "/admin/allowlist", body: { account_id: row.accountId, remove: true } })}>Remove</Button> : null}
              </li>
            ))}
          </ul>
          {operator ? (
            <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (account) act.mutate({ path: "/admin/allowlist", body: { account_id: account } }); setAccount(""); }}>
              <Input value={account} onChange={(event) => setAccount(event.target.value)} placeholder="account.testnet" className="h-9 max-w-xs" />
              <Button size="sm" type="submit">Add</Button>
            </form>
          ) : null}
        </div>
      </Card>
      <Card title="Accounts">
        <Table
          head={["Account", "Last seen", "Tasks", "Sessions", "Status", ""]}
          rows={d.users.map((user: Any) => [
            <span key="a" className="mono text-[12px]">{user.accountId}{user.admin ? " · admin" : ""}</span>,
            relative(user.lastSeenAt),
            user.tasks,
            user.activeSessions,
            user.suspendedAt ? <Pill key="s" tone="danger">suspended</Pill> : <Pill key="s" tone="success">active</Pill>,
            operator ? (
              <span key="x" className="flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/admin/users/${user.accountId}/revoke-sessions` })}>Revoke sessions</Button>
                {user.suspendedAt ? (
                  <Button size="sm" variant="ghost" onClick={() => { const r = reason("lift the suspension"); if (r) act.mutate({ path: `/admin/users/${user.accountId}/suspend`, body: { reason: r, unsuspend: true } }); }}>Unsuspend</Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => { const r = reason("suspend this account"); if (r) act.mutate({ path: `/admin/users/${user.accountId}/suspend`, body: { reason: r } }); }}>Suspend</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => { const c = window.prompt(`Delete all off-chain data for ${user.accountId}? Type the account id to confirm.`); if (c) act.mutate({ path: `/admin/users/${user.accountId}/delete-data`, body: { confirm: c } }); }}>Delete data</Button>
              </span>
            ) : null,
          ])}
          empty="No accounts yet."
        />
      </Card>
    </div>
  );
}

function Tasks({ operator }: { operator: boolean }) {
  const q = useAdmin("/admin/tasks");
  const act = useAction();
  if (q.isLoading) return <Loading />;
  const d = q.data ?? { tasks: [], totals: {} };
  return (
    <Card title={`All tasks · funded ${near(d.totals.fundedYocto)} Ⓝ · available ${near(d.totals.availableYocto)} · reserved ${near(d.totals.reservedYocto)} · spent ${near(d.totals.spentYocto)}`}>
      <Table
        head={["Task", "Owner", "Status", "Available", "Spent", "Ops", ""]}
        rows={d.tasks.map((task: Any) => [
          <span key="n">{task.name}{task.hiddenAt ? <span className="ml-1"><Pill tone="danger">hidden</Pill></span> : null}</span>,
          task.owner,
          task.status,
          `${near(task.availableYocto)} Ⓝ`,
          `${near(task.spentYocto)} Ⓝ`,
          task.operations,
          operator ? (
            <span key="a" className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => { const r = window.prompt("Reason for flagging:"); if (r) act.mutate({ path: "/admin/flags", body: { task_id: task.id, reason: r } }); }}>Flag</Button>
              <Button size="sm" variant="ghost" onClick={() => { const r = window.prompt(task.hiddenAt ? "Reason to unhide:" : "Reason to hide this task:"); if (r) act.mutate({ path: `/admin/tasks/${task.id}/hide`, body: { reason: r, unhide: Boolean(task.hiddenAt) } }); }}>{task.hiddenAt ? "Unhide" : "Hide"}</Button>
            </span>
          ) : null,
        ])}
        empty="No tasks yet."
      />
    </Card>
  );
}

function Moderation({ operator }: { operator: boolean }) {
  const q = useAdmin("/admin/flags");
  const act = useAction();
  const [documentId, setDocumentId] = React.useState("");
  if (q.isLoading) return <Loading />;
  return (
    <div className="space-y-6">
      <Card title="Flags">
        <Table
          head={["Target", "Reason", "By", "Status", ""]}
          rows={(q.data?.flags ?? []).map((flag: Any) => [
            flag.taskId ? `task ${shortId(flag.taskId, 8, 4)}` : `document ${shortId(flag.documentId, 8, 4)}`,
            flag.reason,
            flag.createdBy,
            <Pill key="s" tone={flag.status === "open" ? "warning" : "neutral"}>{flag.status}</Pill>,
            operator && flag.status === "open" ? <Button key="r" size="sm" variant="ghost" onClick={() => { const r = window.prompt("Resolution:"); if (r) act.mutate({ path: `/admin/flags/${flag.id}/resolve`, body: { resolution: r } }); }}>Resolve</Button> : null,
          ])}
          empty="No flags."
        />
      </Card>
      {operator ? (
        <Card title="Remove a document">
          <form
            className="flex flex-wrap gap-2 px-5 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              const reason = window.prompt("Reason for removing this document:");
              if (documentId && reason) act.mutate({ path: `/admin/documents/${documentId}/remove`, body: { reason } });
            }}
          >
            <Input value={documentId} onChange={(event) => setDocumentId(event.target.value)} placeholder="Document id" className="h-9 max-w-xs" />
            <Button size="sm" variant="destructive" type="submit">Remove document</Button>
            <p className="w-full text-[11px] text-[var(--foreground-muted)]">The encrypted text is wiped; the record stays so purchase evidence still links to it.</p>
          </form>
        </Card>
      ) : null}
    </div>
  );
}

function Usage() {
  const q = useAdmin("/admin/usage");
  if (q.isLoading) return <Loading />;
  const d = q.data ?? {};
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Runs (30 days)", d.totals?.runs],
          ["Tokens", d.totals?.tokens?.toLocaleString?.()],
          ["Private-inference runs", d.privateInference?.runs],
          ["Signatures verified", `${d.privateInference?.verifiedSignatures ?? 0}/${d.privateInference?.totalSignatures ?? 0}`],
        ].map(([label, value]) => (
          <div key={String(label)} className="workspace-panel p-4">
            <p className="text-[11px] text-[var(--foreground-muted)]">{label}</p>
            <p className="mt-1 text-[20px] font-semibold">{value ?? "—"}</p>
          </div>
        ))}
      </div>
      <Card title="By account">
        <Table head={["Account", "Runs", "Live runs", "Tokens"]} rows={(d.byAccount ?? []).map((row: Any) => [row.accountId, row.runs, row.live, row.tokens.toLocaleString()])} empty="No runs in the last 30 days." />
      </Card>
      <Card title={`Worker-action quota (${d.quota?.perHour ?? "—"} per account per hour)`}>
        <Table head={["Account", "Used this hour"]} rows={(d.quota?.usage ?? []).map((row: Any) => [row.accountId, `${row.used}/${row.limit}`])} empty="No quota used this hour." />
      </Card>
      <p className="text-[11px] text-[var(--foreground-muted)]">{d.note}</p>
    </div>
  );
}

function Announcements({ operator }: { operator: boolean }) {
  const q = useAdmin("/admin/announcements");
  const act = useAction();
  const [message, setMessage] = React.useState("");
  const [severity, setSeverity] = React.useState("info");
  if (q.isLoading) return <Loading />;
  return (
    <div className="space-y-6">
      {operator ? (
        <Card title="Post an announcement to all users">
          <form
            className="space-y-3 px-5 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (message.trim().length >= 3) act.mutate({ path: "/admin/announcements", body: { message, severity } });
              setMessage("");
            }}
          >
            <Input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Maintenance tonight 22:00–23:00 UTC; runs may pause." />
            <div className="flex items-center gap-2">
              <select value={severity} onChange={(event) => setSeverity(event.target.value)} className="h-9 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[13px]">
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="danger">Incident</option>
              </select>
              <Button size="sm" variant="action" type="submit">Post</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card title="Announcements">
        <Table
          head={["Message", "Severity", "By", "Status", ""]}
          rows={(q.data?.announcements ?? []).map((row: Any) => [
            row.message,
            row.severity,
            row.createdBy,
            row.active ? <Pill key="s" tone="success">live</Pill> : <Pill key="s" tone="neutral">ended</Pill>,
            operator && row.active ? <Button key="e" size="sm" variant="ghost" onClick={() => act.mutate({ path: `/admin/announcements/${row.id}/end` })}>End</Button> : null,
          ])}
          empty="No announcements."
        />
      </Card>
    </div>
  );
}

function Audit() {
  const q = useAdmin("/admin/audit");
  if (q.isLoading) return <Loading />;
  return (
    <Card title="Admin actions, alerts and deletions">
      <Table
        head={["When", "Type", "Actor", "Summary"]}
        rows={(q.data?.events ?? []).map((event: Any) => [
          relative(event.createdAt),
          <Pill key="t" tone={event.type === "alert.raised" ? "danger" : "neutral"}>{event.type}</Pill>,
          event.actor ?? "—",
          event.summary,
        ])}
        empty="No admin actions yet."
      />
    </Card>
  );
}
