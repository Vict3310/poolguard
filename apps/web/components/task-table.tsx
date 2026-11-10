import Link from "next/link";
import { ArrowUpRight, Users } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { near, relative, shortId } from "@/lib/utils";
import type { TaskSummary } from "@/lib/types";

export function TaskTable({ tasks }: { tasks: TaskSummary[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {["Task", "Agents", "Available", "Reserved", "Status", "Updated", ""].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className={`py-2.5 text-[11px] font-medium text-[var(--foreground-muted)] ${
                    heading === "Available" || heading === "Reserved" ? "text-right" : ""
                  } ${heading === "" ? "w-10" : ""}`}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {tasks.map((task) => (
              <tr key={task.id} className="group h-[62px] transition-colors duration-150 hover:bg-[var(--surface-hover)]">
                <td className="max-w-[340px] py-2 pr-4">
                  <Link href={`/app/tasks/${task.id}`} className="block">
                    <span className="block truncate text-[13px] font-medium text-[var(--foreground)] group-hover:underline">
                      {task.name}
                    </span>
                    <span className="mono mt-0.5 block truncate text-[10px] text-[var(--foreground-muted)]">
                      {task.chainTaskId}
                    </span>
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--foreground-secondary)]">
                    <Users className="size-3.5 text-[var(--foreground-muted)]" />
                    {task.agentCount}
                  </span>
                </td>
                <td className="financial-value py-2 pr-4 text-right text-[13px]">{near(task.availableYocto)}</td>
                <td className="financial-value py-2 pr-4 text-right text-[13px] text-[var(--foreground-secondary)]">
                  {near(task.reservedYocto)}
                </td>
                <td className="py-2 pr-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge kind="task" value={task.status} />
                    {task.pendingRecoveries > 0 ? (
                      <span className="rounded-[4px] bg-[var(--warning-background)] px-1.5 py-1 text-[10px] font-medium text-[var(--warning)]">
                        {task.pendingRecoveries} to check
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="py-2 pr-2 text-[12px] text-[var(--foreground-muted)]">{relative(task.updatedAt)}</td>
                <td className="py-2 text-right">
                  <Link
                    href={`/app/tasks/${task.id}`}
                    aria-label={`Open ${task.name}`}
                    className="inline-flex size-8 items-center justify-center rounded-[6px] text-[var(--foreground-muted)] hover:bg-[var(--surface-selected)] hover:text-[var(--foreground)]"
                  >
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-[var(--border)] md:hidden">
        {tasks.map((task) => (
          <li key={task.id}>
            <Link href={`/app/tasks/${task.id}`} className="block px-4 py-4 hover:bg-[var(--surface-hover)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium">{task.name}</p>
                  <p className="mono mt-0.5 truncate text-[10px] text-[var(--foreground-muted)]">
                    {shortId(task.chainTaskId, 18, 6)}
                  </p>
                </div>
                <StatusBadge kind="task" value={task.status} />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <dt className="text-[var(--foreground-muted)]">Agents</dt>
                  <dd className="mt-0.5 font-medium">{task.agentCount}</dd>
                </div>
                <div>
                  <dt className="text-[var(--foreground-muted)]">Available</dt>
                  <dd className="financial-value mt-0.5 font-medium">{near(task.availableYocto)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--foreground-muted)]">Reserved</dt>
                  <dd className="financial-value mt-0.5 font-medium">{near(task.reservedYocto)}</dd>
                </div>
              </dl>
              <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--foreground-muted)]">
                <span>Updated {relative(task.updatedAt)}</span>
                {task.pendingRecoveries > 0 ? (
                  <span className="text-[var(--warning)]">{task.pendingRecoveries} to check</span>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
