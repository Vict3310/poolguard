import type { Metadata } from "next";
import { LegalLayout } from "@/components/site/legal-layout";
import { CONTACT_EMAIL, LEGAL_UPDATED, SECURITY_REPORT_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security and responsible disclosure",
  description: "How to report a vulnerability in PoolGuard.",
};

export default function SecurityPage() {
  return (
    <LegalLayout eyebrow="Security" title="Responsible disclosure" updated={LEGAL_UPDATED} draft={false}>
      <p>
        Thank you for helping keep PoolGuard and its users safe. PoolGuard is an unaudited testnet prototype; we still want
        to hear about every vulnerability.
      </p>

      <h2 id="report">How to report</h2>
      <ul>
        <li>
          Report privately through <a href={SECURITY_REPORT_URL}>GitHub private vulnerability reporting</a>
          {CONTACT_EMAIL ? (
            <>
              {" "}or email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </>
          ) : null}
          .
        </li>
        <li>Please don’t open a public issue for a vulnerability.</li>
        <li>Include what you found, where, steps to reproduce, and the impact you expect.</li>
      </ul>

      <h2 id="scope">In scope</h2>
      <ul>
        <li>The PoolGuard contract, API, worker, provider and web app in this repository.</li>
        <li>Anything that lets someone spend outside a task’s policy, pay twice, take over a session, or read another account’s data.</li>
      </ul>

      <h2 id="rules">Please</h2>
      <ul>
        <li>Test only on testnet or your own local sandbox, and only with accounts and data you own.</li>
        <li>Don’t access other users’ data, degrade the service, or use social engineering.</li>
        <li>Give us reasonable time to fix an issue before disclosing it.</li>
      </ul>
      <p>
        We will not pursue good-faith research that follows these rules. We aim to acknowledge reports within five business
        days. There is no paid bug bounty.
      </p>

      <h2 id="machine">Machine-readable</h2>
      <p>
        Our contact details are also published at <a href="/.well-known/security.txt">/.well-known/security.txt</a>.
      </p>
    </LegalLayout>
  );
}
