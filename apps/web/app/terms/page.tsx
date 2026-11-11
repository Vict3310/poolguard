import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_VERSIONS } from "@poolguard/shared";
import { LegalLayout } from "@/components/site/legal-layout";
import { LEGAL_UPDATED } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The terms for using the PoolGuard testnet prototype.",
};

export default function TermsPage() {
  return (
    <LegalLayout eyebrow="Legal" title="Terms of Use" updated={LEGAL_UPDATED} version={LEGAL_VERSIONS.terms}>
      <p>
        These terms apply to this deployment of PoolGuard, run by its operator (“we”). By signing in you agree to them and to
        the <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2 id="prototype">A testnet prototype</h2>
      <ul>
        <li>PoolGuard runs on the NEAR <strong>testnet</strong> (or a local sandbox). Its tokens have <strong>no monetary value</strong>.</li>
        <li>It is experimental and <strong>has not been audited</strong>. Do not use it to hold or move anything of real value.</li>
        <li>It is not a financial service and gives no financial advice.</li>
      </ul>

      <h2 id="eligibility">Who can use it</h2>
      <p>You must be 18 or older. Access may be limited to invited accounts.</p>

      <h2 id="responsibilities">Your responsibilities</h2>
      <ul>
        <li>You control your wallet and keys. We never ask for your seed phrase or private key; never share them.</li>
        <li>Check every message and transaction in your wallet before you sign it.</li>
        <li>Blockchain transactions are final. Storage deposits are not refundable, and what is written on chain is public and permanent.</li>
        <li>Only upload documents you are allowed to share, and don’t upload personal or sensitive information.</li>
      </ul>

      <h2 id="acceptable-use">Acceptable use</h2>
      <p>Don’t:</p>
      <ul>
        <li>upload illegal, harmful or infringing content, or other people’s personal data;</li>
        <li>attack, probe or overload the service, other users or the agents’ shared accounts outside our <Link href="/security">security policy</Link>;</li>
        <li>try to get around rate limits, quotas, access controls or the contract’s spending rules;</li>
        <li>use PoolGuard to deceive anyone about the value or nature of test tokens.</li>
      </ul>

      <h2 id="ai">AI agents</h2>
      <p>
        Agents are AI systems and can be wrong or be misled by the documents they read. The contract, not the AI, decides
        what can be spent. Review results before relying on them. See the <Link href="/ai-disclosure">AI disclosure</Link>.
      </p>

      <h2 id="suspension">Suspension</h2>
      <p>
        We may limit, suspend or end access, hide tasks or remove documents that break these terms or put the service at
        risk. Suspension does not change anything on chain: funds in your tasks stay controlled by your wallet.
      </p>

      <h2 id="warranty">No warranty</h2>
      <p>
        PoolGuard is provided “as is”, without warranties of any kind, including availability, accuracy or fitness for a
        purpose. To the extent the law allows, we are not liable for any loss arising from its use, including lost test
        tokens, failed transactions or AI output.
      </p>

      <h2 id="changes">Changes</h2>
      <p>
        These terms have a date-based version number. When they change, we ask you to accept the new version before you
        can make further changes in PoolGuard. You can always download or delete your data.
      </p>

      <h2 id="law">Governing law</h2>
      <p>The operator of a public deployment should complete this section with the applicable law and jurisdiction.</p>
    </LegalLayout>
  );
}
