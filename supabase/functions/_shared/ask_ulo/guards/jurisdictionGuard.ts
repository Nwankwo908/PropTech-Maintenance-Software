/**
 * Jurisdiction gate — legal location must match portfolio / ask.
 * Implementation lives in quality/checkJurisdiction (legalJurisdiction).
 */

export {
  assessLegalGrounding,
  formatLegalClarificationMarkdown,
  formatLegalRefuseMarkdown,
  resolveLegalJurisdiction,
  type LegalJurisdictionResolution,
} from "../quality/checkJurisdiction.ts"
