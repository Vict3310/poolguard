/**
 * Versions of the published legal documents. Bump a version when the document's
 * meaning changes: every signed-in account is asked to accept the new version
 * before it can change anything again.
 */
export const LEGAL_VERSIONS = {
  terms: "2026-11-11",
  privacy: "2026-11-11",
} as const;

export type LegalDocument = keyof typeof LEGAL_VERSIONS;
