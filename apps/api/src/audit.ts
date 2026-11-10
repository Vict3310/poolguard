import type { Prisma, PrismaClient } from "@poolguard/db";
import type { ActivityEvent, ActivityEventType } from "@poolguard/shared";
import { SEVERITY_BY_TYPE } from "@poolguard/shared";

export interface AuditInput {
  taskId?: string | null;
  operationId?: string | null;
  type: ActivityEventType;
  actor?: string | null;
  summary: string;
  severity?: ActivityEvent["severity"];
  data?: Record<string, unknown>;
  dedupeKey?: string | null;
}

function jsonSafe(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function recordAudit(
  prisma: PrismaClient,
  input: AuditInput,
): Promise<ActivityEvent> {
  const data = input.data ?? {};
  const severity = input.severity ?? SEVERITY_BY_TYPE[input.type] ?? "neutral";
  try {
    const row = await prisma.auditEvent.create({
      data: {
        taskId: input.taskId ?? null,
        operationId: input.operationId ?? null,
        type: input.type,
        actor: input.actor ?? null,
        summary: input.summary.slice(0, 500),
        severity,
        data: jsonSafe(data),
        dedupeKey: input.dedupeKey ?? null,
      },
    });
    return toActivityEvent(row);
  } catch (error) {
    if (input.dedupeKey && (error as { code?: string }).code === "P2002") {
      const existing = await prisma.auditEvent.findUnique({ where: { dedupeKey: input.dedupeKey } });
      if (existing) return toActivityEvent(existing);
    }
    throw error;
  }
}

export function toActivityEvent(row: {
  id: bigint;
  taskId: string | null;
  operationId: string | null;
  type: string;
  actor: string | null;
  summary: string;
  severity: string;
  data: unknown;
  createdAt: Date;
}): ActivityEvent {
  return {
    id: row.id.toString(),
    taskId: row.taskId,
    operationId: row.operationId,
    type: row.type as ActivityEvent["type"],
    actor: row.actor,
    summary: row.summary,
    severity: row.severity as ActivityEvent["severity"],
    data: (row.data && typeof row.data === "object" ? row.data : {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  };
}
