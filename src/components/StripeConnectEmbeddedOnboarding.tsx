import { loadConnectAndInitialize, type StripeConnectInstance } from '@stripe/connect-js'
import { ConnectAccountOnboarding, ConnectComponentsProvider } from '@stripe/react-connect-js'
import { useEffect, useRef, useState } from 'react'
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

export type ConnectClientSecretResult =
  | string
  | { clientSecret: string; publishableKey?: string | null }

export type StripeConnectEmbeddedOnboardingProps = {
  fetchClientSecret: () => Promise<ConnectClientSecretResult>
  onExit: () => void
  className?: string
}

function publishableKeyFromResult(raw: ConnectClientSecretResult): string {
  if (typeof raw === 'string') return stripePublishableKey()
  const fromServer = raw.publishableKey?.trim() ?? ''
  if (fromServer.startsWith('pk_')) return fromServer
  return stripePublishableKey()
}

function clientSecretFromResult(raw: ConnectClientSecretResult): string {
  return typeof raw === 'string' ? raw.trim() : raw.clientSecret.trim()
}

export function StripeConnectEmbeddedOnboarding({
  fetchClientSecret,
  onExit,
  className = '',
}: StripeConnectEmbeddedOnboardingProps) {
  const fetchClientSecretRef = useRef(fetchClientSecret)
  fetchClientSecretRef.current = fetchClientSecret
  const cachedSecretRef = useRef<string | null>(null)

  const [connectInstance, setConnectInstance] = useState<StripeConnectInstance | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    const resolveSession = async () => {
      const raw = await fetchClientSecretRef.current()
      return {
        clientSecret: clientSecretFromResult(raw),
        publishableKey: publishableKeyFromResult(raw),
      }
    }

    const boot = async () => {
      setLoadError(null)
      setReady(false)
      try {
        const first = await resolveSession()
        if (cancelled) return
        if (!first.clientSecret) {
          setLoadError('Could not start payout setup. Please try again.')
          return
        }
        if (!first.publishableKey.startsWith('pk_')) {
          setLoadError(
            'Payout setup is missing a Stripe publishable key. Set VITE_STRIPE_PUBLISHABLE_KEY (and STRIPE_PUBLISHABLE_KEY on Edge) and reload.',
          )
          return
        }
        cachedSecretRef.current = first.clientSecret
        const instance = loadConnectAndInitialize({
          publishableKey: first.publishableKey,
          fetchClientSecret: async () => {
            if (cachedSecretRef.current) {
              const cached = cachedSecretRef.current
              cachedSecretRef.current = null
              return cached
            }
            const next = await resolveSession()
            return next.clientSecret
          },
          appearance: CONNECT_APPEARANCE,
        })
        if (!cancelled) setConnectInstance(instance)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message.trim() : ''
        setLoadError(message || 'Could not load payout setup. Please try again.')
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  if (loadError && !connectInstance) {
    return (
      <p className={`mt-3 text-[13px] leading-5 text-[#b91c1c] ${className}`}>{loadError}</p>
    )
  }

  if (!connectInstance) {
    return (
      <div
        className={`mt-4 flex min-h-[12rem] flex-col items-center justify-center gap-3 rounded-[12px] border border-[#e5e7eb] bg-white px-4 py-8 ${className}`}
      >
        <div
          className="size-8 animate-spin rounded-full border-2 border-[#d1d5db] border-t-[#186179]"
          role="status"
          aria-label="Loading payout setup"
        />
        <p className="text-[13px] text-[#6a7282]">Loading payout setup…</p>
      </div>
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
