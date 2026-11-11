import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_VERSIONS } from "@poolguard/shared";
import { LegalLayout } from "@/components/site/legal-layout";
import { CONTACT_EMAIL, ISSUES_URL, LEGAL_UPDATED } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What PoolGuard collects, why, how long it is kept and who it is shared with.",
};

export default function PrivacyPage() {
  return (
    <LegalLayout eyebrow="Legal" title="Privacy Policy" updated={LEGAL_UPDATED} version={LEGAL_VERSIONS.privacy}>
      <p>
        PoolGuard is an experimental application on the NEAR <strong>testnet</strong>. This policy explains what the
        operator of this PoolGuard deployment (“we”) collects when you use it, why, how long it is kept and who else
        processes it. It is written to match what the software actually does.
      </p>

      <h2 id="summary">The short version</h2>
      <ul>
        <li>You sign in by signing a message with your NEAR wallet. We learn your NEAR account id, not your name or email.</li>
        <li>We store your tasks, the documents you add (encrypted at rest), purchase records and activity.</li>
        <li>Documents are sent to an AI model and to the extraction provider so agents can do their work.</li>
        <li>Anything written to the NEAR blockchain is <strong>public and permanent</strong>, including each task’s name.</li>
        <li>You can download or delete your off-chain data at any time in Settings.</li>
        <li>We use only essential cookies. There is no advertising or analytics tracking.</li>
      </ul>

      <h2 id="collected">What we collect</h2>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Why</th>
            <th>How long</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>NEAR account id</td>
            <td>Identify your account after you sign a sign-in message</td>
            <td>Until you delete your data</td>
          </tr>
          <tr>
            <td>Sessions: a hashed session token, browser user agent, created and last-active times</td>
            <td>Keep you signed in; let you see and end your active sessions</td>
            <td>7 days per session (or until you sign out)</td>
          </tr>
          <tr>
            <td>Consent records: which Terms and Privacy versions you accepted, and when</td>
            <td>Show that you agreed; ask again when a document changes</td>
            <td>Until you delete your data</td>
          </tr>
          <tr>
            <td>Tasks: name, objective, budget and policy</td>
            <td>Run your task. The name and policy are also written on chain</td>
            <td>Until you delete your data (on-chain copy is permanent)</td>
          </tr>
          <tr>
            <td>Documents you add (encrypted at rest with AES-256-GCM)</td>
            <td>Let agents and the extraction service process them</td>
            <td>Until you delete your data or an operator removes them</td>
          </tr>
          <tr>
            <td>Purchase records, transaction hashes, agent runs and activity history</td>
            <td>Show what was reserved, paid and delivered; recover safely after failures</td>
            <td>Until you delete your data</td>
          </tr>
          <tr>
            <td>Network addresses (IP)</td>
            <td>Rate limiting, in memory only. Our hosting providers may log them for security</td>
            <td>Not stored by PoolGuard; hosting logs per provider policy</td>
          </tr>
        </tbody>
      </table>
      <p>
        We do not ask for your name, email, seed phrase or private key, and we never receive your wallet’s keys. Please
        don’t put personal or sensitive information in task names or documents.
      </p>

      <h2 id="ai">AI processing</h2>
      <p>
        When agents run in live mode, your task objective and documents are sent to an AI model. Depending on the
        deployment this is <strong>NEAR AI Cloud</strong>, which runs models inside trusted execution environments, or
        another OpenAI-compatible provider. When no AI key is configured, runs are labelled “scripted” and no model is
        called. See the <Link href="/ai-disclosure">AI disclosure</Link>.
      </p>

      <h2 id="sharing">Who else processes data</h2>
      <ul>
        <li><strong>Database hosting</strong> (for example Supabase): stores the data listed above.</li>
        <li><strong>Application hosting</strong> (for example Render and Vercel): runs the app and may keep request logs.</li>
        <li><strong>AI provider</strong> (NEAR AI Cloud or an OpenAI-compatible service): receives objectives and documents in live runs.</li>
        <li><strong>OutLayer</strong>, if agent keys are held in OutLayer custody: receives the transactions agents ask it to sign.</li>
        <li><strong>NEAR RPC provider</strong>: receives the transactions and queries we send to the blockchain.</li>
        <li><strong>Your wallet</strong> (Sender, Nightly, Meteor or HERE): shows you the messages and transactions you sign.</li>
        <li><strong>The extraction provider</strong>, run by the operator of this deployment: receives documents for paid extractions.</li>
      </ul>
      <p>We do not sell personal data or use it for advertising.</p>

      <h2 id="blockchain">Public blockchain</h2>
      <p>
        Task names, policies, agent accounts, reservations and payments are recorded on the NEAR blockchain. Anyone can read
        them, and they cannot be changed or deleted, including by us. Deleting your data in PoolGuard does not remove them.
      </p>

      <h2 id="cookies">Cookies and browser storage</h2>
      <p>PoolGuard uses only what it needs to work, so it does not show a cookie banner.</p>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>pg_session</code></td>
            <td>Cookie, HTTP-only, 7 days</td>
            <td>Keeps you signed in</td>
          </tr>
          <tr>
            <td><code>pg_csrf</code></td>
            <td>Cookie, 7 days</td>
            <td>Protects your account against cross-site request forgery</td>
          </tr>
          <tr>
            <td><code>poolguard:preferences</code></td>
            <td>Local storage</td>
            <td>Your motion, sound and vibration settings</td>
          </tr>
          <tr>
            <td><code>poolguard:task-draft</code></td>
            <td>Local storage</td>
            <td>An unfinished task, including document text, so you don’t lose work. Cleared when the task is created</td>
          </tr>
          <tr>
            <td><code>poolguard:onboarding</code>, <code>poolguard:onboarding-stage</code></td>
            <td>Local storage</td>
            <td>Whether you finished or skipped guided setup, and where you left off</td>
          </tr>
          <tr>
            <td><code>poolguard:upload-notice</code></td>
            <td>Local storage</td>
            <td>That you read the document upload notice</td>
          </tr>
        </tbody>
      </table>
      <p>Local storage stays in your browser. Clearing site data removes it.</p>

      <h2 id="rights">Your choices and rights</h2>
      <ul>
        <li><strong>Download</strong> your tasks, documents, purchase evidence and activity as JSON or CSV in Settings → Data and privacy.</li>
        <li><strong>Delete</strong> your off-chain data and sessions in Settings. On-chain records remain.</li>
        <li><strong>Sign out everywhere</strong> from Settings → Active sessions.</li>
        <li>
          For anything else, contact us:{" "}
          {CONTACT_EMAIL ? <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> : <a href={ISSUES_URL}>open an issue</a>}.
        </li>
      </ul>
      <p>
        When you delete your data we keep one audit entry recording that a deletion happened, so deletions remain
        accountable. Database backups may hold deleted data until they expire.
      </p>

      <h2 id="security">Security</h2>
      <p>
        Session tokens are stored hashed, documents are encrypted at rest, and every change requires a CSRF token. No system
        is perfectly secure; this prototype has not been audited. Report issues through our{" "}
        <Link href="/security">security page</Link>.
      </p>

      <h2 id="age">Age</h2>
      <p>PoolGuard is for people aged 18 or over.</p>

      <h2 id="changes">Changes</h2>
      <p>
        Each version of this policy has a date-based version number. When it changes, we ask you to review and accept the
        new version the next time you make a change in PoolGuard.
      </p>
    </LegalLayout>
  );
}
