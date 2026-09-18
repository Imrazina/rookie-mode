import { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

let controlWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let overlayResizeTimer: NodeJS.Timeout | null = null
const windowPreferences = { preload: join(__dirname, '../preload/index.js'), sandbox: false }

function loadRenderer(window: BrowserWindow, overlay = false): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${overlay ? '?overlay=1' : ''}`)
  else window.loadFile(join(__dirname, '../renderer/index.html'), overlay ? { query: { overlay: '1' } } : undefined)
}

function createControlWindow(): void {
  controlWindow = new BrowserWindow({ width: 900, height: 700, minWidth: 760, minHeight: 620, show: false, autoHideMenuBar: true, backgroundColor: '#0c0e12', ...(process.platform === 'linux' ? { icon } : {}), webPreferences: windowPreferences })
  controlWindow.on('ready-to-show', () => controlWindow?.show())
  controlWindow.webContents.setWindowOpenHandler((details) => { shell.openExternal(details.url); return { action: 'deny' } })
  loadRenderer(controlWindow)
}

function createOverlayWindow(): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  overlayWindow = new BrowserWindow({ ...display.bounds, show: false, frame: false, fullscreen: false, transparent: true, resizable: false, movable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, hasShadow: false, backgroundColor: '#00000000', webPreferences: windowPreferences })
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  loadRenderer(overlayWindow, true)
}

function resizeOverlay(mode: 'idle' | 'explanation', animate = true): void {
  if (!overlayWindow) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  const target = mode === 'idle'
    ? { x: x + width - 174, y: y + height - 72, width: 146, height: 36 }
    : { x: x + width - 408, y: y + height - 332, width: 380, height: 268 }

  if (!animate) {
    overlayWindow.setBounds(target)
    return
  }

  if (overlayResizeTimer) clearInterval(overlayResizeTimer)
  const start = overlayWindow.getBounds()
  const startedAt = Date.now()
  overlayResizeTimer = setInterval(() => {
    if (!overlayWindow) return
    const progress = Math.min((Date.now() - startedAt) / 180, 1)
    const eased = 1 - Math.pow(1 - progress, 3)
    overlayWindow.setBounds({
      x: Math.round(start.x + (target.x - start.x) * eased),
      y: Math.round(start.y + (target.y - start.y) * eased),
      width: Math.round(start.width + (target.width - start.width) * eased),
      height: Math.round(start.height + (target.height - start.height) * eased)
    })
    if (progress === 1 && overlayResizeTimer) {
      clearInterval(overlayResizeTimer)
      overlayResizeTimer = null
    }
  }, 16)
}

function startRookieMode(): void {
  if (!controlWindow || !overlayWindow) return
  resizeOverlay('idle', false)
  controlWindow.hide()
  overlayWindow.showInactive()
}

function stopRookieMode(): void {
  overlayWindow?.webContents.send('rookie:hide-explanation')
  overlayWindow?.hide()
  controlWindow?.show()
  controlWindow?.focus()
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.rookie.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  ipcMain.on('rookie:start', startRookieMode)
  ipcMain.on('rookie:set-overlay-mode', (_, mode: 'idle' | 'explanation') => resizeOverlay(mode))
  if (is.dev) ipcMain.on('rookie:submit-transcript', (_, transcript: string) => overlayWindow?.webContents.send('rookie:transcript', transcript))
  createControlWindow()
  createOverlayWindow()
  globalShortcut.register('Control+Shift+R', stopRookieMode)
  if (is.dev) globalShortcut.register('Control+Shift+D', () => overlayWindow?.webContents.send('rookie:show-demo'))
  if (is.dev) globalShortcut.register('Control+Shift+T', () => overlayWindow?.webContents.send('rookie:request-transcript'))
  app.on('activate', () => { if (!controlWindow) createControlWindow(); else controlWindow.show() })
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
