/**
 * Operational gold for classifyMaintenanceRequest.
 *
 * Expected labels follow existing urgencyPolicy / confidencePolicy / vendorTrade
 * resolution. Not copied from the landlord-JSON table:
 * - dripping faucet is medium (48h), not low
 * - single pest sighting is low; infestation is medium
 * - gas is emergencyType gas, not a plumbing matching trade
 * - front door lock matching trade is locksmith (landlord bucket structural)
 * - leaking pipe without pouring/ceiling/visible damage stays medium
 * - "The roof is leaking" without ceiling/from-the-roof flood cues stays medium
 */
import type { ClassificationEvalCase } from './classificationEval.ts'

export const CLASSIFICATION_EVAL_SET: ClassificationEvalCase[] = [
  {
    id: 'faucet-drip',
    input: 'The kitchen faucet is dripping constantly',
    expected: {
      vendorTrade: 'plumbing',
      urgencyBand: 'medium',
      clarificationRequired: false,
      primaryCategory: 'plumbing',
    },
  },
  {
    id: 'no-heat-freezing',
    input: "No heat and it's freezing in here",
    expected: {
      vendorTrade: 'hvac',
      urgencyBand: 'emergency',
      clarificationRequired: false,
      primaryCategory: 'hvac',
    },
    safetyCritical: true,
  },
  {
    id: 'no-heat-warm-outdoors',
    input: 'No heat in the apartment',
    context: { outdoorTempF: 68 },
    expected: {
      vendorTrade: 'hvac',
      urgencyBand: 'medium',
      clarificationRequired: false,
      primaryCategory: 'hvac',
    },
  },
  {
    id: 'dead-outlet',
    input: 'The outlet in the bathroom is not working',
    expected: {
      vendorTrade: 'electrical',
      urgencyBand: 'medium',
      clarificationRequired: false,
      primaryCategory: 'electrical',
    },
  },
  {
    id: 'sparking-outlet',
    input: "There's a sparking outlet in the kitchen",
    expected: {
      vendorTrade: 'electrical',
      urgencyBand: 'emergency',
      clarificationRequired: false,
      primaryCategory: 'electrical',
    },
    safetyCritical: true,
  },
  {
    id: 'fridge-not-cooling',
    input: 'Fridge not cold',
    expected: {
      vendorTrade: 'appliance_repair',
      urgencyBand: 'medium',
      clarificationRequired: false,
      primaryCategory: 'appliance',
    },
  },
  {
    id: 'front-door-lock',
    input: 'The front door lock is broken',
    expected: {
      vendorTrade: 'locksmith',
      urgencyBand: 'emergency',
      clarificationRequired: false,
      primaryCategory: 'structural',
    },
    safetyCritical: true,
  },
  {
    id: 'gas-smell',
    input: 'I think I smell gas',
    expected: {
      vendorTrade: 'other',
      urgencyBand: 'emergency',
      clarificationRequired: false,
      primaryCategory: 'general',
      emergencyType: 'gas',
    },
    safetyCritical: true,
  },
  {
    id: 'cockroach-sighting',
    input: 'I saw a cockroach in the kitchen',
    expected: {
      vendorTrade: 'pest_control',
      urgencyBand: 'low',
      clarificationRequired: false,
      primaryCategory: 'pest',
    },
  },
  {
    id: 'cockroach-infestation',
    input: 'Cockroach infestation in the kitchen',
    expected: {
      vendorTrade: 'pest_control',
      urgencyBand: 'medium',
      clarificationRequired: false,
      primaryCategory: 'pest',
    },
  },
  {
    id: 'ceiling-leak',
    input: 'The ceiling is leaking water',
    expected: {
      vendorTrade: 'plumbing',
      urgencyBand: 'emergency',
      clarificationRequired: false,
      primaryCategory: 'plumbing',
    },
    safetyCritical: true,
  },
  {
    id: 'vague-broken',
    input: 'Something is broken in my apartment',
    expected: {
      vendorTrade: 'other',
      urgencyBand: 'medium',
      clarificationRequired: true,
      confidenceBand: 'low',
      primaryCategory: 'general',
    },
  },
  {
    id: 'no-hot-water-2-days',
    input: 'No hot water for 2 days',
    expected: {
      vendorTrade: 'plumbing',
      urgencyBand: 'emergency',
      clarificationRequired: false,
      primaryCategory: 'plumbing',
    },
    safetyCritical: true,
  },
  {
    id: 'slow-drain',
    input: 'The bathroom has a slow drain',
    expected: {
      vendorTrade: 'plumbing',
      urgencyBand: 'low',
      clarificationRequired: false,
      primaryCategory: 'plumbing',
    },
  },
  {
    id: 'ac-mild',
    input: 'AC not working',
    context: { outdoorTempF: 72 },
    expected: {
      vendorTrade: 'hvac',
      urgencyBand: 'medium',
      clarificationRequired: false,
      primaryCategory: 'hvac',
    },
  },
  {
    id: 'ac-hot',
    input: 'AC not working',
    context: { outdoorTempF: 92 },
    expected: {
      vendorTrade: 'hvac',
      urgencyBand: 'emergency',
      clarificationRequired: false,
      primaryCategory: 'hvac',
    },
    safetyCritical: true,
  },
  {
    id: 'hole-in-wall',
    input: 'There is a hole in the wall',
    expected: {
      vendorTrade: 'carpentry',
      urgencyBand: 'medium',
      clarificationRequired: false,
      primaryCategory: 'structural',
    },
  },
  {
    id: 'hole-in-bedroom-wall',
    input: 'Hole in my bedroom wall',
    expected: {
      vendorTrade: 'carpentry',
      urgencyBand: 'medium',
      clarificationRequired: false,
      primaryCategory: 'structural',
    },
  },
  {
    id: 'washer-not-start',
    input: 'The washing machine will not start',
    expected: {
      vendorTrade: 'appliance_repair',
      urgencyBand: 'medium',
      clarificationRequired: false,
      primaryCategory: 'appliance',
    },
  },
  {
    id: 'send-someone',
    input: 'Can you send someone',
    expected: {
      vendorTrade: 'other',
      urgencyBand: 'medium',
      clarificationRequired: true,
      confidenceBand: 'low',
      primaryCategory: 'general',
    },
  },
  {
    id: 'flickering-lights',
    input: 'The lights keep flickering',
    expected: {
      vendorTrade: 'electrical',
      urgencyBand: 'medium',
      clarificationRequired: false,
      primaryCategory: 'electrical',
    },
  },
  {
    id: 'ceiling-pouring',
    input: 'Water is pouring through my ceiling',
    expected: {
      vendorTrade: 'plumbing',
      urgencyBand: 'emergency',
      clarificationRequired: false,
      primaryCategory: 'plumbing',
    },
    safetyCritical: true,
  },
  {
    id: 'leaking-pipe',
    input: 'There is a leaking pipe under the sink',
    expected: {
      vendorTrade: 'plumbing',
      urgencyBand: 'medium',
      clarificationRequired: false,
      primaryCategory: 'plumbing',
    },
  },
  {
    id: 'roof-leak',
    input: 'The roof is leaking',
    expected: {
      vendorTrade: 'roofing',
      urgencyBand: 'medium',
      clarificationRequired: false,
      primaryCategory: 'structural',
    },
  },
  {
    id: 'broken-refrigerator',
    input: 'My refrigerator is broken',
    expected: {
      vendorTrade: 'appliance_repair',
      urgencyBand: 'medium',
      clarificationRequired: false,
      primaryCategory: 'appliance',
    },
  },
]
