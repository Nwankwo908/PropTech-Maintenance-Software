import { loadConnectAndInitialize, type StripeConnectInstance } from '@stripe/connect-js'
import { ConnectAccountOnboarding, ConnectComponentsProvider } from '@stripe/react-connect-js'
import { useRef, useState } from 'react'
import { stripePublishableKey } from '@/lib/stripePublishableKey'

const CONNECT_APPEARANCE = {
  overlays: 'dialog' as const,
  variables: {
    colorPrimary: '#186179',
    colorBackground: '#ffffff',
    colorText: '#101828',
    colorDanger: '#b91c1c',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    borderRadius: '10px',
  },
}

export type StripeConnectEmbeddedOnboardingProps = {
  fetchClientSecret: () => Promise<string>
  onExit: () => void
  className?: string
}

export function StripeConnectEmbeddedOnboarding({
  fetchClientSecret,
  onExit,
  className = '',
}: StripeConnectEmbeddedOnboardingProps) {
  const fetchClientSecretRef = useRef(fetchClientSecret)
  fetchClientSecretRef.current = fetchClientSecret

  const [loadError, setLoadError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const [connectInstance] = useState<StripeConnectInstance | null>(() => {
    const publishableKey = stripePublishableKey()
    if (!publishableKey.startsWith('pk_')) return null
    return loadConnectAndInitialize({
      publishableKey,
      fetchClientSecret: () => fetchClientSecretRef.current(),
      appearance: CONNECT_APPEARANCE,
    })
  })

  if (!connectInstance) {
    return (
      <p className="mt-3 text-[13px] leading-5 text-[#b91c1c]">
        {loadError ??
          'Payout setup is missing a Stripe publishable key. Set VITE_STRIPE_PUBLISHABLE_KEY and reload.'}
      </p>
    )
  }

  return (
    <div className={`relative mt-4 min-h-[12rem] w-full min-w-0 ${className}`}>
      {!ready && !loadError ? (
        <div className="absolute inset-0 z-10 flex min-h-[12rem] flex-col items-center justify-center gap-3 rounded-[12px] border border-[#e5e7eb] bg-white px-4 py-8">
          <div
            className="size-8 animate-spin rounded-full border-2 border-[#d1d5db] border-t-[#186179]"
            role="status"
            aria-label="Loading payout setup"
          />
          <p className="text-[13px] text-[#6a7282]">Loading payout setup…</p>
        </div>
      ) : null}
      {loadError ? (
        <p className="mb-3 text-[13px] leading-5 text-[#b91c1c]">{loadError}</p>
      ) : null}
      <ConnectComponentsProvider connectInstance={connectInstance}>
        <ConnectAccountOnboarding
          onExit={onExit}
          collectionOptions={{
            fields: 'eventually_due',
            futureRequirements: 'include',
          }}
          onLoaderStart={() => {
            setReady(true)
            setLoadError(null)
          }}
          onLoadError={({ error }) => {
            setReady(true)
            setLoadError(
              error?.message?.trim() || 'Could not load payout setup. Please try again.',
            )
          }}
        />
      </ConnectComponentsProvider>
    </div>
  )
}
