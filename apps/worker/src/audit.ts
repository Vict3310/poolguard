import type { Prisma, PrismaClient } from "@poolguard/db";
import { SEVERITY_BY_TYPE, type ActivityEventType } from "@poolguard/shared";

export async function recordAudit(
  prisma: PrismaClient,
  input: {
    taskId: string;
    operationId?: string | null;
    type: ActivityEventType;
    actor?: string | null;
    summary: string;
    severity?: "success" | "warning" | "danger" | "neutral";
    data?: Record<string, unknown>;
    dedupeKey?: string;
  },
): Promise<void> {
  const severity = input.severity ?? SEVERITY_BY_TYPE[input.type] ?? "neutral";
  try {
    await prisma.auditEvent.create({
      data: {
        taskId: input.taskId,
        operationId: input.operationId ?? null,
        type: input.type,
        actor: input.actor ?? null,
        summary: input.summary.slice(0, 500),
        severity,
        data: JSON.parse(JSON.stringify(input.data ?? {})) as Prisma.InputJsonValue,
        dedupeKey: input.dedupeKey ?? null,
      },
    });
  } catch (error) {
    // Deduplication is intentional: a retried job must not duplicate the timeline.
    if (input.dedupeKey && (error as { code?: string }).code === "P2002") return;
    throw error;
  }
}
