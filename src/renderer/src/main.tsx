import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const renderFatal = (message: string): void => {
  const root = document.getElementById('root')
  if (!root) return
  root.innerHTML = `
    <div style="font-family:-apple-system,system-ui;padding:24px;background:#0b1020;color:#e5e7eb;min-height:100vh;">
      <h2 style="margin:0 0 12px;">ClawLite UI failed to load</h2>
      <p style="margin:0 0 8px;">${message.replace(/</g, '&lt;')}</p>
      <p style="margin:0;opacity:.8;">Please reinstall the latest build. If this persists, send this screen to support.</p>
    </div>
  `
}

const initApp = async (): Promise<void> => {
  try {
    const { default: i18n } = await import('@shared/i18n')
    try {
      const locale = await window.electronAPI.i18n.getLocale()
      await i18n.changeLanguage(locale)
    } catch {
      /* fallback to default */
    }

    const rootEl = document.getElementById('root')
    if (!rootEl) throw new Error('Missing #root element')

    createRoot(rootEl).render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    renderFatal(msg)
  }
}

window.addEventListener('error', (e) => {
  renderFatal(e.message || 'Unknown renderer error')
})

window.addEventListener('unhandledrejection', (e) => {
  const reason = (e as PromiseRejectionEvent).reason
  renderFatal(reason instanceof Error ? reason.message : String(reason))
})

initApp()
