import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import { useSessionAutoRefresh } from './hooks/useSessionAutoRefresh'
import { supabase } from './lib/supabase'
import { ReferralLandingRedirect } from './components/ReferralLandingRedirect'
import { LandingPage } from './components/landing/LandingPage'
import { DemoPageRedirect } from './components/DemoPageRedirect'
import { ResidentPortal } from './ResidentPortal'
import { VendorPortal } from './VendorPortal'
import VendorAuthGate from './components/VendorAuthGate'
import { AdminAuthGate } from './components/AdminAuthGate'
import { AdminLayout } from './components/AdminLayout'
import { AdminLoginPage } from './components/AdminLoginPage'
import { AuthCallback } from './components/AuthCallback'
import { AdminOverviewDashboard } from './components/AdminOverviewDashboard'
import { AdminPropertiesDashboard } from './components/AdminPropertiesDashboard'
import { AdminPropertyDetailDashboard } from './components/AdminPropertyDetailDashboard'
import { AdminPropertyResidentDetailDashboard } from './components/AdminPropertyResidentDetailDashboard'
import { AdminRequestManagementDashboard } from './components/AdminRequestManagementDashboard'
import { AdminWorkflowOperationsDashboard } from './components/AdminWorkflowOperationsDashboard'
import { AdminCommunicationDashboard } from './components/AdminCommunicationDashboard'
import { AdminVendorsDashboard } from './components/AdminVendorsDashboard'
import { AdminVendorDetailDashboard } from './components/AdminVendorDetailDashboard'
import { AdminResidentsDashboard } from './components/AdminResidentsDashboard'
import { AdminAnalyticsDashboard } from './components/AdminAnalyticsDashboard'
import { AdminSettingsDashboard } from './components/AdminSettingsDashboard'
import { AdminOnboardingDashboard } from './components/AdminOnboardingDashboard'
import { AdminOnboardingGuard } from './components/AdminOnboardingGuard'
import { TermsOfServicePage } from './components/legal/TermsOfServicePage'
import { PrivacyPolicyPage } from './components/legal/PrivacyPolicyPage'
import { VendorIntakePortal } from './VendorIntakePortal'
import { WorkOrderPublicPage } from './components/WorkOrderPublicPage'
import { WorkOrderEstimatePage } from './components/WorkOrderEstimatePage'
import { WorkOrderUploadPage } from './components/WorkOrderUploadPage'
import { WorkOrderInvoicePage } from './components/WorkOrderInvoicePage'
import { RentPaymentPage } from './components/RentPaymentPage'

export default function App() {
  useSessionAutoRefresh(supabase)

  return (
    <BrowserRouter>
      <ReferralLandingRedirect />
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
            <Route path="residents" element={<AdminResidentsDashboard />} />
            <Route path="analytics" element={<AdminAnalyticsDashboard />} />
            <Route path="settings/*" element={<AdminSettingsDashboard />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
