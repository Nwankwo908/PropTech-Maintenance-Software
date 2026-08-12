import { CallPhoneButton } from '@/components/CallPhoneButton'
import {
  resolveTenantActivationChip,
  tenantActivationChipVisualClasses,
  type TenantActivationChip,
} from '@/lib/tenantActivationStatus'

export type TenantActivationFields = {
  activationStatus?: string | null
  smsConsentStatus?: string | null
  activationAttemptCount?: number | null
  activationSmsSentAt?: string | null
}

export function tenantActivationChipFromRow(
  row: TenantActivationFields,
): TenantActivationChip {
  return resolveTenantActivationChip(row)
}

/** Compact status pill for resident tables / profile. */
export function TenantActivationStatusChip({
  chip,
  className = '',
}: {
  chip: TenantActivationChip
  className?: string
}) {
  const styles = tenantActivationChipVisualClasses(chip.status)
  return (
    <span
      className={`inline-flex w-fit max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${styles.pill} ${className}`.trim()}
      title={chip.detail}
    >
      <span className={`inline-block size-2 shrink-0 rounded-full ${styles.dot}`} aria-hidden />
      <span className="whitespace-nowrap">{chip.label}</span>
    </span>
  )
}

type ActionRequiredProps = {
  phone: string | null | undefined
  resending?: boolean
  onResend: () => void
  onEditPhone: () => void
  className?: string
}

/** Manual actions for tenant activation — send when ready, resend after failures. */
export function TenantActivationManualActions({
  chip,
  phone,
  resending = false,
  onSendWelcome,
  onResend,
  onEditPhone,
  className = '',
}: ActionRequiredProps & {
  chip: TenantActivationChip
  onSendWelcome: () => void
}) {
  if (chip.status === 'not_started' && phone?.trim()) {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className}`.trim()}>
        <button
          type="button"
          onClick={onSendWelcome}
          disabled={resending}
          className="sa-press inline-flex min-h-[32px] items-center justify-center rounded-[8px] bg-[#101828] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#1e2939] disabled:opacity-50"
        >
          {resending ? 'Sending…' : 'Send Welcome Text'}
        </button>
        <button
          type="button"
          onClick={onEditPhone}
          className="sa-press inline-flex min-h-[32px] items-center justify-center rounded-[8px] border border-black/10 bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#0a0a0a] hover:bg-[#f9fafb]"
        >
          Edit Phone Number
        </button>
      </div>
    )
  }

  if (chip.actionRequired) {
    return (
      <TenantActivationActionRequiredActions
        phone={phone}
        resending={resending}
        onResend={onResend}
        onEditPhone={onEditPhone}
        className={className}
      />
    )
  }

  return null
}

/** Manual actions when activation is Action Required. */
export function TenantActivationActionRequiredActions({
  phone,
  resending = false,
  onResend,
  onEditPhone,
  className = '',
}: ActionRequiredProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`.trim()}>
      <button
        type="button"
        onClick={onResend}
        disabled={resending}
        className="sa-press inline-flex min-h-[32px] items-center justify-center rounded-[8px] bg-[#101828] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#1e2939] disabled:opacity-50"
      >
        {resending ? 'Sending…' : 'Resend Welcome Text'}
      </button>
      <button
        type="button"
        onClick={onEditPhone}
        className="sa-press inline-flex min-h-[32px] items-center justify-center rounded-[8px] border border-black/10 bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#0a0a0a] hover:bg-[#f9fafb]"
      >
        Edit Phone Number
      </button>
      <CallPhoneButton phone={phone} label="Call Resident" variant="outline" />
    </div>
  )
}
