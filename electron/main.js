const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  systemPreferences,
  shell,
  dialog
} = require('electron')
const crypto = require('crypto')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const PearRuntime = require('pear-runtime')

const { isMac, isLinux, isWindows } = require('which-runtime')
const { command, flag } = require('paparam')
const pkg = require('../package.json')
const { name, productName, version, upgrade } = pkg

const protocol = name

const workers = new Map()
let pear = null

/** @type {Record<string, unknown> | null} */
let cachedProfile = null

const appName = productName ?? name

function profilePath() {
  return path.join(app.getPath('userData'), 'dating-profile.json')
}

function requireAnswer(value, label) {
  const s = String(value ?? '')
    .trim()
    .slice(0, 120)
  if (!s) {
    throw new Error(`${label} is required`)
  }
  return s
}

const MAX_DOODLE_DATA_URL = 520_000
const MAX_BIRD_DATA_URL = 1_200_000

function validateDataUrl(value, label, prefix, maxLen) {
  const s = String(value ?? '').trim()
  if (!s.startsWith(prefix)) {
    throw new Error(`${label} is required`)
  }
  if (s.length > maxLen) {
    throw new Error(`${label} is too large — try a simpler drawing or shorter clip`)
  }
  return s
}

function isStoredProfileComplete(p) {
  if (!p || typeof p !== 'object') return false
  const u = String(p.username ?? '')
    .trim()
    .toLowerCase()
  if (!/^[a-z0-9_]{3,32}$/.test(u)) return false
  if (!String(p.displayName ?? '').trim()) return false
  const age = Number(p.age)
  if (!Number.isFinite(age) || age < 18 || age > 120) return false
  if (!String(p.gender ?? '').trim()) return false
  const doodle = String(p.doodlePng ?? '').trim()
  if (!doodle.startsWith('data:image/png') || doodle.length < 200) return false
  const bird = String(p.birdSound ?? '').trim()
  if (!bird.startsWith('data:audio') || bird.length < 80) return false
  if (!String(p.favouriteCar ?? '').trim()) return false
  return true
}

function validateProfile(input) {
  const usernameRaw = String(input?.username ?? '')
    .trim()
    .toLowerCase()
  if (!/^[a-z0-9_]{3,32}$/.test(usernameRaw)) {
    throw new Error('Username must be 3–32 characters (letters, numbers, underscores)')
  }

  const displayName = String(input?.displayName ?? '')
    .trim()
    .slice(0, 80)
  if (!displayName) {
    throw new Error('Display name is required')
  }

  const age = Number(input?.age)
  const ageNum = Number.isFinite(age) && age >= 18 && age <= 120 ? Math.floor(age) : null
  if (ageNum === null) {
    throw new Error('Enter a valid age between 18 and 120')
  }

  const gender = requireAnswer(input?.gender, 'Gender').slice(0, 40)

  const city = String(input?.city ?? '')
    .trim()
    .slice(0, 80)
  const pronouns = String(input?.pronouns ?? '')
    .trim()
    .slice(0, 40)
  const bio = String(input?.bio ?? '')
    .trim()
    .slice(0, 500)

  const doodlePng = validateDataUrl(
    input?.doodlePng,
    'Drawing',
    'data:image/png',
    MAX_DOODLE_DATA_URL
  )
  const birdSound = validateDataUrl(input?.birdSound, 'Bird sound', 'data:audio', MAX_BIRD_DATA_URL)
  const favouriteCar = requireAnswer(input?.favouriteCar, 'Favourite car')

  const existingPid = input?.publicId
  const publicId =
    typeof existingPid === 'string' && /^[a-f0-9]{16}$/i.test(existingPid)
      ? existingPid
      : crypto.randomBytes(8).toString('hex')

  const createdAt =
    typeof input?.createdAt === 'string' && input.createdAt
      ? input.createdAt
      : new Date().toISOString()

  return {
    publicId,
    username: usernameRaw,
    displayName,
    age: ageNum,
    gender,
    city: city || undefined,
    pronouns: pronouns || undefined,
    bio: bio || undefined,
    doodlePng,
    birdSound,
    favouriteCar,
    createdAt
  }
}

const cmd = command(
  appName,
  flag('--storage <dir>', 'pass custom storage to pear-runtime'),
  flag('--no-updates', 'start without OTA updates')
)

cmd.parse(app.isPackaged ? process.argv.slice(1) : process.argv.slice(2))

const pearStore = cmd.flags.storage
const updates = cmd.flags.updates

if (pearStore) app.setPath('userData', pearStore)

ipcMain.on('pkg', (evt) => {
  evt.returnValue = pkg
})

function getPear() {
  if (pear) return pear
  const appPath = getAppPath()
  let dir = null
  if (pearStore) {
    console.log('pear store: ' + pearStore)
    dir = pearStore
  } else if (appPath === null) {
    dir = path.join(os.tmpdir(), 'pear', appName)
  } else {
    dir = isMac
      ? path.join(os.homedir(), 'Library', 'Application Support', appName)
      : isLinux
        ? path.join(os.homedir(), '.config', appName)
        : path.join(os.homedir(), 'AppData', 'Local', appName)
  }

  const extension = isLinux ? '.AppImage' : isMac ? '.app' : '.msix'
  const store = new Corestore(path.join(dir, 'pear-runtime/corestore'))
  const swarm = new Hyperswarm()
  pear = new PearRuntime({
    dir,
    app: appPath,
    updates,
    version,
    upgrade,
    name: productName + extension,
    store,
    swarm
  })
  if (updates !== false) {
    swarm.on('connection', (connection) => store.replicate(connection))
    swarm.join(pear.updater.drive.core.discoveryKey, {
      client: true,
      server: false
    })
  }
  pear.on('error', console.error) // print network errors, etc.
  return pear
}

function getAppPath() {
  if (!app.isPackaged) return null
  if (isLinux && process.env.APPIMAGE) return process.env.APPIMAGE
  if (isWindows) return process.execPath
  return path.join(process.resourcesPath, '..', '..')
}

function sendToAll(name, data) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(name, data)
  }
}

function getWorker(specifier) {
  if (workers.has(specifier)) return workers.get(specifier)
  const pear = getPear()
  const worker = pear.run(require.resolve('..' + specifier), [pear.storage])
  function sendWorkerStdout(data) {
    sendToAll('pear:worker:stdout:' + specifier, data)
  }
  function sendWorkerStderr(data) {
    sendToAll('pear:worker:stderr:' + specifier, data)
  }
  function sendWorkerIPC(data) {
    sendToAll('pear:worker:ipc:' + specifier, data)
  }
  function onBeforeQuit() {
    worker.destroy()
  }
  ipcMain.handle('pear:worker:writeIPC:' + specifier, (evt, data) => {
    return worker.write(Buffer.from(data))
  })
  workers.set(specifier, worker)
  worker.on('data', sendWorkerIPC)
  worker.stdout.on('data', sendWorkerStdout)
  worker.stderr.on('data', sendWorkerStderr)
  worker.once('exit', (code) => {
    app.removeListener('before-quit', onBeforeQuit)
    ipcMain.removeHandler('pear:worker:writeIPC:' + specifier)
    worker.removeListener('data', sendWorkerIPC)
    worker.stdout.removeListener('data', sendWorkerStdout)
    worker.stderr.removeListener('data', sendWorkerStderr)
    sendToAll('pear:worker:exit:' + specifier, code)
    workers.delete(specifier)
  })
  app.on('before-quit', onBeforeQuit)
  return worker
}

const MACOS_MIC_PREFS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'

async function openMicrophonePrivacyPane() {
  if (process.platform === 'darwin') {
    await shell.openExternal(MACOS_MIC_PREFS)
    return { ok: true }
  }
  if (process.platform === 'win32') {
    await shell.openExternal('ms-settings:privacy-microphone')
    return { ok: true }
  }
  return { ok: false }
}

async function promptMicrophonePrivacy(evt) {
  const win = BrowserWindow.fromWebContents(evt.sender)
  const parent = win && !win.isDestroyed() ? win : undefined
  if (process.platform === 'darwin') {
    const { response } = await dialog.showMessageBox(parent, {
      type: 'info',
      buttons: ['Open System Settings', 'Not now'],
      defaultId: 0,
      cancelId: 1,
      title: 'Microphone access',
      message: 'Microphone is turned off for this app.',
      detail: `In the list, turn on the switch for ${appName} or for Electron while developing. Then fully quit and reopen the app before recording again.`
    })
    if (response === 0) {
      await openMicrophonePrivacyPane()
      return { opened: true }
    }
    return { opened: false }
  }
  if (process.platform === 'win32') {
    const { response } = await dialog.showMessageBox(parent, {
      type: 'info',
      buttons: ['Open microphone privacy', 'Not now'],
      defaultId: 0,
      cancelId: 1,
      title: 'Microphone access',
      message: 'Windows may be blocking the microphone for this app.',
      detail: 'Allow microphone access for this app, then try recording again.'
    })
    if (response === 0) {
      await openMicrophonePrivacyPane()
      return { opened: true }
    }
    return { opened: false }
  }
  return { opened: false }
}

async function ensureMicrophoneForCapture() {
  if (process.platform !== 'darwin') {
    return { ok: true }
  }
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') {
    return { ok: true }
  }
  if (status === 'denied' || status === 'restricted') {
    return {
      ok: false,
      message:
        'Microphone is off for this app. Use “Open System Settings” below (or the button in the dialog) to enable Hello Pear or Electron, then quit and reopen the app.'
    }
  }
  const granted = await systemPreferences.askForMediaAccess('microphone')
  if (granted) {
    return { ok: true }
  }
  return {
    ok: false,
    message:
      'Microphone access was not granted. You can open System Settings from the dialog or the button below.'
  }
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 880,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  const pear = getPear()

  const onUpdating = () => {
    if (!win.isDestroyed()) win.webContents.send('pear:event:updating')
  }

  const onUpdated = () => {
    if (!win.isDestroyed()) win.webContents.send('pear:event:updated')
  }

  pear.updater.on('updating', onUpdating)
  pear.updater.on('updated', onUpdated)

  win.on('closed', () => {
    pear.updater.removeListener('updating', onUpdating)
    pear.updater.removeListener('updated', onUpdated)
  })

  const devServerUrl = process.env.PEAR_DEV_SERVER_URL

  if (devServerUrl) {
    await win.loadURL(devServerUrl)
    if (process.env.ELECTRON_OPEN_DEVTOOLS === '1') {
      win.webContents.openDevTools()
    }
    return
  }

  await win.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'))
}

ipcMain.handle('media:requestMicrophone', () => ensureMicrophoneForCapture())
ipcMain.handle('media:openMicrophonePrivacy', openMicrophonePrivacyPane)
ipcMain.handle('media:promptMicrophonePrivacy', (evt) => promptMicrophonePrivacy(evt))

ipcMain.handle('account:get', async () => {
  try {
    const raw = await fs.readFile(profilePath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (!isStoredProfileComplete(parsed)) {
      cachedProfile = null
      return null
    }
    cachedProfile = parsed
    return cachedProfile
  } catch (err) {
    if (err.code === 'ENOENT') {
      cachedProfile = null
      return null
    }
    throw err
  }
})

ipcMain.handle('account:save', async (_evt, profile) => {
  const sanitized = validateProfile(profile)
  await fs.mkdir(path.dirname(profilePath()), { recursive: true })
  await fs.writeFile(profilePath(), JSON.stringify(sanitized, null, 2), 'utf8')
  cachedProfile = sanitized
  return sanitized
})

ipcMain.handle('account:clear', async () => {
  cachedProfile = null
  try {
    await fs.unlink(profilePath())
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
})

ipcMain.handle('pear:applyUpdate', () => {
  const pear = getPear()
  pear.updater.applyUpdate()
})
ipcMain.handle('pear:startWorker', (evt, filename) => {
  getWorker(filename)
  return true
})
ipcMain.handle('app:afterUpdate', () => {
  if (isLinux && process.env.APPIMAGE) {
    app.relaunch({
      execPath: process.env.APPIMAGE,
      args: [
        '--appimage-extract-and-run',
        ...process.argv.slice(1).filter((arg) => arg !== '--appimage-extract-and-run')
      ]
    })
  } else if (!isWindows) {
    app.relaunch()
  }
  app.exit(0)
})

function handleDeepLink(url) {
  console.log('deep link:', url)
}

app.setAsDefaultProtocolClient(protocol)

app.on('open-url', (evt, url) => {
  evt.preventDefault()
  handleDeepLink(url)
})

const lock = app.requestSingleInstanceLock()

if (!lock) {
  app.quit()
} else {
  app.on('second-instance', (evt, args) => {
    const url = args.find((arg) => arg.startsWith(protocol + '://'))
    if (url) handleDeepLink(url)
  })

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      if (permission === 'microphone' || permission === 'media') {
        callback(true)
      } else {
        callback(false)
      }
    })
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      if (permission === 'microphone' || permission === 'media') {
        return true
      }
    })
    createWindow().catch((err) => {
      console.error('Failed to create window:', err)
      app.quit()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow().catch((err) => {
          console.error('Failed to create window:', err)
        })
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
