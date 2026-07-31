/**
 * Shared guard decision shapes — allow / warn / refuse.
 * Guards never fetch vendor, rent, or ops data; they only gate the turn.
 */

export type GuardRefuseKind =
  | "action_boundary"
  | "fair_housing"
  | "human_decision"
  | "permission"
  | "jurisdiction"
  | "evidence"

export type GuardCapability =
  | "canAskLegal"
  | "canSeeResidents"
  | "canSeeVendors"
  | "canSeeFinance"

/** Soft annotations that continue the turn (counsel, screening isolation, etc.). */
export type GuardWarning = {
  id: string
  summary: string
}
