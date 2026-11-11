import type { Metadata } from "next";
import Link from "next/link";
import { LegalLayout } from "@/components/site/legal-layout";
import { CONTACT_EMAIL, ISSUES_URL, LEGAL_UPDATED, SECURITY_REPORT_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Support, privacy requests and security reports for PoolGuard.",
};

export default function ContactPage() {
  return (
    <LegalLayout eyebrow="Contact" title="Get in touch" updated={LEGAL_UPDATED} draft={false}>
      <h2 id="support">Support and feedback</h2>
      <p>
        {CONTACT_EMAIL ? (
          <>
            Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, or{" "}
          </>
        ) : null}
        open an issue on <a href={ISSUES_URL}>GitHub</a>. Please don’t include private keys, seed phrases or personal data.
      </p>

      <h2 id="privacy">Privacy requests</h2>
      <p>
        You can download or delete your data yourself in <Link href="/app/settings">Settings → Data and privacy</Link>. For
        anything else{" "}
        {CONTACT_EMAIL ? (
          <>
            email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </>
        ) : (
          <>
            open an issue on <a href={ISSUES_URL}>GitHub</a> (without personal details) and we will follow up
          </>
        )}
        .
      </p>

      <h2 id="security">Security reports</h2>
      <p>
        Please report privately via <a href={SECURITY_REPORT_URL}>GitHub private vulnerability reporting</a>. See our{" "}
        <Link href="/security">responsible disclosure policy</Link>.
      </p>

      <h2 id="status">Service status</h2>
      <p>
        Check the <Link href="/status">status page</Link> for whether each part of PoolGuard is up.
      </p>
    </LegalLayout>
  );
}
