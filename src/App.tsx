import { lazy, Suspense, useEffect, type ComponentType } from 'react'
import { BrowserRouter, Navigate, Outlet, Routes, Route } from 'react-router-dom'
import { useSessionAutoRefresh } from './hooks/useSessionAutoRefresh'
import { supabase } from './lib/supabase'
import { AnalyticsRoot } from './components/AnalyticsRoot'
import { ReferralLandingRedirect } from './components/ReferralLandingRedirect'
import { StayOnDevOrigin } from './components/StayOnDevOrigin'
import { LandingPage } from './components/landing/LandingPage'
import { DemoPageRedirect } from './components/DemoPageRedirect'
import { hasWaitlistOAuthIntent } from './lib/landingWaitlist'
import { hasAdminGoogleOAuthIntent, isOAuthReturnUrl } from './lib/googleIdentitySignIn'
import { thumbtackOauthParamsFromSearch } from './lib/uloAppUrl'
import {
  completeThumbtackOauthFromSearch,
  notifyThumbtackOauthOpener,
} from './lib/completeThumbtackOauth'
import { TermsOfServicePage } from './components/legal/TermsOfServicePage'
import { PrivacyPolicyPage } from './components/legal/PrivacyPolicyPage'

function lazyNamed<Props>(
  importer: () => Promise<Record<string, ComponentType<Props>>>,
  exportName: string,
) {
  return lazy(async () => {
    const mod = await importer()
    const Comp = mod[exportName]
    if (!Comp) {
      throw new Error(`lazyNamed: missing export "${exportName}"`)
    }
    return { default: Comp }
  })
}

const ResidentPortal = lazyNamed(() => import('./ResidentPortal'), 'ResidentPortal')
const VendorPortal = lazyNamed(() => import('./VendorPortal'), 'VendorPortal')
const VendorAuthGate = lazy(() => import('./components/VendorAuthGate'))
const AdminAuthGate = lazyNamed(() => import('./components/AdminAuthGate'), 'AdminAuthGate')
const AdminLayout = lazyNamed(() => import('./components/AdminLayout'), 'AdminLayout')
const AdminLoginPage = lazyNamed(() => import('./components/AdminLoginPage'), 'AdminLoginPage')
const AuthCallback = lazyNamed(() => import('./components/AuthCallback'), 'AuthCallback')
const AdminOverviewDashboard = lazyNamed(
  () => import('./components/AdminOverviewDashboard'),
  'AdminOverviewDashboard',
)
const AdminPropertiesDashboard = lazyNamed(
  () => import('./components/AdminPropertiesDashboard'),
  'AdminPropertiesDashboard',
)
const AdminPropertyDetailDashboard = lazyNamed(
  () => import('./components/AdminPropertyDetailDashboard'),
  'AdminPropertyDetailDashboard',
)
const AdminPropertyResidentDetailDashboard = lazyNamed(
  () => import('./components/AdminPropertyResidentDetailDashboard'),
  'AdminPropertyResidentDetailDashboard',
)
const AdminRequestManagementDashboard = lazyNamed(
  () => import('./components/AdminRequestManagementDashboard'),
  'AdminRequestManagementDashboard',
)
const AdminWorkflowOperationsDashboard = lazyNamed(
  () => import('./components/AdminWorkflowOperationsDashboard'),
  'AdminWorkflowOperationsDashboard',
)
const AdminCommunicationDashboard = lazyNamed(
  () => import('./components/AdminCommunicationDashboard'),
  'AdminCommunicationDashboard',
)
const AdminVendorsDashboard = lazyNamed(
  () => import('./components/AdminVendorsDashboard'),
  'AdminVendorsDashboard',
)
const AdminVendorDetailDashboard = lazyNamed(
  () => import('./components/AdminVendorDetailDashboard'),
  'AdminVendorDetailDashboard',
)
const AdminResidentsDashboard = lazyNamed(
  () => import('./components/AdminResidentsDashboard'),
  'AdminResidentsDashboard',
)
const AdminAnalyticsDashboard = lazyNamed(
  () => import('./components/AdminAnalyticsDashboard'),
  'AdminAnalyticsDashboard',
)
const AdminSettingsDashboard = lazyNamed(
  () => import('./components/AdminSettingsDashboard'),
  'AdminSettingsDashboard',
)
const AdminOnboardingDashboard = lazyNamed(
  () => import('./components/AdminOnboardingDashboard'),
  'AdminOnboardingDashboard',
)
const AdminOnboardingGuard = lazyNamed(
  () => import('./components/AdminOnboardingGuard'),
  'AdminOnboardingGuard',
)
const VendorIntakePortal = lazyNamed(() => import('./VendorIntakePortal'), 'VendorIntakePortal')
const WorkOrderPublicPage = lazyNamed(
  () => import('./components/WorkOrderPublicPage'),
  'WorkOrderPublicPage',
)
const WorkOrderEstimatePage = lazyNamed(
  () => import('./components/WorkOrderEstimatePage'),
  'WorkOrderEstimatePage',
)
const EstimateDecisionResultPage = lazyNamed(
  () => import('./components/EstimateDecisionResultPage'),
  'EstimateDecisionResultPage',
)
const WorkOrderUploadPage = lazyNamed(
  () => import('./components/WorkOrderUploadPage'),
  'WorkOrderUploadPage',
)
const WorkOrderInvoicePage = lazyNamed(
  () => import('./components/WorkOrderInvoicePage'),
  'WorkOrderInvoicePage',
)
const RentPaymentPage = lazyNamed(() => import('./components/RentPaymentPage'), 'RentPaymentPage')
const InspectionCapturePage = lazyNamed(
  () => import('./components/InspectionCapturePage'),
  'InspectionCapturePage',
)

function ThumbtackOauthRootReturn() {
  useEffect(() => {
    void completeThumbtackOauthFromSearch(window.location.search).then((result) => {
      const ok = Boolean(result.handled && !result.error)
      if (notifyThumbtackOauthOpener({ ok, error: result.error })) return
      window.location.replace(
        result.error
          ? '/admin?thumbtack=error'
          : (result.returnPath || '/admin?thumbtack=connected'),
      )
    })
  }, [])
  return null
}

function LandingOrAdminOAuthReturn() {
  if (typeof window !== 'undefined' && thumbtackOauthParamsFromSearch(window.location.search)) {
    return <ThumbtackOauthRootReturn />
  }
  const treatAsAdminCallback =
    typeof window !== 'undefined' &&
    isOAuthReturnUrl(window.location.search, window.location.hash) &&
    (hasAdminGoogleOAuthIntent() || !hasWaitlistOAuthIntent())
  if (treatAsAdminCallback) return <AuthCallback />
  return <LandingPage />
}

export default function App() {
  useSessionAutoRefresh(supabase)

  // #region agent log
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      fetch('http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5d0562'},body:JSON.stringify({sessionId:'5d0562',runId:'pre-fix',hypothesisId:'A',location:'App.tsx:window.error',message:'window error',data:{message:event.message,filename:event.filename,lineno:event.lineno,colno:event.colno,stack:event.error instanceof Error ? event.error.stack : null,href:window.location.href},timestamp:Date.now()})}).catch(()=>{});
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      fetch('http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5d0562'},body:JSON.stringify({sessionId:'5d0562',runId:'pre-fix',hypothesisId:'D',location:'App.tsx:unhandledrejection',message:'unhandled rejection',data:{reason:reason instanceof Error ? {message:reason.message,stack:reason.stack} : String(reason),href:window.location.href},timestamp:Date.now()})}).catch(()=>{});
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  // #endregion

  return (
    <BrowserRouter>
      <StayOnDevOrigin />
      <AnalyticsRoot />
      <ReferralLandingRedirect />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<LandingOrAdminOAuthReturn />} />
          <Route path="/demo" element={<DemoPageRedirect />} />
          <Route path="/terms" element={<TermsOfServicePage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/privatepolicy" element={<Navigate to="/privacy" replace />} />
          <Route path="/request" element={<ResidentPortal />} />
          <Route path="/v/:token" element={<VendorIntakePortal />} />
          <Route path="/w/:token" element={<WorkOrderPublicPage />} />
          <Route path="/estimate-decision" element={<EstimateDecisionResultPage />} />
          <Route path="/estimate/:token" element={<WorkOrderEstimatePage />} />
          <Route path="/upload/:token" element={<WorkOrderUploadPage />} />
          <Route path="/invoice/:token" element={<WorkOrderInvoicePage />} />
          <Route path="/pay/rent" element={<RentPaymentPage />} />
          <Route path="/inspection/capture/:sessionId" element={<InspectionCapturePage />} />

          <Route
            path="/vendor/*"
            element={
              <VendorAuthGate>
                <VendorPortal />
              </VendorAuthGate>
            }
          />

          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin/get-started" element={<AdminLoginPage />} />
          <Route
            path="/admin"
            element={
              <AdminAuthGate>
                <AdminLayout />
              </AdminAuthGate>
            }
          >
            {/* Route segments must match `ADMIN_NAV_TREE` — see adminNavigation.test.ts */}
            <Route element={<AdminOnboardingGuard />}>
              <Route index element={<AdminOverviewDashboard />} />
              <Route path="onboarding" element={<AdminOnboardingDashboard />} />
              <Route path="properties" element={<AdminPropertiesDashboard />} />
              <Route path="properties/:propertySlug" element={<AdminPropertyDetailDashboard />} />
              <Route
                path="properties/:propertySlug/residents/:residentId"
                element={<AdminPropertyResidentDetailDashboard />}
              />
              <Route path="communication" element={<AdminCommunicationDashboard />} />
              <Route path="requests" element={<AdminRequestManagementDashboard />} />
              <Route path="vendors" element={<AdminVendorsDashboard />} />
              <Route path="vendors/:vendorId" element={<AdminVendorDetailDashboard />} />
              <Route path="workflows" element={<AdminWorkflowOperationsDashboard />} />
              <Route path="residents" element={<Outlet />}>
                <Route index element={<AdminResidentsDashboard />} />
                <Route path=":residentId" element={<AdminPropertyResidentDetailDashboard />} />
              </Route>
              <Route path="analytics" element={<AdminAnalyticsDashboard />} />
              <Route path="settings/*" element={<AdminSettingsDashboard />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
