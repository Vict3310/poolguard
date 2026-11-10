"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { TaskWizard } from "@/components/task-wizard";
import { Button } from "@/components/ui/button";
import { useTaskSetup } from "@/lib/use-task-setup";

export default function CreateTaskPage() {
  const router = useRouter();
  const setup = useTaskSetup({
    onFunded: async (taskId) => {
      const { toast } = await import("sonner");
      toast.success("Task funded and live", { description: "Both agents are registered against its policy." });
      router.push(`/app/tasks/${taskId}`);
    },
  });

  return (
    <div className="mx-auto max-w-[1120px]">
      <PageHeader
        title={setup.phase === "review" && setup.created ? setup.created.name : "Create task"}
        description={
          setup.phase === "review" && setup.created
            ? "The draft is saved. The contract still needs the owner’s signature."
            : "Four short steps. The policy is written to the contract and applies to every agent on this task."
        }
        actions={
          <Button variant="ghost" asChild>
            <Link href="/app/tasks">
              <ArrowLeft /> Tasks
            </Link>
          </Button>
        }
      />
      <div className="mt-6">
        <TaskWizard setup={setup} />
      </div>
    </div>
  );
}
