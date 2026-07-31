/**
 * Prefer / missing evidence stage — re-exports resolvePreferPacket.
 * @deprecated Import from resolvePreferPacket.ts; this file remains for path stability.
 */

export {
  resolvePreferPacket,
  preferPacketBagFromEvidence,
  preferPacketBagFromToolPackets,
  handlePreferredEvidence,
  type PreferPacketResult,
  type PreferPacketBag,
  type PreferredEvidenceResult,
} from "./resolvePreferPacket.ts"
