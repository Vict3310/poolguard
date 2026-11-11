import type { Metadata } from "next";
import Link from "next/link";
import { LegalLayout } from "@/components/site/legal-layout";
import { LiveAiProvider } from "@/components/site/live-ai-provider";
import { LEGAL_UPDATED } from "@/lib/site";

export const metadata: Metadata = {
  title: "AI disclosure",
  description: "How PoolGuard uses AI agents, their limits, and what controls spending.",
};

export default function AiDisclosurePage() {
  return (
    <LegalLayout eyebrow="Transparency" title="How PoolGuard uses AI" updated={LEGAL_UPDATED} draft={false}>
      <h2 id="what">Agents are AI</h2>
      <p>
        Each task has two agents. In live mode each agent is an AI model that reads your objective and documents, picks a
        service from the provider’s catalog, and writes a short summary. <LiveAiProvider />
      </p>

      <h2 id="limits">They can make mistakes</h2>
      <ul>
        <li>An agent can misread a document, pick a less suitable service or write a misleading summary.</li>
        <li>Documents are untrusted input. A document can try to manipulate an agent (prompt injection), and it may succeed.</li>
        <li>Check results before relying on them. Extracted fields come from the provider, not from the agent’s summary.</li>
      </ul>

      <h2 id="control">The contract controls spending, not the AI</h2>
      <p>
        The model only chooses a catalog service. Deterministic code computes the amount, recipient and transaction, and the
        PoolGuard contract on NEAR enforces the shared budget, the per-purchase cap and the provider allowlist. An agent
        that is fooled can still only spend what the contract allows.
      </p>

      <h2 id="private">Private inference (when NEAR AI Cloud is used)</h2>
      <p>
        With NEAR AI Cloud, models run inside trusted execution environments. PoolGuard keeps only hashes of each request and
        response and checks NEAR AI’s signature against the signing key in its attestation report. PoolGuard does not verify
        the Intel TDX quote itself; NEAR AI’s verifier does. See the <a href="https://docs.near.ai/cloud">NEAR AI Cloud docs</a>.
      </p>

      <h2 id="scripted">Scripted runs</h2>
      <p>
        When a run is labelled “scripted fixture”, no model was called. We never present a scripted run as AI output.
      </p>

      <h2 id="costs">Costs</h2>
      <p>AI usage is billed by the AI provider to the operator. It is not paid from your task budget.</p>

      <p className="mt-10">
        Related: <Link href="/privacy#ai">what AI providers receive</Link> · <Link href="/terms#ai">terms on AI output</Link>
      </p>
    </LegalLayout>
  );
}
