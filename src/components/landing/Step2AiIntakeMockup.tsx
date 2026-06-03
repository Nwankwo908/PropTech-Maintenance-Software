import type { ReactNode } from 'react'

function IntakeRow({
  label,
  value,
  chipClass,
}: {
  label: string
  value: string
  chipClass: string
}) {
  return (
    <div className="flex items-center justify-between rounded bg-[#f0f0f4] px-2 py-1">
      <span className="font-mono text-[10px] text-[#6a7282]">{label}</span>
      <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${chipClass}`}>{value}</span>
    </div>
  )
}

function IntakeBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-[#f0f0f4] px-2 py-1.5">
      <p className="font-mono text-[9px] font-medium uppercase tracking-wide text-[#6a7282]">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

/** AI Intake mockup for How it Works step 2. */
export function Step2AiIntakeMockup() {
  return (
    <div className="rounded-xl border border-black/[0.04] bg-white p-[11px]">
      <div className="flex flex-col gap-2">
        <IntakeRow label="Category" value="Plumbing" chipClass="bg-[#dbeafe] text-[#1447e6]" />
        <IntakeRow label="Urgency" value="High" chipClass="bg-[#ffe2e2] text-[#c10007]" />
        <IntakeRow label="Unit" value="#204" chipClass="bg-[#f3f4f6] text-[#364153]" />

        <IntakeBlock label="AI generated summary">
          <p className="font-mono text-[9px] leading-[14px] text-[#364153]">
            Kitchen sink leak at drain connection. Tenant uploaded video showing steady drip.
            Likely P-trap or supply line — not emergency, needs plumber within 24h.
          </p>
        </IntakeBlock>

        <IntakeBlock label="Recommended action">
          <p className="font-mono text-[9px] leading-[14px] text-[#364153]">
            Dispatch vetted plumber · Ask tenant to shut off under-sink valves
          </p>
        </IntakeBlock>

        <IntakeBlock label="Work order">
          <div className="rounded border border-[#e5e7eb] bg-white px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[9px] text-[#6a7282]">MR-204813</span>
              <span className="rounded bg-[#dbeafe] px-1 py-0.5 font-mono text-[9px] text-[#1447e6]">
                Open
              </span>
            </div>
            <p className="mt-1 font-mono text-[10px] font-semibold text-[#1e2939]">Kitchen sink leak</p>
            <p className="font-mono text-[9px] text-[#99a1af]">Unit #204 · Plumbing · High</p>
          </div>
        </IntakeBlock>
      </div>
    </div>
  )
}
