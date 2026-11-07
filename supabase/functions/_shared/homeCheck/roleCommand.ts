import type { InboundSmsHandlerContext } from '../sms/inboundHandlerTypes.ts'

/** Recipients cannot initiate checks. No lookup or mutation is needed to deny
 * this command; replies/photos for assigned checks use their existing handlers. */
export async function homeCheckRecipientCommand(ctx: InboundSmsHandlerContext): Promise<string> {
  if (ctx.identity.identity_type === 'vendor' || ctx.identity.identity_type === 'resident') {
    return 'Only your property team can request a Home Check. You can accept or decline a Home Check invitation they send you.'
  }
  return 'Only a registered landlord or authorized property-team member can request a Home Check.'
}
