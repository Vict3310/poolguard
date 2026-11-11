import Link from "next/link";
import { ArrowRight, Cpu, LockKeyhole, Play, RefreshCw, ScrollText, ShieldCheck, Sparkles, Users } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { CopyCode, Magnetic, Reveal, RevealGroup, RevealItem, ScrollHeader, StaggerWords } from "@/components/landing/motion";
import { CursorSpotlight, TiltCard } from "@/components/landing/interactive";
import { HeroPool } from "@/components/landing/hero-pool";
import { ScrollStory } from "@/components/landing/scroll-story";
import { DefenseInDepth } from "@/components/landing/defense-in-depth";
import { SiteFooter } from "@/components/site/site-footer";
import { AnnouncementBanner } from "@/components/site/announcement-banner";

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

const BENEFITS = [
  {
    icon: Users,
    title: "A shared limit",
    body: "Parallel agents reserve from one pool. The contract serializes reservations, so two agents can never spend the same remaining balance.",
  },
  {
    icon: ShieldCheck,
    title: "Clear authority",
    body: "Approved providers, a per-purchase cap and registered agent keys are enforced on chain. The model picks a service; it never writes the transfer.",
  },
  {
    icon: RefreshCw,
    title: "Recoverable payments",
    body: "The operation ID is stable across retries. After a timeout or restart, PoolGuard checks the original operation before doing anything else.",
  },
];

const STACK_CHIPS = [
  { icon: Cpu, label: "Private inference on NEAR AI", optional: true },
  { icon: LockKeyhole, label: "Agent keys in OutLayer’s enclave", optional: true },
  { icon: ScrollText, label: "Limits enforced by a NEAR contract", optional: false },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh overflow-x-clip bg-[var(--background)]">
      <ScrollHeader className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--background)]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1160px] items-center justify-between px-4 sm:px-6">
          <Brand />
          <nav aria-label="Marketing" className="hidden items-center gap-7 md:flex">
            {[
              ["#how-it-works", "How it works"],
              ["#protection", "Protection"],
              ["#developers", "Developers"],
            ].map(([href, label]) => (
              <a key={href} href={href} className="text-[13px] text-[var(--foreground-secondary)] transition-colors hover:text-[var(--foreground)]">
                {label}
              </a>
            ))}
            <Link href="/docs" className="text-[13px] text-[var(--foreground-secondary)] transition-colors hover:text-[var(--foreground)]">
              Docs
            </Link>
          </nav>
          <Button asChild size="sm" variant="action" className="h-9">
            <Link href="/app">
              Open app <ArrowRight />
            </Link>
          </Button>
        </div>
      </ScrollHeader>

      <AnnouncementBanner />
      <main id="main">
        {/* Hero */}
        <section className="relative">
          <CursorSpotlight />
          <div className="grain pointer-events-none absolute inset-0 opacity-70" aria-hidden />
          <div className="relative mx-auto grid max-w-[1160px] items-center gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,480px)] xl:gap-16 lg:pb-24 lg:pt-20">
            <div>
              <Reveal y={8}>
                <p className="eyebrow">Agent spending, under control</p>
              </Reveal>
              <StaggerWords
                lines={["One task budget.", "Multiple agents."]}
                className="mt-4 text-[40px] font-medium leading-[1.02] tracking-[-0.045em] sm:text-[56px] lg:text-[52px] xl:text-[66px]"
              />
              <Reveal delay={0.35}>
                <p className="mt-5 max-w-[540px] text-[16px] leading-7 text-[var(--foreground-secondary)] sm:text-[17px]">
                  Let AI agents buy the tools they need from one shared budget. A NEAR contract enforces the limits, approved
                  providers and a clear record of every payment.
                </p>
              </Reveal>
              <Reveal delay={0.45}>
                <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
                  <Magnetic className="w-full sm:w-auto">
                    <Button asChild size="lg" variant="action" className="w-full sm:w-auto">
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
              </Reveal>
              <Reveal delay={0.55}>
                <ul className="mt-8 flex flex-wrap gap-2" aria-label="How PoolGuard protects purchases">
                  {STACK_CHIPS.map((chip) => (
                    <li
                      key={chip.label}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] text-[var(--foreground-secondary)]"
                    >
                      <chip.icon className="size-3.5 text-[var(--action)]" />
                      {chip.label}
                      {chip.optional ? <span className="text-[10px] text-[var(--foreground-muted)]">· optional</span> : null}
                    </li>
                  ))}
                </ul>
                <TestnetNote className="mt-5 text-[11px] text-[var(--foreground-muted)]" />
              </Reveal>
            </div>
            <Reveal delay={0.3} y={24}>
              <HeroPool />
            </Reveal>
          </div>
        </section>

        {/* Benefits */}
        <section id="how-it-works" className="mx-auto max-w-[1160px] scroll-mt-20 px-4 py-16 sm:px-6 sm:py-20">
          <Reveal className="max-w-[640px]">
            <p className="eyebrow">Why it works</p>
            <h2 className="text-fade-soft mt-3 text-[30px] font-medium leading-[1.15] tracking-[-0.035em] sm:text-[40px]">
              Autonomy inside a boundary you set.
            </h2>
          </Reveal>
          <RevealGroup className="mt-10 grid gap-4 sm:grid-cols-3">
            {BENEFITS.map((benefit) => (
              <RevealItem key={benefit.title}>
                <TiltCard className="h-full rounded-[16px] border border-[var(--border)] bg-[var(--surface)]">
                  <div className="p-6">
                    <span className="flex size-10 items-center justify-center rounded-[10px] bg-[var(--action-soft)] text-[var(--action)]">
                      <benefit.icon className="size-5" />
                    </span>
                    <h3 className="mt-5 text-[18px] font-semibold tracking-[-0.02em]">{benefit.title}</h3>
                    <p className="mt-2 text-[14px] leading-6 text-[var(--foreground-secondary)]">{benefit.body}</p>
                  </div>
                </TiltCard>
              </RevealItem>
            ))}
          </RevealGroup>
        </section>

        {/* Scroll story */}
        <section aria-label="How a purchase stays safe" className="border-y border-[var(--border)] bg-[var(--surface)] py-16 lg:py-0">
          <ScrollStory />
        </section>

        {/* Defense in depth */}
        <section id="protection" className="mx-auto max-w-[1160px] scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
          <Reveal className="max-w-[760px]">
            <p className="eyebrow">Three layers of protection</p>
            <h2 className="text-fade-soft mt-3 text-[26px] font-medium leading-[1.2] tracking-[-0.03em] sm:text-[32px]">
              Agents think privately on NEAR AI, sign through OutLayer’s enclave, and can only spend what the PoolGuard
              contract allows.
            </h2>
            <p className="mt-4 text-[15px] leading-7 text-[var(--foreground-secondary)]">
              Each layer catches a different failure. The first two are optional and switched on per deployment; the
              contract is always the final authority.
            </p>
          </Reveal>
          <Reveal className="mt-10" delay={0.1}>
            <DefenseInDepth />
          </Reveal>
        </section>

        {/* Developers */}
        <section id="developers" className="border-t border-[var(--border)] bg-[var(--surface)]">
          <div className="mx-auto grid max-w-[1160px] scroll-mt-20 gap-8 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center lg:gap-14">
            <Reveal>
              <p className="eyebrow">Developers</p>
              <h2 className="text-fade-soft mt-3 text-[30px] font-medium leading-[1.15] tracking-[-0.035em] sm:text-[40px]">
                A small SDK over a contract you can inspect.
              </h2>
              <p className="mt-3 max-w-md text-[15px] leading-7 text-[var(--foreground-secondary)]">
                Query a task, reserve a purchase, recover an operation and watch durable activity. All amounts are integer
                strings in yoctoNEAR.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button asChild variant="secondary">
                  <Link href="/docs">
                    Read the docs <ArrowRight />
                  </Link>
                </Button>
                <Button asChild variant="link">
                  <a href="/docs#contract">Contract invariants</a>
                </Button>
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <TiltCard max={3} className="rounded-[14px] border border-[#1d1d24] bg-[#0a0a0d] text-[#e8e8ee]">
                <div className="flex items-center justify-between border-b border-[#24242c] px-4 py-2.5">
                  <span className="mono text-[10px] text-[#a0a0ab]">example.ts</span>
                  <span className="flex items-center gap-2">
                    <span className="text-[9px] text-[#80808c]">TypeScript SDK</span>
                    <CopyCode value={SDK_EXAMPLE} />
                  </span>
                </div>
                <pre className="scrollbar-quiet overflow-x-auto p-4 text-[11px] leading-6 sm:text-[12px]">
                  <code>{SDK_EXAMPLE}</code>
                </pre>
              </TiltCard>
            </Reveal>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto max-w-[1160px] px-4 py-16 sm:px-6 sm:py-24">
          <Reveal className="grain relative overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface-muted)] px-6 py-12 text-center sm:px-12 sm:py-16">
            <CursorSpotlight />
            <Sparkles className="relative mx-auto size-5 text-[var(--action)]" />
            <h2 className="text-fade-soft relative mx-auto mt-4 max-w-[640px] text-[28px] font-medium leading-[1.18] tracking-[-0.035em] sm:text-[40px]">
              Give your agents a budget you can trust.
            </h2>
            <p className="relative mx-auto mt-3 max-w-[520px] text-[14px] leading-6 text-[var(--foreground-secondary)]">
              Try the shared-budget race, a malicious document and a lost payment response against a real NEAR sandbox or
              testnet contract.
            </p>
            <div className="relative mt-7 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
              <Magnetic>
                <Button asChild size="lg" variant="action">
                  <Link href="/app">
                    Open PoolGuard <ArrowRight />
                  </Link>
                </Button>
              </Magnetic>
              <Button asChild variant="secondary" size="lg">
                <Link href="/app/demo">Open the demo lab</Link>
              </Button>
            </div>
            <TestnetNote className="relative mt-5 text-[11px] text-[var(--foreground-muted)]" />
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
