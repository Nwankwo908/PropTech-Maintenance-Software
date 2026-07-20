import { Link } from 'react-router-dom'
import { PRIVACY_POLICY_PATH } from '@/lib/legal/privacyPolicyContent'
import type { LegalBlock } from '@/lib/legal/termsOfServiceContent'

function renderInlineLinks(text: string) {
  const parts = text.split(/(\/privatepolicy(?:#[\w-]+)?|\/privacy)/g)
  return parts.map((part, index) => {
    if (part === '/privacy' || part.startsWith('/privatepolicy')) {
      return (
        <Link
          key={`privacy-${index}`}
          to={PRIVACY_POLICY_PATH}
          className="font-medium text-[#9E439F] underline underline-offset-2 hover:text-[#7f3680]"
        >
          Privacy Policy
        </Link>
      )
    }
    return part
  })
}

export function LegalContentBlocks({ blocks }: { blocks: LegalBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        if (block.type === 'paragraph') {
          return (
            <p key={index} className="text-[15px] leading-7 text-[#364153]">
              {renderInlineLinks(block.text)}
            </p>
          )
        }

        if (block.type === 'caps') {
          return (
            <p
              key={index}
              className="rounded-[8px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-[13px] font-semibold uppercase leading-6 tracking-[0.02em] text-[#101828]"
            >
              {block.text}
            </p>
          )
        }

        return (
          <ul key={index} className="list-disc space-y-2 pl-5 text-[15px] leading-7 text-[#364153]">
            {block.items.map((item) => (
              <li key={item}>{renderInlineLinks(item)}</li>
            ))}
          </ul>
        )
      })}
    </div>
  )
}
