/**
 * Public site facts used by the legal, security and contact pages.
 * Contact details come from configuration only; nothing personal is hardcoded.
 */
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/Vict3310/poolguard";
/** GitHub private vulnerability reporting for the repository. */
export const SECURITY_REPORT_URL = `${REPO_URL}/security/advisories/new`;
export const ISSUES_URL = `${REPO_URL}/issues`;
/** Optional public contact address for privacy and support requests. */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || null;
export const LEGAL_UPDATED = "11 November 2026";
