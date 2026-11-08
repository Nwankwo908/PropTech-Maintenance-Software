import { matchPath } from 'react-router-dom'
import type { AdminBreadcrumbItem } from '@/components/AdminBreadcrumb'
import { ADMIN_NAV_TREE, type AdminNavNode } from '@/lib/adminNavigation'

const DASHBOARD: AdminBreadcrumbItem = { label: 'Dashboard', to: '/admin' }

/** Current-page labels that differ from the nav registry. */
const CURRENT_PAGE_LABEL: Partial<Record<AdminNavNode['id'], string>> = {
  property_detail: 'Property Overview',
  settings_billing: 'Subscription & Billing',
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.split('?')[0]?.split('#')[0] ?? pathname
  if (trimmed.length > 1 && trimmed.endsWith('/')) return trimmed.slice(0, -1)
  return trimmed || '/admin'
}

function nodeMatches(node: AdminNavNode, pathname: string): boolean {
  if (node.id === 'overview') return pathname === '/admin'
  if (node.path.includes(':')) {
    return matchPath({ path: node.path, end: false }, pathname) != null
  }
  const pattern = node.path.replace(/\/\*$/, '')
  return pathname === pattern || pathname.startsWith(`${pattern}/`)
}

function findChain(nodes: AdminNavNode[], pathname: string): AdminNavNode[] | null {
  for (const node of nodes) {
    if (!nodeMatches(node, pathname)) continue
    const deeper = node.children?.length ? findChain(node.children, pathname) : null
    if (deeper) return [node, ...deeper]
    return [node]
  }
  return null
}

function hrefFor(node: AdminNavNode, pathname: string): string {
  if (!node.path.includes(':')) return node.path.replace(/\/\*$/, '')
  const match = matchPath({ path: node.path, end: false }, pathname)
  if (!match?.params) return node.path
  return node.path.replace(/:([^/]+)/g, (_, key: string) => {
    const value = match.params[key]
    return typeof value === 'string' ? value : ''
  })
}

/**
 * Trail for the admin shell. Work orders keep their own trail inside the page
 * because it follows the open request, property, and search.
 */
export function adminPageBreadcrumbItems(pathname: string): AdminBreadcrumbItem[] {
  const path = normalizePath(pathname)
  if (path === '/admin/requests' || path.startsWith('/admin/requests/')) return []
  if (!path.startsWith('/admin')) return []

  if (path === '/admin') return [{ label: 'Dashboard' }]

  const chain = (findChain(ADMIN_NAV_TREE, path) ?? []).filter((node) => node.id !== 'overview')
  const crumbs: AdminBreadcrumbItem[] = chain.map((node, index) => {
    const current = index === chain.length - 1
    return {
      label: CURRENT_PAGE_LABEL[node.id] ?? node.label,
      to: current ? undefined : hrefFor(node, path),
    }
  })
  return [DASHBOARD, ...crumbs]
}
