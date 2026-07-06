import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import uloLogo from '@/assets/landing/ulo-logo.png'

type LegalDocumentLayoutProps = {
  title: string
  subtitle: string
  effectiveDate: string
  version: string
  children: ReactNode
}

export function LegalDocumentLayout({
  title,
  subtitle,
  effectiveDate,
  version,
  children,
}: LegalDocumentLayoutProps) {
  return (
    <div className="min-h-dvh bg-[#f9fafb] font-[family-name:var(--font-admin)] text-[#101828]">
      <header className="border-b border-[#e5e7eb] bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-5 sm:px-8">
          <Link to="/" className="shrink-0">
            <img src={uloLogo} alt="Ulo Home" className="h-8 w-auto object-contain" />
          </Link>
          <Link
            to="/"
            className="text-[13px] font-medium text-[#6a7282] transition-colors hover:text-[#101828]"
          >
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10 sm:px-8 sm:py-14">
        <div className="rounded-[12px] border border-[#e5e7eb] bg-white px-6 py-8 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] sm:px-10 sm:py-10">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#9E439F]">
            Ulo Home, Inc.
          </p>
          <h1 className="mt-2 text-[28px] font-semibold leading-9 tracking-[-0.5px] text-[#101828] sm:text-[32px] sm:leading-10">
            {title}
          </h1>
          <p className="mt-2 text-[15px] leading-6 text-[#6a7282]">{subtitle}</p>
          <p className="mt-4 text-[13px] text-[#6a7282]">
            Effective Date: {effectiveDate} · Version {version}
          </p>

          <div className="mt-10 space-y-10 text-[15px] leading-7 text-[#364153]">{children}</div>
        </div>
      </main>

      <footer className="border-t border-[#e5e7eb] bg-white px-6 py-8 text-center text-[13px] text-[#6a7282]">
        <p>© {new Date().getFullYear()} Ulo Home, Inc. All rights reserved.</p>
      </footer>
    </div>
  )
}
