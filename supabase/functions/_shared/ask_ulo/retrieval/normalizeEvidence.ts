/**
 * Normalize heterogeneous lookup results into a common evidence shape.
 * Domain tools already emit structured packets; this is the named entry point.
 */

export {
  emptyEvidenceBundle,
  finalizeEvidenceBundle,
  recordToolExecution,
  summarizeEvidenceBundle,
  buildOrganizedEvidencePacket,
  formatOrganizedEvidenceBlock,
  summarizeEvidencePacket,
  type AskUloEvidenceBundle,
  type AskUloEvidencePacket,
  type OrganizedEvidenceFact,
  type EvidenceChannel,
} from "./buildEvidencePacket.ts"
