import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { LegalContentBlocks } from '@/components/legal/LegalContentBlocks'
import { LegalDocumentLayout } from '@/components/legal/LegalDocumentLayout'
import {
  TERMS_OF_SERVICE_META,
  TERMS_OF_SERVICE_PREAMBLE,
  TERMS_OF_SERVICE_SECTIONS,
} from '@/lib/legal/termsOfServiceContent'

export function TermsOfServicePage() {
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
      title={TERMS_OF_SERVICE_META.title}
      subtitle={TERMS_OF_SERVICE_META.subtitle}
      effectiveDate={TERMS_OF_SERVICE_META.effectiveDate}
      version={TERMS_OF_SERVICE_META.version}
    >
      <section aria-labelledby="terms-preamble">
        <h2 id="terms-preamble" className="sr-only">
          Preamble
        </h2>
        <LegalContentBlocks blocks={TERMS_OF_SERVICE_PREAMBLE} />
      </section>

      {TERMS_OF_SERVICE_SECTIONS.map((section) => (
        <section key={section.id} aria-labelledby={`terms-${section.id}`}>
          <h2
            id={`terms-${section.id}`}
            className="text-[18px] font-semibold leading-7 tracking-[-0.2px] text-[#101828]"
          >
            {section.title}
          </h2>

          {section.blocks.length > 0 ? (
            <div className="mt-4">
              <LegalContentBlocks blocks={section.blocks} />
            </div>
          ) : null}

          {section.subsections?.map((subsection) => (
            <div key={subsection.id} className="mt-6">
              <h3
                id={subsection.id}
                className="scroll-mt-24 text-[16px] font-semibold leading-6 text-[#101828]"
              >
                {subsection.title}
              </h3>
              <div className="mt-3">
                <LegalContentBlocks blocks={subsection.blocks} />
              </div>
            </div>
          ))}
        </section>
      ))}
    </LegalDocumentLayout>
  )
}
