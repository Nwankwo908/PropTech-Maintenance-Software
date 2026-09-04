import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CRITICAL_SAFETY_ALERTS,
  DEFAULT_NOTIFICATION_SETTINGS,
  loadNotificationSettingsForAccount,
  muteCategory,
  saveNotificationSettingsForAccount,
  updateEventChannel,
  type NotificationChannel,
  type NotificationEventCategory,
  type NotificationSettingsState,
} from '@/lib/notificationSettings'
import { sendSettingsTestNotification } from '@/api/settingsTestNotification'
import { fetchLandlordAccountProfile } from '@/lib/landlordAccountProfile'
import { loadOrganizationSettings } from '@/lib/organizationSettings'

const sectionCardClass =
  'sa-surface rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]'

const selectClass =
  'sa-surface h-10 w-full cursor-pointer appearance-none rounded-[8px] border border-[#e5e7eb] bg-white py-2 pl-3 pr-10 text-[14px] tracking-[-0.1504px] text-[#101828] outline-none focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  email: 'Email',
  sms: 'SMS',
  activity_feed: 'Activity feed',
  push: 'Push',
}

const EVENT_CHANNELS: NotificationChannel[] = ['email', 'sms', 'activity_feed']

function visibleDeliveryChannel(channel: NotificationChannel): NotificationChannel {
  return channel === 'push' ? 'email' : channel
}

function SelectChevron() {
  return (
    <svg
      className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-[#6a7282]"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
    >
      <path
        d="M5 7.5L10 12.5L15 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

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
        'relative mx-auto h-6 w-11 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#155dfc]/30 focus-visible:ring-offset-2',
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

function CriticalChip() {
  return (
    <span className="ml-2 inline-flex rounded-full border border-[#fecdca] bg-[#fef3f2] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#b42318]">
      Critical
    </span>
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

function DeliveryChannelCard({
  label,
  connected,
  actionLabel,
  onAction,
  detail,
}: {
  label: string
  connected: boolean
  actionLabel?: string
  onAction?: () => void
  detail?: string
}) {
  return (
    <div className="rounded-[10px] border border-[#eef0f3] bg-[#f9fafb] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[14px] font-semibold tracking-[-0.1504px] text-[#101828]">{label}</p>
          <p className="mt-1 text-[12px] tracking-[-0.1504px] text-[#6a7282]">
            {detail ?? (connected ? 'Connected' : 'Not connected')}
          </p>
        </div>
        <span
          className={[
            'inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em]',
            connected
              ? 'border-[#abefc6] bg-[#ecfdf3] text-[#067647]'
              : 'border-[#e5e7eb] bg-white text-[#6a7282]',
          ].join(' ')}
        >
          {connected ? 'Active' : 'Inactive'}
        </span>
      </div>
      {!connected && actionLabel ? (
        <button
          type="button"
          onClick={onAction}
          className="sa-link mt-3 text-[13px] font-medium tracking-[-0.1504px] text-[#155dfc] hover:text-[#0030b5]"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

function EventCategorySection({
  category,
  onMuteAll,
  onToggle,
}: {
  category: NotificationEventCategory
  onMuteAll: () => void
  onToggle: (eventId: string, channel: NotificationChannel, enabled: boolean) => void
}) {
  return (
    <section className={sectionCardClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.1504px] text-[#101828]">
            {category.title}
          </h2>
          <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
            {category.description}
          </p>
        </div>
        <button
          type="button"
          onClick={onMuteAll}
          className="sa-link text-[13px] font-medium tracking-[-0.1504px] text-[#6a7282] hover:text-[#101828]"
        >
          Mute all
        </button>
      </div>

      <div className="mt-5 overflow-x-auto rounded-[10px] border border-[#eef0f3]">
        <table className="min-w-full text-left">
          <thead className="bg-[#f9fafb] text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6a7282]">
            <tr>
              <th className="px-4 py-3 font-semibold">Event</th>
              <th className="px-4 py-3 text-center font-semibold">Email</th>
              <th className="px-4 py-3 text-center font-semibold">SMS</th>
              <th className="px-4 py-3 text-center font-semibold">Activity feed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#eef0f3] bg-white">
            {category.events.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3">
                  <span className="text-[14px] font-medium tracking-[-0.1504px] text-[#101828]">
                    {item.label}
                  </span>
                  {item.critical ? <CriticalChip /> : null}
                </td>
                {EVENT_CHANNELS.map((channel) => (
                  <td key={channel} className="px-4 py-3 text-center">
                    <ToggleSwitch
                      id={`${category.id}-${item.id}-${channel}`}
                      checked={item.channels[channel]}
                      onChange={(enabled) => onToggle(item.id, channel, enabled)}
                      label={`${item.label} ${CHANNEL_LABELS[channel]}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function AdminNotificationSettings() {
  const [saved, setSaved] = useState<NotificationSettingsState>(() => ({
    delivery: { ...DEFAULT_NOTIFICATION_SETTINGS.delivery },
    categories: JSON.parse(
      JSON.stringify(DEFAULT_NOTIFICATION_SETTINGS.categories),
    ) as NotificationEventCategory[],
  }))
  const [draft, setDraft] = useState<NotificationSettingsState>(() => ({
    delivery: { ...DEFAULT_NOTIFICATION_SETTINGS.delivery },
    categories: JSON.parse(
      JSON.stringify(DEFAULT_NOTIFICATION_SETTINGS.categories),
    ) as NotificationEventCategory[],
  }))
  const [loading, setLoading] = useState(true)
  const [profileEmail, setProfileEmail] = useState('')
  const [profilePhone, setProfilePhone] = useState('')
  const [supportEmail, setSupportEmail] = useState('')
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testState, setTestState] = useState<Record<string, 'idle' | 'sending' | 'sent' | 'failed'>>({
    email: 'idle',
    sms: 'idle',
  })
  const [testMessage, setTestMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      loadNotificationSettingsForAccount(),
      fetchLandlordAccountProfile(),
      loadOrganizationSettings(),
    ]).then(([settings, profile, organization]) => {
        if (cancelled) return
        setSaved(settings)
        setDraft(settings)
        setProfileEmail(profile.email)
        setProfilePhone(profile.phone)
        setSupportEmail(organization.supportEmail)
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  const isDirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [draft, saved])

  function updateDelivery(patch: Partial<NotificationSettingsState['delivery']>) {
    setDraft((current) => ({ ...current, delivery: { ...current.delivery, ...patch } }))
    setSaveMessage(null)
  }

  function handleToggle(
    categoryId: string,
    eventId: string,
    channel: NotificationChannel,
    enabled: boolean,
  ) {
    setDraft((current) => ({
      ...current,
      categories: updateEventChannel(current.categories, categoryId, eventId, channel, enabled),
    }))
    setSaveMessage(null)
  }

  function handleMuteAll(categoryId: string) {
    setDraft((current) => ({
      ...current,
      categories: muteCategory(current.categories, categoryId),
    }))
    setSaveMessage(null)
  }

  function handleRestoreDefaults() {
    const restored: NotificationSettingsState = {
      delivery: { ...DEFAULT_NOTIFICATION_SETTINGS.delivery },
      categories: JSON.parse(
        JSON.stringify(DEFAULT_NOTIFICATION_SETTINGS.categories),
      ) as NotificationEventCategory[],
    }
    setDraft(restored)
    setSaveMessage(null)
  }

  function handleSave() {
    setSaveError(null)
    void saveNotificationSettingsForAccount(draft)
      .then(() => loadNotificationSettingsForAccount())
      .then((refreshed) => {
        setSaved(refreshed)
        setDraft(refreshed)
        setSaveMessage('Notification settings saved.')
      })
      .catch((err: unknown) => {
        setSaveError(err instanceof Error ? err.message : 'Could not save notification settings.')
      })
  }

  function handleSendTest(channel: 'email' | 'sms') {
    setTestMessage(null)
    setTestState((current) => ({ ...current, [channel]: 'sending' }))
    void sendSettingsTestNotification({
      channel,
      toEmail: channel === 'email' ? supportEmail.trim() || profileEmail.trim() : undefined,
    }).then((result) => {
      setTestState((current) => ({
        ...current,
        [channel]: result.ok ? 'sent' : 'failed',
      }))
      setTestMessage(result.ok ? (result.message ?? 'Sent.') : (result.error ?? 'Failed to send.'))
    })
  }

  if (loading) {
    return (
      <main className="px-8 pb-12">
        <p className="py-6 text-[14px] text-[#6a7282]">Loading notification settings…</p>
      </main>
    )
  }

  return (
    <>
      <div className="py-6">
        <nav
          className="flex flex-wrap items-center gap-2 text-[14px] tracking-[-0.1504px] text-[#6a7282]"
          aria-label="Breadcrumb"
        >
          <Link to="/admin/settings" className="sa-link font-medium hover:text-[#101828]">
            ← Settings
          </Link>
          <span aria-hidden>/</span>
          <span className="font-medium text-[#6a7282]">Operations</span>
          <span aria-hidden>/</span>
          <span className="text-[#101828]">Notifications</span>
        </nav>

        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
              Notifications
            </h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-6 tracking-[-0.1504px] text-[#6a7282]">
              Choose which operational events notify your team and how those alerts are delivered.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <OutlineButton onClick={handleRestoreDefaults}>Restore defaults</OutlineButton>
            <PrimaryButton onClick={handleSave} disabled={!isDirty}>
              Save changes
            </PrimaryButton>
          </div>
        </div>
        {saveMessage ? (
          <p className="mt-3 text-[13px] font-medium tracking-[-0.1504px] text-[#067647]">{saveMessage}</p>
        ) : null}
        {saveError ? (
          <p className="mt-3 text-[13px] font-medium tracking-[-0.1504px] text-[#b42318]">{saveError}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-6">
          <section className={sectionCardClass}>
            <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.1504px] text-[#101828]">
              Delivery preferences
            </h2>
            <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
              Set default channels for operational alerts. Event-level settings below can override these.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <DeliveryChannelCard
                label="Email"
                connected={Boolean((supportEmail || profileEmail).trim())}
                detail={
                  (supportEmail || profileEmail).trim() ||
                  'Add a support email in Organization'
                }
              />
              <DeliveryChannelCard label="SMS" connected={Boolean(profilePhone.trim())} />
              <DeliveryChannelCard label="Activity feed" connected />
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div>
                <label htmlFor="primary-channel" className="mb-1.5 block text-[13px] font-medium text-[#364153]">
                  Primary notification method
                </label>
                <div className="relative">
                  <select
                    id="primary-channel"
                    className={selectClass}
                    value={visibleDeliveryChannel(draft.delivery.primaryChannel)}
                    onChange={(e) =>
                      updateDelivery({ primaryChannel: e.target.value as NotificationChannel })
                    }
                  >
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                    <option value="activity_feed">Activity feed</option>
                  </select>
                  <SelectChevron />
                </div>
              </div>
              <div>
                <label htmlFor="fallback-channel" className="mb-1.5 block text-[13px] font-medium text-[#364153]">
                  Fallback notification method
                </label>
                <div className="relative">
                  <select
                    id="fallback-channel"
                    className={selectClass}
                    value={visibleDeliveryChannel(draft.delivery.fallbackChannel)}
                    onChange={(e) =>
                      updateDelivery({ fallbackChannel: e.target.value as NotificationChannel })
                    }
                  >
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                    <option value="activity_feed">Activity feed</option>
                  </select>
                  <SelectChevron />
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-4 rounded-[10px] border border-[#eef0f3] bg-[#f9fafb] px-4 py-3">
              <div>
                <p className="text-[14px] font-medium tracking-[-0.1504px] text-[#101828]">
                  Automatically use fallback if primary delivery fails
                </p>
                <p className="mt-0.5 text-[13px] tracking-[-0.1504px] text-[#6a7282]">
                  Keeps critical operational alerts from being missed.
                </p>
              </div>
              <ToggleSwitch
                id="auto-fallback"
                checked={draft.delivery.autoFallback}
                onChange={(autoFallback) => updateDelivery({ autoFallback })}
                label="Automatically use fallback if primary delivery fails"
              />
            </div>
          </section>

          {draft.categories.map((category) => (
            <EventCategorySection
              key={category.id}
              category={category}
              onMuteAll={() => handleMuteAll(category.id)}
              onToggle={(eventId, channel, enabled) =>
                handleToggle(category.id, eventId, channel, enabled)
              }
            />
          ))}

          <section className={sectionCardClass}>
            <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.1504px] text-[#101828]">
              Safety & critical alerts
            </h2>
            <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
              These events always notify your team, regardless of other settings.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CRITICAL_SAFETY_ALERTS.map((alert) => (
                <div
                  key={alert}
                  className="flex items-center gap-3 rounded-[10px] border border-[#fecdca] bg-[#fef3f2] px-4 py-3"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-[#b42318]">
                    <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M8 4.5V8.5M8 11.5V11.51"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  <span className="flex-1 text-[13px] font-medium capitalize tracking-[-0.1504px] text-[#101828]">
                    {alert}
                  </span>
                  <svg className="size-4 shrink-0 text-[#12b76a]" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d="M3.5 8.5L6.5 11.5L12.5 4.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              ))}
            </div>
          </section>

          <section className={sectionCardClass}>
            <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.1504px] text-[#101828]">
              Test delivery
            </h2>
            <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
              Send a sample alert to confirm your channels are working.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {(['Email', 'SMS'] as const).map((label) => {
                const channel = label.toLowerCase() as 'email' | 'sms'
                const state = testState[channel]
                return (
                  <div
                    key={label}
                    className="rounded-[10px] border border-[#eef0f3] bg-[#f9fafb] px-4 py-4 text-center"
                  >
                    <p className="text-[14px] font-medium tracking-[-0.1504px] text-[#101828]">
                      Send test {label}
                    </p>
                    <OutlineButton
                      className="mt-3 w-full"
                      disabled={state === 'sending'}
                      onClick={() => handleSendTest(channel)}
                    >
                      {state === 'sending' ? 'Sending…' : state === 'sent' ? 'Sent' : 'Send'}
                    </OutlineButton>
                  </div>
                )
              })}
            </div>
            {testMessage ? (
              <p className="mt-3 text-[13px] tracking-[-0.1504px] text-[#6a7282]">{testMessage}</p>
            ) : null}
          </section>
      </div>
    </>
  )
}
