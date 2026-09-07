import type { PropertyHistoryPaymentStatus } from '@/lib/propertyHistory'

export function PaymentStatusChip({ status }: { status: PropertyHistoryPaymentStatus }) {
  const paid = status === 'paid'
  return (
    <span
      className={`inline-flex items-center justify-start rounded-[6px] px-2 py-1 text-[11px] font-bold leading-none ${
        paid ? 'bg-[#e6f6ec] text-[#1e8555]' : 'bg-[#f0f2f4] text-[#5c646c]'
      }`}
    >
      {paid ? 'PAID' : 'NOT PAID'}
    </span>
  )
}
