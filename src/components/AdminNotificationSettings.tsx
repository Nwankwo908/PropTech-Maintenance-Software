import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  countCriticalPushEvents,
  CRITICAL_SAFETY_ALERTS,
  DEFAULT_NOTIFICATION_SETTINGS,
  DELIVERY_HEALTH,
  loadNotificationSettings,
  muteCategory,
  saveNotificationSettings,
  updateEventChannel,
  type NotificationChannel,
  type NotificationEventCategory,
  type NotificationSettingsState,
} from '@/lib/notificationSettings'

const sectionCardClass =
  'rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]'

const selectClass =
  'h-10 w-full cursor-pointer appearance-none rounded-[8px] border border-[#e5e7eb] bg-white py-2 pl-3 pr-10 text-[14px] tracking-[-0.1504px] text-[#101828] outline-none focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  email: 'Email',
  sms: 'SMS',
  push: 'Push',
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
        'relative mx-auto h-6 w-11 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#155dfc]/30 focus-visible:ring-offset-2',
        checked ? 'bg-[#101828]' : 'bg-[#e5e7eb]',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform',
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
        'inline-flex items-center justify-center rounded-[10px] bg-[#101828] px-4 py-2.5 text-[14px] font-medium tracking-[-0.1504px] text-white transition-colors hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:opacity-50',
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
        'inline-flex items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2.5 text-[14px] font-medium tracking-[-0.1504px] text-[#101828] transition-colors hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-50',
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
}: {
  label: string
  connected: boolean
  actionLabel?: string
}) {
  return (
    <div className="rounded-[10px] border border-[#eef0f3] bg-[#f9fafb] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[14px] font-semibold tracking-[-0.1504px] text-[#101828]">{label}</p>
          <p className="mt-1 text-[12px] tracking-[-0.1504px] text-[#6a7282]">
            {connected ? 'Connected' : 'Not connected'}
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
          className="mt-3 text-[13px] font-medium tracking-[-0.1504px] text-[#155dfc] transition-colors hover:text-[#0030b5]"
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
          className="text-[13px] font-medium tracking-[-0.1504px] text-[#6a7282] transition-colors hover:text-[#101828]"
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
              <th className="px-4 py-3 text-center font-semibold">Push</th>
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
                {(['email', 'sms', 'push'] as const).map((channel) => (
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

function SidebarStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-[13px] tracking-[-0.1504px] text-[#6a7282]">{label}</span>
      <span className="text-[13px] font-semibold tracking-[-0.1504px] text-[#101828]">{value}</span>
    </div>
  )
}

export function AdminNotificationSettings() {
  const [saved, setSaved] = useState<NotificationSettingsState>(() => loadNotificationSettings())
  const [draft, setDraft] = useState<NotificationSettingsState>(() => loadNotificationSettings())
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const isDirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [draft, saved])
  const criticalPushCount = useMemo(() => countCriticalPushEvents(draft.categories), [draft.categories])

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
    saveNotificationSettings(draft)
    setSaved(draft)
    setSaveMessage('Notification settings saved.')
  }

  return (
    <>
      <div className="py-6">
        <nav
          className="flex flex-wrap items-center gap-2 text-[14px] tracking-[-0.1504px] text-[#6a7282]"
          aria-label="Breadcrumb"
        >
          <Link to="/admin/settings" className="font-medium transition-colors hover:text-[#101828]">
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
      </div>

      <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <section className={sectionCardClass}>
            <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.1504px] text-[#101828]">
              Delivery preferences
            </h2>
            <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
              Set default channels for operational alerts. Event-level settings below can override these.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <DeliveryChannelCard label="Email" connected />
              <DeliveryChannelCard label="SMS" connected />
              <DeliveryChannelCard
                label="Push"
                connected={draft.delivery.pushEnabled}
                actionLabel="Enable push"
              />
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
                    value={draft.delivery.primaryChannel}
                    onChange={(e) =>
                      updateDelivery({ primaryChannel: e.target.value as NotificationChannel })
                    }
                  >
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                    <option value="push">Push</option>
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
                    value={draft.delivery.fallbackChannel}
                    onChange={(e) =>
                      updateDelivery({ fallbackChannel: e.target.value as NotificationChannel })
                    }
                  >
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                    <option value="push">Push</option>
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
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {(['Email', 'SMS', 'Push'] as const).map((label) => (
                <div
                  key={label}
                  className="rounded-[10px] border border-[#eef0f3] bg-[#f9fafb] px-4 py-4 text-center"
                >
                  <p className="text-[14px] font-medium tracking-[-0.1504px] text-[#101828]">
                    Send test {label}
                  </p>
                  <OutlineButton className="mt-3 w-full">Send</OutlineButton>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-6 xl:sticky xl:top-6 xl:w-[300px]">
          <section className={sectionCardClass}>
            <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.1504px] text-[#101828]">
              Delivery health
            </h2>
            <div className="mt-4 divide-y divide-[#eef0f3]">
              <SidebarStat label="Primary channel" value={CHANNEL_LABELS[draft.delivery.primaryChannel]} />
              <SidebarStat label="Fallback" value={CHANNEL_LABELS[draft.delivery.fallbackChannel]} />
              <SidebarStat
                label="Quiet hours"
                value={`${draft.delivery.quietHoursStart} — ${draft.delivery.quietHoursEnd}`}
              />
              <SidebarStat label="Sent (7 days)" value={DELIVERY_HEALTH.sent7Days} />
              <SidebarStat label="Delivery rate" value={DELIVERY_HEALTH.deliveryRate} />
              <SidebarStat label="Unsubscribe rate" value={DELIVERY_HEALTH.unsubscribeRate} />
            </div>
          </section>

          <section className={sectionCardClass}>
            <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.1504px] text-[#101828]">
              Critical events
            </h2>
            <p className="mt-2 text-[14px] leading-6 tracking-[-0.1504px] text-[#6a7282]">
              {criticalPushCount} critical events are currently set to push notifications.
            </p>
            <div className="mt-4 space-y-2">
              <OutlineButton className="w-full">Review critical list</OutlineButton>
              <OutlineButton className="w-full" onClick={handleRestoreDefaults}>
                Restore defaults
              </OutlineButton>
            </div>
          </section>

          <section className="rounded-[10px] border border-[#dbeafe] bg-[#eff6ff] p-5">
            <p className="text-[13px] font-semibold tracking-[-0.1504px] text-[#101828]">
              Reduce notification noise
            </p>
            <p className="mt-2 text-[13px] leading-5 tracking-[-0.1504px] text-[#4b5563]">
              Mute non-critical categories, rely on push only for escalations, and use quiet hours for
              routine updates.
            </p>
          </section>
        </aside>
      </div>
    </>
  )
}
