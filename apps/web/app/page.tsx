import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleCheck,
  Clock3,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { ProductWindow } from "@/components/landing/product-window";
import { CopyCode, Magnetic, Reveal, RevealGroup, RevealItem, ScrollHeader, StaggerWords } from "@/components/landing/motion";

const SDK_EXAMPLE = `import { PoolGuard } from "@poolguard/sdk";

const guard = new PoolGuard({
  baseUrl: "http://127.0.0.1:4100",
  fetch: sessionFetch,
});

const task = await guard.getTask(taskId);
const budget = await guard.getBudget(taskId);

const reservation = await guard.reservePurchase(taskId, {
  agentAccountId: task.agents[0].accountId,
  serviceKey: "doc-extract",
});

// The same operation id survives every transport retry.
await guard.executePurchase(reservation.operationId);
const operation = await guard.getOperation(reservation.operationId);
const result = await guard.getResult(reservation.operationId);`;

function TestnetNote({ className }: { className?: string }) {
  return (
    <p className={className}>
      NEAR testnet prototype. Test tokens have no monetary value. Not audited.
    </p>
  );
}

function Benefit({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-[var(--border)] pt-5">
      <span className="mono text-[11px] text-[var(--foreground-muted)]">{number}</span>
      <h3 className="mt-2 text-[17px] font-semibold tracking-[-0.02em]">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[14px] leading-6 text-[var(--foreground-secondary)]">{children}</p>
    </div>
  );
}

function PolicyMock() {
  return (
    <div className="workspace-panel lift p-4 sm:p-5">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
        <div>
          <p className="text-[12px] font-semibold">Policy</p>
          <p className="text-[10px] text-[var(--foreground-muted)]">Written to the contract</p>
        </div>
        <span className="rounded-[4px] bg-[var(--surface-muted)] px-2 py-1 text-[10px] text-[var(--foreground-secondary)]">
          v1
        </span>
      </div>
      <dl className="divide-y divide-[var(--border)]">
        {[
          ["Budget", "0.03 testNEAR"],
          ["Per-purchase limit", "0.02 testNEAR"],
          ["Allowed provider", "extract…near"],
          ["Reservation lifetime", "300 blocks"],
          ["Authorized agents", "2 restricted keys"],
        ].map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-2.5 text-[11px]">
            <dt className="text-[var(--foreground-muted)]">{label}</dt>
            <dd className="financial-value font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex items-center gap-2 rounded-[6px] bg-[var(--surface-muted)] px-2.5 py-2 text-[10px] leading-4 text-[var(--foreground-secondary)]">
        <ShieldCheck className="size-3.5 shrink-0 text-[var(--accent)]" />
        The model never supplies recipients or amounts. It chooses a catalog service key only.
      </div>
    </div>
  );
}

function TimelineMock() {
  return (
    <div className="workspace-panel lift p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-semibold">Operation evidence</p>
          <p className="mono text-[10px] text-[var(--foreground-muted)]">doc-extract-v1 · 0.02 testNEAR</p>
        </div>
        <span className="rounded-[4px] bg-[var(--success-background)] px-1.5 py-1 text-[9px] font-medium text-[var(--success)]">
          Paid
        </span>
      </div>
      <ol className="mt-4">
        {[
          { title: "Requested", detail: "Agent one · policy v1", done: true },
          { title: "Reserved", detail: "Contract held 0.02 from the shared pool", done: true },
          { title: "Payment settled", detail: "One transfer · callback finalized", done: true },
          { title: "Result delivered", detail: "Provider verified payment, returned stored extraction", done: true },
        ].map((step, index, all) => (
          <li key={step.title} className="relative flex gap-3 pb-4 last:pb-0">
            {index < all.length - 1 ? (
              <span className="absolute left-[11px] top-6 h-[calc(100%-16px)] w-px bg-[var(--border)]" />
            ) : null}
            <span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--success-background)] text-[var(--success)]">
              <Check className="size-3" />
            </span>
            <div>
              <p className="text-[11px] font-medium">{step.title}</p>
              <p className="mt-0.5 text-[10px] leading-4 text-[var(--foreground-muted)]">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-1 flex items-center gap-2 rounded-[6px] border border-[var(--border)] px-2.5 py-2 text-[10px] leading-4 text-[var(--foreground-secondary)]">
        <KeyRound className="size-3.5 shrink-0 text-[var(--foreground-muted)]" />
        Payment and delivery remain separate. A paid operation can still have a failed delivery.
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-[var(--background)]">
      <ScrollHeader className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--background)]/92 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1160px] items-center justify-between px-4 sm:px-6">
          <Brand />
          <nav aria-label="Marketing" className="hidden items-center gap-7 md:flex">
            <a href="#how-it-works" className="text-[13px] text-[var(--foreground-secondary)] transition-colors hover:text-[var(--foreground)]">
              How it works
            </a>
            <a href="#developers" className="text-[13px] text-[var(--foreground-secondary)] hover:text-[var(--foreground)]">
              Developers
            </a>
            <Link href="/docs" className="text-[13px] text-[var(--foreground-secondary)] hover:text-[var(--foreground)]">
              Docs
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" className="h-9">
              <Link href="/app">
                Open app <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </ScrollHeader>

      <main id="main">
        <section className="mx-auto max-w-[1160px] px-4 pb-10 pt-14 sm:px-6 sm:pb-14 sm:pt-20">
          <div className="mx-auto max-w-[820px] text-center">
            <Reveal y={8}>
              <p className="eyebrow">Agent spending, under control</p>
            </Reveal>
            <StaggerWords
              lines={["One task budget.", "Multiple agents."]}
              className="mt-4 text-[42px] font-medium leading-[1.03] tracking-[-0.045em] sm:text-[58px] lg:text-[70px]"
            />
            <Reveal delay={0.35}>
              <p className="mx-auto mt-5 max-w-[560px] text-[16px] leading-7 text-[var(--foreground-secondary)] sm:text-[17px]">
                Let agents buy the tools they need, with shared limits, approved providers, and a clear
                record of every payment.
              </p>
            </Reveal>
            <Reveal delay={0.45}>
              <div className="mt-7 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
                <Magnetic className="w-full sm:w-auto">
                  <Button asChild size="lg" className="w-full sm:w-auto">
                    <Link href="/app">
                      Open PoolGuard <ArrowRight />
                    </Link>
                  </Button>
                </Magnetic>
                <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto">
                  <Link href="/app/demo">
                    <Play /> Watch the demo
                  </Link>
                </Button>
              </div>
              <TestnetNote className="mt-4 text-[11px] text-[var(--foreground-muted)]" />
            </Reveal>
          </div>

          <Reveal className="mx-auto mt-10 max-w-[1060px] sm:mt-12" delay={0.55} y={24}>
            <ProductWindow />
            <p className="mt-3 text-center text-[10px] text-[var(--foreground-muted)]">
              Illustrative task built with original HTML/CSS. Plays when visible. Not live chain evidence.
            </p>
          </Reveal>
        </section>

        <section id="how-it-works" className="mx-auto max-w-[1160px] scroll-mt-20 px-4 py-14 sm:px-6 sm:py-20">
          <Reveal className="max-w-[640px]">
            <p className="eyebrow">Why it works</p>
            <h2 className="mt-3 text-[30px] font-medium leading-[1.15] tracking-[-0.035em] sm:text-[40px]">
              Autonomy inside a boundary you set.
            </h2>
          </Reveal>
          <RevealGroup className="mt-10 grid gap-8 sm:grid-cols-3 sm:gap-8">
            <RevealItem>
            <Benefit number="01" title="A shared limit">
              Parallel agents reserve from one pool. The contract serializes reservations, so two
              agents cannot both spend the same remaining balance.
            </Benefit>
            </RevealItem>
            <RevealItem>
            <Benefit number="02" title="Clear authority">
              Approved providers, a per-purchase cap and registered worker keys are enforced on chain.
              The model selects a service; it never writes the transfer.
            </Benefit>
            </RevealItem>
            <RevealItem>
            <Benefit number="03" title="Recoverable payments">
              The operation ID is stable across retries. After a timeout or restart, PoolGuard checks
              the original operation before doing anything else.
            </Benefit>
            </RevealItem>
          </RevealGroup>
        </section>

        <section className="border-y border-[var(--border)] bg-[var(--surface)]">
          <div className="mx-auto max-w-[1160px] space-y-16 px-4 py-14 sm:px-6 sm:py-20 lg:space-y-24">
            <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
              <div>
                <p className="eyebrow">Step one</p>
                <h2 className="mt-3 text-[28px] font-medium leading-[1.18] tracking-[-0.035em] sm:text-[38px]">
                  Set the task and its boundaries.
                </h2>
                <p className="mt-3 max-w-lg text-[15px] leading-7 text-[var(--foreground-secondary)]">
                  A task has one objective, one budget and one policy. The owner funds it from their
                  wallet; worker accounts get restricted function-call keys that can only reach the
                  task methods.
                </p>
                <ul className="mt-5 space-y-2.5">
                  {[
                    "Storage deposits stay separate from spendable funds.",
                    "Key allowances limit gas, not the purchase budget.",
                    "The backend never receives owner signing authority.",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-[13px] leading-6 text-[var(--foreground-secondary)]">
                      <Check className="mt-1 size-3.5 shrink-0 text-[var(--accent)]" /> {item}
                    </li>
                  ))}
                </ul>
              </div>
              <Reveal delay={0.1}>
                <PolicyMock />
              </Reveal>
            </div>

            <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
              <div className="lg:order-2">
                <p className="eyebrow">Step two</p>
                <h2 className="mt-3 text-[28px] font-medium leading-[1.18] tracking-[-0.035em] sm:text-[38px]">
                  Follow every purchase from request to result.
                </h2>
                <p className="mt-3 max-w-lg text-[15px] leading-7 text-[var(--foreground-secondary)]">
                  A reservation is not a payment. A payment is not a delivery. The interface keeps
                  those states distinct, with the exact operation ID, hashes and transaction evidence
                  one click away.
                </p>
                <ul className="mt-5 space-y-2.5">
                  {[
                    "A denial is a stable machine code, not a silent failure.",
                    "A dropped response is reconciled, never treated as a new purchase.",
                    "The provider independently verifies finalized payment before returning data.",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-[13px] leading-6 text-[var(--foreground-secondary)]">
                      <Check className="mt-1 size-3.5 shrink-0 text-[var(--accent)]" /> {item}
                    </li>
                  ))}
                </ul>
              </div>
              <Reveal className="lg:order-1" delay={0.1}>
                <TimelineMock />
              </Reveal>
            </div>
          </div>
        </section>

        <section id="developers" className="mx-auto max-w-[1160px] scroll-mt-20 px-4 py-14 sm:px-6 sm:py-20">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center lg:gap-14">
            <div>
              <p className="eyebrow">Developers</p>
              <h2 className="mt-3 text-[30px] font-medium leading-[1.15] tracking-[-0.035em] sm:text-[40px]">
                A small SDK over a contract you can inspect.
              </h2>
              <p className="mt-3 max-w-md text-[15px] leading-7 text-[var(--foreground-secondary)]">
                Query a task, reserve a purchase, recover an operation and watch durable activity.
                All amounts are integer strings in yoctoNEAR.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button asChild variant="secondary">
                  <Link href="/docs">
                    Read the docs <ArrowRight />
                  </Link>
                </Button>
                <Button asChild variant="ghost">
                  <a href="/docs#contract">Contract invariants</a>
                </Button>
              </div>
            </div>
            <div className="overflow-hidden rounded-[12px] border border-[#2c2f29] bg-[#20211f] text-[#e9eae5]">
              <div className="flex items-center justify-between border-b border-[#34372f] px-4 py-2.5">
                <span className="mono text-[10px] text-[#a7aca0]">example.ts</span>
                <span className="flex items-center gap-2">
                  <span className="text-[9px] text-[#8b9085]">TypeScript SDK</span>
                  <CopyCode value={SDK_EXAMPLE} />
                </span>
              </div>
              <pre className="scrollbar-quiet overflow-x-auto p-4 text-[11px] leading-6 sm:text-[12px]">
                <code>{SDK_EXAMPLE}</code>
              </pre>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1160px] px-4 pb-16 sm:px-6 sm:pb-24">
          <Reveal className="grain rounded-[16px] border border-[var(--border)] bg-[var(--surface-muted)] px-6 py-10 text-center sm:px-12 sm:py-14">
            <Sparkles className="mx-auto size-5 text-[var(--foreground-muted)]" />
            <h2 className="mx-auto mt-4 max-w-[640px] text-[28px] font-medium leading-[1.18] tracking-[-0.035em] sm:text-[38px]">
              Give your agents a budget you can trust.
            </h2>
            <p className="mx-auto mt-3 max-w-[520px] text-[14px] leading-6 text-[var(--foreground-secondary)]">
              Test the shared-budget race, a malicious document and a lost payment response against a
              real NEAR sandbox or testnet contract.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
              <Magnetic>
                <Button asChild size="lg">
                  <Link href="/app">Open PoolGuard <ArrowRight /></Link>
                </Button>
              </Magnetic>
              <Button asChild variant="secondary" size="lg">
                <Link href="/app/demo">Open the demo lab</Link>
              </Button>
            </div>
            <TestnetNote className="mt-4 text-[11px] text-[var(--foreground-muted)]" />
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-[1160px] flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5">
            <Brand />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-[var(--foreground-muted)]">
            <Link href="/docs" className="hover:text-[var(--foreground)]">Documentation</Link>
            <Link href="/docs#limitations" className="hover:text-[var(--foreground)]">Limitations</Link>
            <span>NEAR testnet · experimental</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
