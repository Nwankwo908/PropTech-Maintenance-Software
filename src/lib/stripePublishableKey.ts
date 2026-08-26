/** Browser Stripe publishable key for Connect embedded components. */
export function stripePublishableKey(): string {
  return import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY?.trim() ?? ''
}

export function hasStripeConnectEmbedded(): boolean {
  return stripePublishableKey().startsWith('pk_')
}
