import type { WorkflowTemplate, WorkflowTemplateId } from "./types.ts"
import { maintenanceIntakeTemplate } from "./templates/maintenance.ts"
import { leaseRenewalTemplate } from "./templates/leaseRenewal.ts"
import { rentCollectionTemplate } from "./templates/rentCollection.ts"
import { vendorJobResponseTemplate } from "./templates/vendorResponse.ts"
import { vendorOnboardingTemplate } from "./templates/vendorOnboarding.ts"
import { moveInTemplate } from "./templates/moveIn.ts"
import { moveOutTemplate } from "./templates/moveOut.ts"
import { inspectionTemplate } from "./templates/inspection.ts"
import { maintenanceRequestTemplate } from "./templates/maintenanceRequest.ts"
import {
  identityOnboardingTemplate,
  landlordCommandTemplate,
} from "./templates/onboarding.ts"

const TEMPLATES: Record<WorkflowTemplateId, WorkflowTemplate> = {
  maintenance_intake: maintenanceIntakeTemplate,
  lease_renewal: leaseRenewalTemplate,
  rent_collection: rentCollectionTemplate,
  vendor_job_response: vendorJobResponseTemplate,
  vendor_onboarding: vendorOnboardingTemplate,
  move_in: moveInTemplate,
  move_out: moveOutTemplate,
  inspection: inspectionTemplate,
  maintenance_request: maintenanceRequestTemplate,
  identity_onboarding: identityOnboardingTemplate,
  landlord_command: landlordCommandTemplate,
}

export function getWorkflowTemplate(id: WorkflowTemplateId): WorkflowTemplate {
  return TEMPLATES[id]
}

export function listWorkflowTemplates(): WorkflowTemplate[] {
  return Object.values(TEMPLATES)
}
