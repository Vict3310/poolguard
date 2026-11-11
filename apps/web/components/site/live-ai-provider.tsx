"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Names the AI provider this deployment is actually configured with. */
export function LiveAiProvider() {
  const legal = useQuery({
    queryKey: ["legal"],
    queryFn: () =>
      api<{ aiProvider: "near-ai" | "openai-compatible" | null; aiModel: string | null; custody: "local" | "outlayer" }>("/legal"),
    staleTime: 60_000,
  });
  if (legal.isLoading) return <span>Checking this deployment…</span>;
  if (!legal.data) return <span>Unavailable right now.</span>;
  const { aiProvider, aiModel } = legal.data;
  if (!aiProvider) {
    return (
      <span>
        <strong>No AI model is configured.</strong> Runs are labelled “scripted fixture”: agents follow a fixed script and no
        model is called. The contract, payments and provider are still real.
      </span>
    );
  }
  return (
    <span>
      This deployment uses <strong>{aiProvider === "near-ai" ? "NEAR AI Cloud (private inference in TEEs)" : "an OpenAI-compatible provider"}</strong>
      {aiModel ? (
        <>
          {" "}with the model <code>{aiModel}</code>
        </>
      ) : null}
      .
    </span>
  );
}
