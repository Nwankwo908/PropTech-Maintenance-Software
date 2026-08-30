import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ConnectedEmailProvider, ConnectedEmailSettings } from '@/lib/landlordSettings/types'
import {
  EMAIL_AUTOMATION_TOGGLES,
  EMAIL_DISCOVERY_CATEGORIES,
  EMAIL_PRIVACY_POINTS,
  EMAIL_PROVIDER_OPTIONS,
  connectEmailAccount,
  defaultConnectedEmailSettings,
  disconnectEmailAccount,
  getConnectedEmailAccount,
  loadConnectedEmailSettings,
  providerLabel,
  saveConnectedEmailSettings,
} from '@/lib/connectedEmailIntegration'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { landlordHasAccounting } from '@shared/landlordCapabilities'

const sectionCardClass =
  'sa-surface rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]'

const inputClass =
  'sa-surface h-10 w-full rounded-[8px] border border-[#e5e7eb] bg-white px-3 text-[14px] tracking-[-0.1504px] text-[#101828] outline-none placeholder:text-[#9ca3af] focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

function ToggleSwitch({
  id,
  checked,
  onChange,
  label,
}: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={[
        'relative h-6 w-11 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#155dfc]/30 focus-visible:ring-offset-2',
        checked ? 'bg-[#101828]' : 'bg-[#e5e7eb]',
      ].join(' ')}
    >
      <span
        className={[
          'sa-switch-thumb pointer-events-none absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm',
          checked ? 'translate-x-5' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  className = '',
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        'sa-press inline-flex items-center justify-center rounded-[10px] bg-[#101828] px-4 py-2.5 text-[14px] font-medium tracking-[-0.1504px] text-white hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function OutlineButton({
  children,
  onClick,
  disabled,
  className = '',
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        'sa-press inline-flex items-center justify-center rounded-[10px] border border-[#186179] bg-white px-4 py-2.5 text-[14px] font-medium tracking-[-0.1504px] text-[#186179] hover:bg-[#e8f2f5] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function formatConnectedAt(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function AdminConnectedEmailSettings() {
  const [settings, setSettings] = useState<ConnectedEmailSettings>(defaultConnectedEmailSettings)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<ConnectedEmailProvider>('gmail')
  const [email, setEmail] = useState('')

  useEffect(() => {
    let cancelled = false
    void loadConnectedEmailSettings().then((loaded) => {
      if (cancelled) return
      setSettings(loaded)
      if (loaded.provider) setProvider(loaded.provider)
      if (loaded.email) setEmail(loaded.email)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const account = useMemo(() => getConnectedEmailAccount(settings), [settings])

  async function handleConnect() {
    setBusy(true)
    setError(null)
    setMessage(null)
    const result = await connectEmailAccount({ provider, email })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSettings(result.settings)
    setMessage(
      'Connection saved for when email sync launches. Ulo does not access this inbox yet.',
    )
  }

  async function handleDisconnect() {
    setBusy(true)
    setError(null)
    setMessage(null)
    const result = await disconnectEmailAccount()
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSettings(result.settings)
    setMessage('Email disconnected.')
  }

  async function patchSettings(patch: Partial<ConnectedEmailSettings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    setBusy(true)
    setError(null)
    const result = await saveConnectedEmailSettings(next)
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? 'Could not save settings.')
      const reloaded = await loadConnectedEmailSettings()
      setSettings(reloaded)
      return
    }
    setMessage('Preferences saved.')
  }

  if (loading) {
    return (
      <main className="px-8 pb-12">
        <p className="py-6 text-[14px] text-[#6a7282]">Loading connected email…</p>
      </main>
    )
  }

  return (
    <>
      <div className="py-6">
        <Link
          to="/admin/settings"
          className="sa-link inline-flex items-center gap-1.5 text-[14px] font-medium tracking-[-0.1504px] text-[#6a7282] hover:text-[#101828]"
        >
          <span aria-hidden>←</span>
          Settings
        </Link>

        <div className="mt-4 max-w-3xl">
          <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
            Connected Email
          </h1>
          <p className="mt-2 text-[14px] leading-6 tracking-[-0.1504px] text-[#6a7282]">
            Save the mailbox Ulo should use for document discovery. Inbox sync is not live yet —
            nothing is imported without your approval when it launches.
          </p>
        </div>
        {message ? (
          <p className="mt-3 text-[13px] font-medium tracking-[-0.1504px] text-[#067647]">{message}</p>
        ) : null}
        {error ? (
          <p className="mt-3 text-[13px] font-medium tracking-[-0.1504px] text-[#b42318]">{error}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-6">
        <section className={sectionCardClass}>
          {settings.connected ? (
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9ca3af]">
                  Connected account
                </p>
                <p className="mt-2 text-[18px] font-semibold tracking-[-0.02em] text-[#101828]">
                  {account.email}
                </p>
                <p className="mt-1 text-[14px] tracking-[-0.1504px] text-[#6a7282]">
                  {providerLabel(settings.provider)} · Connected {formatConnectedAt(settings.connectedAt)} ·{' '}
                  {account.lastSyncLabel}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <OutlineButton
                  disabled={busy}
                  onClick={() => void patchSettings({ paused: !settings.paused })}
                >
                  {settings.paused ? 'Resume scanning' : 'Pause scanning'}
                </OutlineButton>
                <OutlineButton disabled={busy} onClick={() => void handleDisconnect()}>
                  Disconnect
                </OutlineButton>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-[16px] font-semibold tracking-[-0.1504px] text-[#101828]">
                Connect an email account
              </p>
              <p className="mt-1 text-[14px] leading-6 tracking-[-0.1504px] text-[#6a7282]">
                Choose a provider and the address where property documents arrive. This saves your
                preference only — Ulo does not sign in to the mailbox yet.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                {EMAIL_PROVIDER_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setProvider(option.id)}
                    className={[
                      'sa-press rounded-[10px] border px-3.5 py-2 text-[13px] font-medium tracking-[-0.1504px]',
                      provider === option.id
                        ? 'border-[#101828] bg-[#101828] text-white'
                        : 'border-[#e5e7eb] bg-white text-[#364153] hover:bg-[#f9fafb]',
                    ].join(' ')}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="mt-4 max-w-md">
                <label htmlFor="connected-email" className="mb-1.5 block text-[13px] font-medium text-[#364153]">
                  Email address
                </label>
                <input
                  id="connected-email"
                  type="email"
                  className={inputClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ops@yourcompany.com"
                />
              </div>

              <PrimaryButton className="mt-5" disabled={busy || !email.trim()} onClick={() => void handleConnect()}>
                {busy ? 'Saving…' : `Connect ${providerLabel(provider)}`}
              </PrimaryButton>
            </div>
          )}
        </section>

        {settings.connected ? (
          <section className={sectionCardClass}>
            <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.1504px] text-[#101828]">
              Notify me when
            </h2>
            <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
              Choose which discovered document types should alert your team once sync is live.
            </p>
            <ul className="mt-5 divide-y divide-[#eef0f3]">
              {EMAIL_AUTOMATION_TOGGLES.map((toggle) => (
                <li key={toggle.id} className="flex items-center justify-between gap-4 py-3">
                  <span className="text-[14px] tracking-[-0.1504px] text-[#101828]">{toggle.label}</span>
                  <ToggleSwitch
                    id={`email-auto-${toggle.id}`}
                    checked={Boolean(settings.automation[toggle.id])}
                    onChange={(enabled) =>
                      void patchSettings({
                        automation: { ...settings.automation, [toggle.id]: enabled },
                      })
                    }
                    label={toggle.label}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className={sectionCardClass}>
          <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.1504px] text-[#101828]">
            Privacy
          </h2>
          <ul className="mt-4 space-y-2">
            {EMAIL_PRIVACY_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-2 text-[14px] tracking-[-0.1504px] text-[#364153]">
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#12b76a]" aria-hidden />
                {point}
              </li>
            ))}
          </ul>
        </section>

        <section className={sectionCardClass}>
          <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.1504px] text-[#101828]">
            What Ulo can find
          </h2>
          <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
            Document discovery stays empty until inbox sync launches.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {EMAIL_DISCOVERY_CATEGORIES.filter((category) =>
              landlordHasAccounting(getActiveLandlordId()) ? true : category.id !== 'financial',
            ).map((category) => (
              <div key={category.id} className="rounded-[10px] border border-[#eef0f3] bg-[#f9fafb] p-4">
                <p className="text-[14px] font-semibold tracking-[-0.1504px] text-[#101828]">
                  {category.title}
                </p>
                <ul className="mt-2 space-y-1">
                  {category.items.map((item) => (
                    <li key={item} className="text-[13px] tracking-[-0.1504px] text-[#6a7282]">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-[10px] border border-dashed border-[#e5e7eb] px-4 py-8 text-center">
            <p className="text-[15px] font-semibold tracking-[-0.1504px] text-[#101828]">
              No documents discovered yet
            </p>
            <p className="mt-2 text-[14px] leading-6 tracking-[-0.1504px] text-[#6a7282]">
              When sync is available, candidate leases, invoices, and reports will appear here for
              your approval.
            </p>
          </div>
        </section>
      </div>
    </>
  )
}
