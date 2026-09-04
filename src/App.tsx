import { lazy, Suspense, type ComponentType } from 'react'
import { BrowserRouter, Navigate, Outlet, Routes, Route } from 'react-router-dom'
import { useSessionAutoRefresh } from './hooks/useSessionAutoRefresh'
import { supabase } from './lib/supabase'
import { ReferralLandingRedirect } from './components/ReferralLandingRedirect'
import { LandingPage } from './components/landing/LandingPage'
import { DemoPageRedirect } from './components/DemoPageRedirect'
import { TermsOfServicePage } from './components/legal/TermsOfServicePage'
import { PrivacyPolicyPage } from './components/legal/PrivacyPolicyPage'

function lazyNamed<Props>(
  importer: () => Promise<Record<string, ComponentType<Props>>>,
  exportName: string,
) {
  return lazy(async () => {
    const mod = await importer()
    return { default: mod[exportName] }
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

export default function App() {
  useSessionAutoRefresh(supabase)

  return (
    <BrowserRouter>
      <ReferralLandingRedirect />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/demo" element={<DemoPageRedirect />} />
          <Route path="/terms" element={<TermsOfServicePage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/privatepolicy" element={<Navigate to="/privacy" replace />} />
          <Route path="/request" element={<ResidentPortal />} />
          <Route path="/v/:token" element={<VendorIntakePortal />} />
          <Route path="/w/:token" element={<WorkOrderPublicPage />} />
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
