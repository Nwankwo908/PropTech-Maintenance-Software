import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installLoopbackNavigationGuards } from './lib/inAppRouterPath'

installLoopbackNavigationGuards()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
document.getElementById('ulo-boot')?.remove()
