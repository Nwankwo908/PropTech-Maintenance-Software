import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { LegalContentBlocks } from '@/components/legal/LegalContentBlocks'
import { LegalDocumentLayout } from '@/components/legal/LegalDocumentLayout'
import {
  PRIVACY_POLICY_META,
  PRIVACY_POLICY_SECTIONS,
} from '@/lib/legal/privacyPolicyContent'

export function PrivacyPolicyPage() {
  const location = useLocation()

  useEffect(() => {
    if (!location.hash) return
    const id = decodeURIComponent(location.hash.slice(1))
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [location.hash, location.pathname])

  return (
    <LegalDocumentLayout
      title={PRIVACY_POLICY_META.title}
      subtitle={PRIVACY_POLICY_META.subtitle}
      effectiveDate={PRIVACY_POLICY_META.effectiveDate}
      version={PRIVACY_POLICY_META.version}
    >
      {PRIVACY_POLICY_SECTIONS.map((section) => (
        <section
          key={section.id}
          id={section.id === 'your-rights' ? 'opt-out' : section.id}
          aria-labelledby={`privacy-${section.id}`}
          className="scroll-mt-24"
        >
          <h2
            id={`privacy-${section.id}`}
            className="text-[18px] font-semibold leading-7 tracking-[-0.2px] text-[#101828]"
          >
            {section.title}
          </h2>

          {section.blocks.length > 0 ? (
            <div className="mt-4">
              <LegalContentBlocks blocks={section.blocks} />
            </div>
          ) : null}
        </section>
      ))}
    </LegalDocumentLayout>
  )
}
