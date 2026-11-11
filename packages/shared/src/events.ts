import { z } from "zod";

export const ACTIVITY_EVENT_TYPES = [
  "task.created",
  "task.funded",
  "task.paused",
  "task.resumed",
  "policy.updated",
  "agent.registered",
  "agent.revoked",
  "agent.run.started",
  "agent.step",
  "agent.finished",
  "operation.reserved",
  "operation.denied",
  "operation.recovered",
  "probe.unavailable",
  "payment.dispatched",
  "payment.settled",
  "payment.failed",
  "reservation.cancelled",
  "reservation.expired",
  "fulfillment.processing",
  "fulfillment.delivered",
  "fulfillment.failed",
  "recovery.started",
  "recovery.resolved",
  "withdrawal.dispatched",
  "withdrawal.settled",
  "withdrawal.failed",
  "demo.fault_injected",
  "demo.scenario.started",
  "demo.scenario.finished",
  "sync.completed",
  "ai.private_inference",
  "account.consented",
  "account.data_exported",
  "account.data_deleted",
  "account.sessions_revoked",
  "admin.action",
  "alert.raised",
] as const;
export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

export const activityEventTypeSchema = z.enum(ACTIVITY_EVENT_TYPES);

export const activityEventSchema = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  operationId: z.string().nullable(),
  type: activityEventTypeSchema,
  actor: z.string().nullable(),
  summary: z.string(),
  severity: z.enum(["neutral", "info", "success", "warning", "danger"]),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type ActivityEvent = z.infer<typeof activityEventSchema>;

export const sseEnvelopeSchema = z.object({
  id: z.string(),
  event: z.literal("activity"),
  data: activityEventSchema,
});
export type SseEnvelope = z.infer<typeof sseEnvelopeSchema>;

export const taskLifecycleSchema = z.enum([
  "awaiting_funding",
  "active",
  "paused",
  "expired",
  "completed",
]);
export type TaskLifecycle = z.infer<typeof taskLifecycleSchema>;

export function deriveTaskLifecycle(input: {
  paused: boolean;
  totalFunded: string;
  available: string;
  reserved: string;
  currentBlock: number;
  expiresAtBlock: number;
}): TaskLifecycle {
  if (input.totalFunded === "0") return "awaiting_funding";
  if (input.paused) return "paused";
  if (input.currentBlock > input.expiresAtBlock) return "expired";
  if (input.available === "0" && input.reserved === "0") return "completed";
  return "active";
}

export const SEVERITY_BY_TYPE: Record<ActivityEventType, ActivityEvent["severity"]> = {
  "task.created": "neutral",
  "task.funded": "success",
  "task.paused": "warning",
  "task.resumed": "neutral",
  "policy.updated": "warning",
  "agent.registered": "neutral",
  "agent.revoked": "warning",
  "agent.run.started": "info",
  "agent.step": "neutral",
  "agent.finished": "success",
  "operation.reserved": "warning",
  "operation.denied": "danger",
  "operation.recovered": "warning",
  "probe.unavailable": "warning",
  "payment.dispatched": "warning",
  "payment.settled": "success",
  "payment.failed": "danger",
  "reservation.cancelled": "neutral",
  "reservation.expired": "neutral",
  "fulfillment.processing": "info",
  "fulfillment.delivered": "success",
  "fulfillment.failed": "danger",
  "recovery.started": "warning",
  "recovery.resolved": "success",
  "withdrawal.dispatched": "warning",
  "withdrawal.settled": "success",
  "withdrawal.failed": "danger",
  "demo.fault_injected": "warning",
  "demo.scenario.started": "info",
  "demo.scenario.finished": "success",
  "sync.completed": "neutral",
  "ai.private_inference": "success",
  "account.consented": "neutral",
  "account.data_exported": "info",
  "account.data_deleted": "warning",
  "account.sessions_revoked": "warning",
  "admin.action": "info",
  "alert.raised": "danger",
};
