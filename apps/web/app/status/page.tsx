import type { Metadata } from "next";
import { LegalLayout } from "@/components/site/legal-layout";
import { StatusBoard } from "@/components/site/status-board";

export const metadata: Metadata = {
  title: "Status",
  description: "Live status of the PoolGuard API, worker, provider, chain and AI services.",
};

export default function StatusPage() {
  return (
    <LegalLayout eyebrow="Status" title="Service status" updated="live" draft={false}>
      <StatusBoard />
      <p className="mt-6 text-[13px]">
        Checks run on the server at most every 30 seconds. “Not in use” means that part is switched off in this deployment,
        for example OutLayer custody or a live AI model.
      </p>
    </LegalLayout>
  );
}
