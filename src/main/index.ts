import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerIpcHandlers, getSavedLocale } from './ipc-handlers'
import { createTray, startPolling, destroyTray } from './services/tray-manager'
import { setupAutoUpdater, checkForUpdates } from './services/updater'
import { startGateway } from './services/gateway'
import { initI18nMain } from '../shared/i18n/main'
import icon from '../../resources/icon.png?asset'

let ipcRegistered = false
let mainWindow: BrowserWindow | null = null
let isQuitting = false

// macOS white-screen mitigation on some GPUs/drivers
if (process.platform === 'darwin') app.disableHardwareAcceleration()

const getWin = (): BrowserWindow | null => mainWindow

function createWindow(): void {
  // macOS: always show window on app launch (double-click should never be hidden).
  // Windows/Linux keep --hidden support for tray auto-start flows.
  const startHidden = process.platform !== 'darwin' && process.argv.includes('--hidden')
  let userHidden = false
  let didRetryLocalLoad = false
  let selfHealDone = false

  mainWindow = new BrowserWindow({
    width: 800,
    height: 700,
    minWidth: 800,
    minHeight: 700,
    resizable: true,
    // macOS: show immediately to avoid hidden-window edge cases on launch.
    show: process.platform === 'darwin',
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!startHidden) {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (!startHidden) {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })

  // Fallback: ensure window is visible even if ready-to-show is delayed.
  setTimeout(() => {
    if (!startHidden && !userHidden && mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
  }, 1500)

  // Close window → stay in tray (not a real quit)
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      userHidden = true
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      const isExternalSafe = ['https:', 'tg:'].includes(url.protocol)
      const isLocalWebChat =
        url.protocol === 'http:' &&
        (url.hostname === '127.0.0.1' || url.hostname === 'localhost')

      if (isExternalSafe || isLocalWebChat) {
        shell.openExternal(details.url)
      }
    } catch {
      /* invalid URL — ignore */
    }
    return { action: 'deny' }
  })

  if (!ipcRegistered) {
    registerIpcHandlers(getWin)
    ipcRegistered = true
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.on('did-fail-load', () => {
    // Fallback to packaged renderer when load fails (one-shot)
    if (didRetryLocalLoad) return
    didRetryLocalLoad = true
    mainWindow?.loadFile(join(__dirname, '../renderer/index.html')).catch(() => {})
  })

  mainWindow.webContents.on('render-process-gone', () => {
    mainWindow
      ?.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            '<html><body style="font-family:-apple-system,system-ui;padding:24px;background:#0b1020;color:#e5e7eb"><h2>ClawLite Renderer Crashed</h2><p>Please reinstall the latest build and try again.</p></body></html>'
          )
      )
      .catch(() => {})
  })

  mainWindow.webContents.on('did-finish-load', () => {
    // White-screen self-heal: only run once on app pages, not on data: fallback pages.
    if (selfHealDone || !mainWindow) return
    const currentUrl = mainWindow.webContents.getURL()
    if (currentUrl.startsWith('data:')) return
    if (!(currentUrl.startsWith('file:') || currentUrl.startsWith('http://localhost') || currentUrl.startsWith('http://127.0.0.1'))) return

    selfHealDone = true
    setTimeout(async () => {
      try {
        const hasUi = await mainWindow?.webContents.executeJavaScript(
          "(() => { const r=document.querySelector('#root'); return !!r && r.childElementCount > 0; })()"
        )
        if (!hasUi && mainWindow) {
          await mainWindow.loadURL(
            'data:text/html;charset=utf-8,' +
              encodeURIComponent(
                '<html><body style="font-family:-apple-system,system-ui;padding:24px;background:#0b1020;color:#e5e7eb"><h2>ClawLite UI failed to render</h2><p>Renderer loaded but no UI was mounted.</p><p>Please download the latest release and retry. If issue persists, send this message to support.</p></body></html>'
              )
          )
        }
      } catch {
        /* ignore */
      }
    }, 1500)
  })

  // Auto-start Gateway when launched hidden
  if (startHidden) {
    startGateway().catch(() => {})
  }
}

app.on('before-quit', () => {
  isQuitting = true
})

app.whenReady().then(async () => {
  await initI18nMain(getSavedLocale())
  electronApp.setAppUserModelId('com.clawlite.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  // System tray
  createTray({
    getWin,
    onQuit: async () => {
      isQuitting = true
      app.quit()
    }
  })
  startPolling()

  // Auto update
  setupAutoUpdater(getWin)
  setTimeout(checkForUpdates, 5000)

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
})

// Stay in tray — keep app alive even when all windows are closed
app.on('window-all-closed', () => {
  // Do not quit in tray mode
})

app.on('quit', () => {
  destroyTray()
})
