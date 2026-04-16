import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useSessionAutoRefresh } from './hooks/useSessionAutoRefresh'
import { supabase } from './lib/supabase'
import { ResidentPortal } from './ResidentPortal'
import { VendorPortal } from './VendorPortal'
import { VendorAuthGate } from './components/VendorAuthGate'
import { VendorLoginPage } from './components/VendorLoginPage'
import { AdminAuthGate } from './components/AdminAuthGate'
import { AdminLayout } from './components/AdminLayout'
import { AdminLoginPage } from './components/AdminLoginPage'
import { AdminRequestManagementDashboard } from './components/AdminRequestManagementDashboard'
import { AdminNotificationManagementDashboard } from './components/AdminNotificationManagementDashboard'
import { AdminUserManagementDashboard } from './components/AdminUserManagementDashboard'

export default function App() {
  useSessionAutoRefresh(supabase)

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ResidentPortal />} />
        <Route path="/vendor/login" element={<VendorLoginPage />} />
        <Route
          path="/vendor"
          element={
            <VendorAuthGate>
              <VendorPortal />
            </VendorAuthGate>
          }
        />
        <Route
          path="/vendor/ticket/:ticketId"
          element={
            <VendorAuthGate>
              <VendorPortal />
            </VendorAuthGate>
          }
        />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route
          path="/admin"
          element={
            <AdminAuthGate>
              <AdminLayout />
            </AdminAuthGate>
          }
        >
          <Route index element={<AdminRequestManagementDashboard />} />
          <Route
            path="notifications"
            element={<AdminNotificationManagementDashboard />}
          />
          <Route path="users" element={<AdminUserManagementDashboard />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
