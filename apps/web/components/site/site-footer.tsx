import Link from "next/link";
import { Brand } from "@/components/brand";

export const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/ai-disclosure", label: "AI disclosure" },
  { href: "/security", label: "Security" },
  { href: "/status", label: "Status" },
  { href: "/contact", label: "Contact" },
];

/** Shared footer for public pages: legal, status and contact links. */
export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--border)]">
      <div className="mx-auto flex max-w-[1160px] flex-col gap-5 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Brand />
          <nav aria-label="Legal and support" className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-[var(--foreground-muted)]">
            <Link href="/docs" className="hover:text-[var(--foreground)]">
              Docs
            </Link>
            {LEGAL_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-[var(--foreground)]">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <p className="text-[11px] text-[var(--foreground-muted)]">
          NEAR testnet prototype. Test tokens have no monetary value. Not audited.
        </p>
      </div>
    </footer>
  );
}
