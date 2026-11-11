import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { SiteFooter } from "@/components/site/site-footer";

/**
 * Layout for legal and policy pages: readable column, a clear "last updated"
 * line and an honest draft notice (these texts have not been reviewed by a lawyer).
 */
export function LegalLayout({
  eyebrow,
  title,
  updated,
  version,
  children,
  draft = true,
}: {
  eyebrow: string;
  title: string;
  updated: string;
  version?: string;
  children: React.ReactNode;
  draft?: boolean;
}) {
  return (
    <div className="min-h-dvh bg-[var(--background)]">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex h-16 max-w-[1160px] items-center justify-between px-4 sm:px-6">
          <Brand />
          <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] text-[var(--foreground-muted)] hover:text-[var(--foreground)]">
            <ArrowLeft className="size-3.5" /> Home
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[760px] px-4 py-12 sm:px-6 sm:py-16">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-[-0.03em] sm:text-[40px]">{title}</h1>
        <p className="mt-3 text-[13px] text-[var(--foreground-muted)]">
          {updated === "live" ? "Live · updates automatically" : `Last updated ${updated}`}
          {version ? ` · version ${version}` : ""}
        </p>
        {draft ? (
          <p className="mt-5 rounded-[10px] border border-[var(--warning)]/25 bg-[var(--warning-background)] px-4 py-3 text-[13px] leading-5 text-[var(--warning)]">
            This is a plain-language draft for a testnet prototype. It describes what the software actually does, but it has
            not been reviewed by a lawyer. Have it reviewed before any public or commercial launch.
          </p>
        ) : null}
        <div className="legal-prose mt-10">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
