"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { OperationDetail } from "@/components/operation-drawer";
import { StatusScreen } from "@/components/status-screen";
import { Button } from "@/components/ui/button";
import { TaskDetailSkeleton } from "@/components/route-skeletons";
import { api, ApiError } from "@/lib/api";
import type { Operation } from "@/lib/types";

/** A shareable, full-page view of one purchase: reservation, payment, delivery and evidence. */
export default function OperationPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const query = useQuery({
    queryKey: ["operation", id],
    queryFn: () => api<{ operation: Operation }>(`/operations/${id}`).then((value) => value.operation),
    refetchInterval: (state) => {
      const value = state.state.data;
      return value && (value.needsRecovery || value.paymentState === "payout_pending") ? 2_000 : false;
    },
  });

  if (query.isLoading) return <TaskDetailSkeleton />;
  if (query.error || !query.data) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <StatusScreen
        framed={false}
        code={notFound ? "404" : "!"}
        title={notFound ? "No purchase with this id." : "This purchase couldn’t load."}
        body={
          notFound
            ? "It may belong to another account, or the link is incomplete."
            : query.error instanceof ApiError
              ? query.error.message
              : "Try again in a moment."
        }
        actions={
          <>
            {!notFound ? <Button onClick={() => void query.refetch()}>Try again</Button> : null}
            <Button variant="secondary" asChild>
              <Link href="/app/activity">Open activity</Link>
            </Button>
          </>
        }
      />
    );
  }
  const operation = query.data;
  return (
    <div className="mx-auto max-w-[760px]">
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
        <Link href={`/app/tasks/${operation.taskId}`}>
          <ArrowLeft /> Back to task
        </Link>
      </Button>
      <div className="workspace-panel overflow-hidden">
        <OperationDetail operation={operation} variant="page" />
      </div>
    </div>
  );
}
