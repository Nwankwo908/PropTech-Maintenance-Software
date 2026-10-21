import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { PrivacyPolicyPage } from '@/components/legal/PrivacyPolicyPage'
import { TermsOfServicePage } from '@/components/legal/TermsOfServicePage'
import { PRIVACY_POLICY_META } from '@/lib/legal/privacyPolicyContent'
import { TERMS_OF_SERVICE_META } from '@/lib/legal/termsOfServiceContent'
import { DEFAULT_ULO_APP_ORIGIN, uloAppUrl } from '@/lib/uloAppUrl'
import { applyDocumentHead, applyRootMarkup } from '@/prerender/htmlShell'

/**
 * Use MemoryRouter from react-router-dom (same package as useLocation in legal
 * pages). StaticRouter from `react-router` alone can resolve to a separate copy
 * under some install layouts and break prerender with "useLocation() may be
 * used only in the context of a <Router>".
 */
function prerenderRoute(pathname: string, page: ReactElement): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[pathname]} initialIndex={0}>
      {page}
    </MemoryRouter>,
  )
}

export function writePrerenderedPages(outDir: string): void {
  const shell = readFileSync(path.join(outDir, 'index.html'), 'utf8')

  writePage(outDir, path.join('terms', 'index.html'), shell, {
    title: `${TERMS_OF_SERVICE_META.title} | Ulo`,
    description: TERMS_OF_SERVICE_META.subtitle,
    canonicalPath: '/terms',
    markup: prerenderRoute('/terms', <TermsOfServicePage />),
  })

  writePage(outDir, path.join('privacy', 'index.html'), shell, {
    title: `${PRIVACY_POLICY_META.title} | Ulo`,
    description: PRIVACY_POLICY_META.subtitle,
    canonicalPath: '/privacy',
    markup: prerenderRoute('/privacy', <PrivacyPolicyPage />),
  })
}

function writePage(
  outDir: string,
  relativePath: string,
  shell: string,
  page: { title: string; description: string; canonicalPath: string; markup: string },
) {
  const html = applyRootMarkup(
    applyDocumentHead(shell, {
      title: page.title,
      description: page.description,
      canonical: uloAppUrl.absolute(page.canonicalPath, DEFAULT_ULO_APP_ORIGIN),
    }),
    page.markup,
  )
  const target = path.join(outDir, relativePath)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, html)
}
