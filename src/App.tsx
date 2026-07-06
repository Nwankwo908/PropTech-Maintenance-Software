import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useSessionAutoRefresh } from './hooks/useSessionAutoRefresh'
import { supabase } from './lib/supabase'
import { ReferralLandingRedirect } from './components/ReferralLandingRedirect'
import { LandingPage } from './components/landing/LandingPage'
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
import { AdminNotificationManagementDashboard } from './components/AdminNotificationManagementDashboard'
import { AdminCommunicationDashboard } from './components/AdminCommunicationDashboard'
import { AdminVendorsDashboard } from './components/AdminVendorsDashboard'
import { AdminResidentsDashboard } from './components/AdminResidentsDashboard'
import { AdminAnalyticsDashboard } from './components/AdminAnalyticsDashboard'
import { AdminSettingsDashboard } from './components/AdminSettingsDashboard'
import { AdminUserManagementDashboard } from './components/AdminUserManagementDashboard'
import { AdminOnboardingDashboard } from './components/AdminOnboardingDashboard'
import { AdminOnboardingGuard } from './components/AdminOnboardingGuard'
import { TermsOfServicePage } from './components/legal/TermsOfServicePage'

export default function App() {
  useSessionAutoRefresh(supabase)

  return (
    <BrowserRouter>
      <ReferralLandingRedirect />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/terms" element={<TermsOfServicePage />} />
        <Route path="/request" element={<ResidentPortal />} />

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
          <Route element={<AdminOnboardingGuard />}>
            <Route index element={<AdminOverviewDashboard />} />
            <Route path="onboarding" element={<AdminOnboardingDashboard />} />
            <Route path="properties" element={<AdminPropertiesDashboard />} />
            <Route path="properties/:buildingSlug" element={<AdminPropertyDetailDashboard />} />
            <Route
              path="properties/:buildingSlug/residents/:residentId"
              element={<AdminPropertyResidentDetailDashboard />}
            />
            <Route path="communication" element={<AdminCommunicationDashboard />} />
            <Route path="requests" element={<AdminRequestManagementDashboard />} />
            <Route path="vendors" element={<AdminVendorsDashboard />} />
            <Route path="workflows" element={<AdminWorkflowOperationsDashboard />} />
            <Route path="residents" element={<AdminResidentsDashboard />} />
            <Route path="analytics" element={<AdminAnalyticsDashboard />} />
            <Route path="settings/*" element={<AdminSettingsDashboard />} />
            <Route
              path="notifications"
              element={<AdminNotificationManagementDashboard />}
            />
            <Route path="users" element={<AdminUserManagementDashboard />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
