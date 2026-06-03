import type { ReactNode } from 'react'

type SmsBubbleProps = {
  align: 'left' | 'right'
  children: ReactNode
}

function SmsBubble({ align, children }: SmsBubbleProps) {
  const isResident = align === 'left'
  return (
    <div className={`flex ${isResident ? 'justify-start' : 'justify-end'} pt-1 first:pt-0`}>
      <p
        className={[
          'max-w-[152px] break-words px-2 py-0.5 font-mono text-[9px] leading-[14.625px]',
          isResident
            ? 'rounded-tl-2xl rounded-tr-2xl rounded-br-2xl rounded-bl-lg bg-white text-[#364153] shadow-[0_1px_1.5px_rgba(0,0,0,0.1),0_1px_1px_rgba(0,0,0,0.1)]'
            : 'rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl rounded-br-lg bg-[#10b981] text-white',
        ].join(' ')}
      >
        {children}
      </p>
    </div>
  )
}

/** Figma 462:391 — Resident SMS thread mockup for How it Works step 1. */
export function Step1SmsChatMockup() {
  return (
    <div className="rounded-xl border border-black/[0.04] bg-white p-[11px]">
      <div className="flex flex-col rounded-xl bg-[#e8e8ec] p-2">
        <SmsBubble align="left">My kitchen sink is leaking.</SmsBubble>
        <SmsBubble align="right">I can help with that</SmsBubble>
        <SmsBubble align="right">Can you send a photo or video?</SmsBubble>
        <SmsBubble align="left">📹 [Video uploaded]</SmsBubble>
        <SmsBubble align="right">
          Thanks. Leak is from drain connection. How severe?
        </SmsBubble>
        <SmsBubble align="right">
          <span className="block">• Slow drip</span>
          <span className="block">• Steady leak</span>
          <span className="block">• Active flooding</span>
        </SmsBubble>
        <SmsBubble align="left">Steady leak.</SmsBubble>
        <SmsBubble align="right">
          Got it. I&apos;ve marked the plumbing issue and will begin arranging service. To help
          prevent damage, please place a bucket under the leak and avoid using the sink if possible.
        </SmsBubble>
      </div>
    </div>
  )
}
