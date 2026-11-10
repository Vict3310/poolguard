import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { CopyablePre, DocsToc, ReadingProgress } from "@/components/docs-interactions";

const TOC = [
  { href: "#overview", label: "Overview" },
  { href: "#architecture", label: "Architecture" },
  { href: "#contract", label: "Contract invariants" },
  { href: "#states", label: "States and recovery" },
  { href: "#keys", label: "Keys and authority" },
  { href: "#sdk", label: "SDK" },
  { href: "#limitations", label: "Limitations" },
];

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-[var(--border)] py-8 first:border-t-0 first:pt-0">
      <h2 className="text-[22px] font-semibold tracking-[-0.025em]">{title}</h2>
      <div className="prose-quiet mt-3 space-y-3 text-[14px] leading-7">{children}</div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-[4px] bg-[var(--surface-muted)] px-1.5 py-0.5 font-mono text-[12px]">
      {children}
    </code>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-dvh bg-[var(--background)]">
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--background)]/92 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1160px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Brand />
            <span className="hidden text-[12px] text-[var(--foreground-muted)] sm:inline">Documentation</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="hidden text-[12px] text-[var(--foreground-secondary)] hover:text-[var(--foreground)] sm:inline">
              Home
            </Link>
            <Button asChild size="sm" className="h-9">
              <Link href="/app">Open app <ArrowRight /></Link>
            </Button>
          </div>
        </div>
      </header>

      <ReadingProgress />
      <main id="main" className="mx-auto grid max-w-[1160px] gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav aria-label="Documentation sections" className="sticky top-24 space-y-0.5">
            <DocsToc items={TOC} />
            <p className="mt-4 px-2.5 text-[10px] leading-4 text-[var(--foreground-muted)]">
              The repository contains the full ARCHITECTURE, THREAT_MODEL, CONTRACT_INVARIANTS,
              STATE_MACHINE and DEPLOYMENT documents.
            </p>
          </nav>
        </aside>

        <article className="max-w-[760px] min-w-0">
          <p className="eyebrow">PoolGuard documentation</p>
          <h1 className="mt-3 text-[32px] font-semibold leading-[1.15] tracking-[-0.035em] sm:text-[40px]">
            A shared budget, enforced where it counts.
          </h1>
          <p className="mt-3 text-[15px] leading-7 text-[var(--foreground-secondary)]">
            PoolGuard is an experimental NEAR testnet application. It demonstrates contract-enforced
            spending limits for multiple autonomous agents working on one task. It is not audited and
            must not custody real value.
          </p>

          <div className="mt-4 inline-flex flex-wrap items-center gap-2 rounded-[6px] bg-[var(--warning-background)] px-3 py-2 text-[11px] leading-4 text-[var(--warning)]">
            Testnet only · native testNEAR · operator-controlled provider catalog · fixed prices
          </div>

          <div className="mt-8">
            <Section id="overview" title="Overview">
              <p>
                An owner creates a task with a name, objective, two encrypted input documents, a
                budget, a per-purchase cap, approved providers, a reservation lifetime and an expiry
                block. Two worker accounts are registered with restricted function-call keys.
              </p>
              <p>
                Each worker reads one document and chooses a service from the provider catalog. The
                service price, provider account, operation ID and transaction payload are constructed
                by deterministic server code. The contract accepts or rejects the reservation. Only
                after a successful reservation can the worker dispatch exactly one transfer.
              </p>
              <p>
                The paid extraction service verifies finalized payment independently, processes the
                document and stores the structured result under the operation key. Payment and
                delivery are displayed as separate states.
              </p>
            </Section>

            <Section id="architecture" title="Architecture">
              <p>
                The smart contract is the authority for all financial state. PostgreSQL stores
                application metadata, documents encrypted at rest, durable jobs, provider results and
                a projection of chain state. Balances displayed in the UI come from contract views.
                If an RPC read fails, the interface keeps the last verified projection and labels it;
                it never invents a zero balance.
              </p>
              <div className="not-prose overflow-x-auto">
                <table className="mt-4 w-full min-w-[520px] border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="py-2 pr-4 font-medium">Component</th>
                      <th className="py-2 font-medium">Authority</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {[
                      ["Rust contract", "Task policy, balances, reservations, payouts, withdrawal accounting"],
                      ["Fastify API", "Auth sessions, task metadata, plans, projections, SSE"],
                      ["Worker", "Durable jobs, signing with worker keys, chain reconciliation, provider calls"],
                      ["Provider", "Payment verification, extraction, operation-keyed result storage"],
                      ["Web app", "Presentation only; owner actions are signed in the wallet"],
                    ].map(([component, authority]) => (
                      <tr key={component} className="align-top">
                        <td className="py-2.5 pr-4 font-medium">{component}</td>
                        <td className="py-2.5 text-[var(--foreground-secondary)]">{authority}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                NEAR is useful here because the contract can hold native tokens, call a provider with a
                scheduled transfer and receive a private callback in the same flow. Human-readable
                account IDs and function-call keys make worker authority narrow and auditable.
              </p>
              <p>
                A database alone would be simpler and is sufficient for internal-only deployments
                where every spender is trusted. It cannot give multiple mutually suspicious agents a
                shared budget whose enforcement does not depend on the database or the application
                server.
              </p>
            </Section>

            <Section id="contract" title="Contract invariants">
              <p>The contract maintains one conservation invariant per funded task:</p>
              <CopyablePre className="scrollbar-quiet overflow-x-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4 font-mono text-[12px] leading-6">
{`total_funded =
  available + reserved + spent + withdrawn + withdrawal_pending`}
              </CopyablePre>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>All amounts are integer yoctoNEAR and all arithmetic is checked.</li>
                <li>A reservation moves funds from available to reserved; it creates no transfer.</li>
                <li>Before dispatch, the operation enters <Code>PAYOUT_PENDING</Code> and its payout attempt count increments.</li>
                <li>Only finalized chain evidence and the private callback can settle or fail a payout.</li>
                <li>A timeout is never treated as proof of failure; pending funds remain reserved.</li>
                <li>Storage deposits and contract operational funds are never part of task spending balances.</li>
                <li>Reservations can expire only before payout dispatch. A permissionless expirer cannot cancel a live reservation.</li>
                <li>Operation records are bounded; workers cannot create unbounded state at the owner&apos;s expense.</li>
              </ul>
              <p>
                <Code>expire_reservation</Code> is permissionless but only acts when the operation is
                still <Code>reserved</Code> and the block height is past its reservation deadline. The
                transfer callback is private and idempotent.
              </p>
            </Section>

            <Section id="states" title="States and recovery">
              <p>
                Payment states: <Code>reserved</Code>, <Code>payout_pending</Code>, <Code>paid</Code>,{" "}
                <Code>payout_failed</Code>, <Code>cancelled</Code>, <Code>expired</Code>. Fulfillment
                states: <Code>not_requested</Code>, <Code>processing</Code>, <Code>delivered</Code>,{" "}
                <Code>delivery_failed</Code>, <Code>unknown</Code>.
              </p>
              <p>
                Every logical purchase has a stable operation ID derived from a canonical binding:
                network, contract, task, agent, provider, amount, service, request hash, output-schema
                hash, policy version and expiry. Retrying the same purchase reuses that ID. Reuse with
                altered arguments is rejected by the contract.
              </p>
              <p>
                Transactions are signed and their hashes persisted before broadcast. If the response is
                lost, the worker looks up that hash and the same operation on chain. It never &quot;recovers&quot;
                by creating a new payment. A crashed worker&apos;s job lease expires, another worker
                re-claims it, and the operation is reconciled from chain evidence.
              </p>
              <p>
                The guarantee is <strong>at-most-once payout through the contract</strong>, plus
                cooperative provider deduplication and stored results. Universal exactly-once execution
                across a blockchain and an off-chain service is not promised.
              </p>
            </Section>

            <Section id="keys" title="Keys and authority">
              <div className="not-prose overflow-x-auto">
                <table className="mt-2 w-full min-w-[580px] border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="py-2 pr-4 font-medium">Key</th>
                      <th className="py-2 pr-4 font-medium">Location</th>
                      <th className="py-2 font-medium">Authority</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {[
                      ["Owner wallet key", "User wallet / extension", "Fund, pause, resume, withdraw, revoke, update policy"],
                      ["Contract deployment key", "Deployment environment, outside the app", "Deploy and initialize the contract"],
                      ["Worker one key", "Worker process env", "Reserve, execute, cancel; restricted function-call key"],
                      ["Worker two key", "Worker process env", "Same as worker one, separate account and nonce"],
                      ["Sandbox owner key", "Local .env only (never testnet)", "Local owner actions for reproducible demos"],
                      ["Session/CSRF secrets", "API env", "Authentication transport only; no chain authority"],
                      ["Document encryption key", "API/worker env", "AES-256-GCM document encryption at rest"],
                    ].map(([key, location, authority]) => (
                      <tr key={key} className="align-top">
                        <td className="py-2.5 pr-4 font-medium">{key}</td>
                        <td className="py-2.5 pr-4 text-[var(--foreground-secondary)]">{location}</td>
                        <td className="py-2.5 text-[var(--foreground-secondary)]">{authority}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                Function-call key allowances limit gas expenditure. They do not enforce the purchase
                budget. Owner funding must happen through the owner wallet; function-call keys cannot
                attach NEAR.
              </p>
              <p>
                The backend and the model never receive the owner private key. Owner configuration
                transactions are built by the API as unsigned plans and signed by the wallet. The API
                verifies the chain outcome before updating its projection.
              </p>
            </Section>

            <Section id="sdk" title="SDK">
              <p>
                The TypeScript SDK is a thin typed client over the API. Amounts are strings in
                yoctoNEAR. Browser sessions use cookies and the CSRF header; a server caller can pass its
                own fetch implementation.
              </p>
              <CopyablePre className="scrollbar-quiet overflow-x-auto rounded-[8px] border border-[var(--border)] bg-[#20211f] p-4 font-mono text-[11px] leading-6 text-[#e9eae5]">
{`import { PoolGuard } from "@poolguard/sdk";

const guard = new PoolGuard({
  baseUrl: "http://127.0.0.1:4100",
  fetch: sessionFetch, // must preserve cookies + x-poolguard-csrf
});

const task = await guard.getTask(taskId);
const budget = await guard.getBudget(taskId);

const reservation = await guard.reservePurchase(taskId, {
  agentAccountId: task.agents[0].accountId,
  serviceKey: "doc-extract",
});

await guard.executePurchase(reservation.operationId);
const result = await guard.getResult(reservation.operationId);`}
              </CopyablePre>
              <p>
                Reserve and execute endpoints return operation IDs and payment states. Recovery is
                explicit: <Code>recoverOperation(operationId)</Code> queues reconciliation of the original
                operation. There is no SDK method that means &quot;pay again&quot;.
              </p>
            </Section>

            <Section id="limitations" title="Limitations">
              <ul className="list-disc space-y-1.5 pl-5">
                <li>Testnet only. Native testNEAR only. No mainnet, stablecoins or custom tokens.</li>
                <li>Not audited. The contract is a focused MVP, not production custody software.</li>
                <li>The provider catalog has fixed operator-set prices. Quotes are not cryptographically signed.</li>
                <li>The provider is operator-controlled and trusted to return honest extraction output.</li>
                <li>Provider deduplication is cooperative; a crash during processing can recompute a result.</li>
                <li>Documents are encrypted at rest, but request hashes and metadata are visible on chain.</li>
                <li>Model inference costs are billed to the API operator and are outside the on-chain budget.</li>
                <li>Scripted fixture runs are clearly labelled and are not evidence of live AI behavior.</li>
                <li>Sandbox transactions have no public explorer and are not testnet adoption evidence.</li>
              </ul>
            </Section>

            <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-6">
              <Button asChild>
                <Link href="/app">Open the workspace <ArrowRight /></Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/app/demo">Open the demo lab</Link>
              </Button>
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--foreground-muted)]">
                <ExternalLink className="size-3" /> Full operational docs live in the repository.
              </span>
            </div>
          </div>
        </article>
      </main>
    </div>
  );
}
