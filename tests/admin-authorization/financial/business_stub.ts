// External/business side effects are forbidden in this authorization suite.
export const effects: string[] = []
// deno-lint-ignore no-explicit-any
export type StripeConnectPayoutMethod = any
export const isStripeConfigured = () => false
export const isStripeConnectReady = (input: {accountId?: unknown; chargesEnabled?: unknown}) => Boolean(input.accountId && input.chargesEnabled)
export const assertConnectReturnOriginForStripe = (_v: unknown) => ({ok:true,error: "Synthetic origin error"})
export const resolveConnectAppBaseUrl = (_v: unknown) => 'https://fixture.invalid'
export const applicationFeeCents = (_v: unknown) => 0
export const isStripeCheckoutSessionPaymentFailed = (_v: unknown) => false
export const isMaintenanceInvoicePaidFromRow = (_v: unknown) => ({paid:false})
// deno-lint-ignore no-explicit-any
function forbidden(name:string): (...args: unknown[]) => Promise<any> {
 return (..._args:unknown[])=>{effects.push(name);throw Error('Forbidden business/provider effect: '+name)}
}
export const createConnectAccountLink=forbidden('createConnectAccountLink')
export const createConnectAccountSession=forbidden('createConnectAccountSession')
export const deleteExpressConnectAccount=forbidden('deleteExpressConnectAccount')
export const ensureEmbeddedConnectAccount=forbidden('ensureEmbeddedConnectAccount')
export const listConnectPayoutMethods=forbidden('listConnectPayoutMethods')
export const retrieveConnectAccount=forbidden('retrieveConnectAccount')
export const stripeForm=forbidden('stripeForm')
export const stripeGet=forbidden('stripeGet')
export const approveMaintenanceInvoice=forbidden('approveMaintenanceInvoice')
export const canReceivePayments=forbidden('canReceivePayments')
export const isMaintenanceInvoicePaid=forbidden('isMaintenanceInvoicePaid')
export const recordInvoicePaymentFailedActivity=forbidden('recordInvoicePaymentFailedActivity')
export const recordLandlordStripeConnectReadyIfTransition=forbidden('recordLandlordStripeConnectReadyIfTransition')
export const recordActivityLog=forbidden('recordActivityLog')
