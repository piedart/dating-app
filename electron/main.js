const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  systemPreferences,
  shell,
  dialog,
  Notification
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

function blocklistPath() {
  return path.join(app.getPath('userData'), 'blocked-peers.json')
}

let blocklistReady = false
/** @type {Set<string>} */
let blockedPublicIds = new Set()
/** @type {string | null} */
let rendererDmUiOpenPublicId = null
/** @type {string | null} */
let dmActiveRemotePublicId = null

async function ensureBlocklistLoaded() {
  if (blocklistReady) return
  blocklistReady = true
  try {
    const raw = await fs.readFile(blocklistPath(), 'utf8')
    const data = JSON.parse(raw)
    const ids = Array.isArray(data.publicIds) ? data.publicIds : []
    blockedPublicIds = new Set(ids.map(String))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    blockedPublicIds = new Set()
  }
}

function isBlocked(publicId) {
  return blockedPublicIds.has(String(publicId))
}

async function saveBlocklistToDisk() {
  await fs.mkdir(path.dirname(blocklistPath()), { recursive: true })
  await fs.writeFile(
    blocklistPath(),
    JSON.stringify({ publicIds: [...blockedPublicIds].sort() }, null, 2),
    'utf8'
  )
}

async function clearBlocklist() {
  blockedPublicIds = new Set()
  blocklistReady = false
  try {
    await fs.unlink(blocklistPath())
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

function notifyIncomingDm(fromName, text) {
  try {
    if (!Notification.isSupported()) return
    const title = fromName ? `Message from ${fromName}` : 'New message'
    const n = new Notification({
      title,
      body: String(text).slice(0, 256)
    })
    n.show()
  } catch {
    /* ignore */
  }
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

const matchTopic = crypto.createHash('sha256').update('hello-pear-electron-matchmaking-v1').digest()
let matchSwarm = null
/** @type {Map<string, { publicId: string, displayName: string, username: string }>} */
const matchPeersByPublicId = new Map()
/** @type {Map<object, string>} */
const matchConnToPublicId = new Map()

function matchPeerListForRenderer() {
  const self = cachedProfile?.publicId
  const list = []
  for (const [, p] of matchPeersByPublicId) {
    if (p.publicId === self) continue
    if (isBlocked(p.publicId)) continue
    list.push({
      publicId: p.publicId,
      displayName: p.displayName,
      username: p.username
    })
  }
  return list
}

function broadcastMatchPeers() {
  sendToAll('matchmaking:peers', { peers: matchPeerListForRenderer() })
}

function closeMatchmakingConnectionsTo(publicId) {
  const pid = String(publicId)
  for (const [conn, id] of matchConnToPublicId) {
    if (id === pid) {
      try {
        conn.destroy()
      } catch {
        /* ignore */
      }
    }
  }
}

async function addBlockedPeer(publicId) {
  await ensureBlocklistLoaded()
  const pid = String(publicId)
  if (!/^[a-f0-9]{16}$/i.test(pid)) {
    throw new Error('Invalid peer id')
  }
  blockedPublicIds.add(pid)
  matchPeersByPublicId.delete(pid)
  closeMatchmakingConnectionsTo(pid)
  await saveBlocklistToDisk()
  broadcastMatchPeers()
}

async function removeBlockedPeer(publicId) {
  await ensureBlocklistLoaded()
  blockedPublicIds.delete(String(publicId))
  await saveBlocklistToDisk()
  broadcastMatchPeers()
}

function stopMatchmaking() {
  if (!matchSwarm) return
  matchSwarm.destroy()
  matchSwarm = null
  matchPeersByPublicId.clear()
  matchConnToPublicId.clear()
  broadcastMatchPeers()
}

function startMatchmaking() {
  if (!cachedProfile || matchSwarm) return
  matchSwarm = new Hyperswarm()
  matchSwarm.on('connection', (conn) => {
    const line =
      JSON.stringify({
        type: 'hello',
        publicId: cachedProfile.publicId,
        displayName: cachedProfile.displayName,
        username: cachedProfile.username
      }) + '\n'
    conn.write(line)

    let buf = ''
    conn.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let i
      while ((i = buf.indexOf('\n')) !== -1) {
        const raw = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!raw) continue
        try {
          const msg = JSON.parse(raw)
          if (msg.type === 'hello' && typeof msg.publicId === 'string') {
            if (isBlocked(msg.publicId)) {
              try {
                conn.destroy()
              } catch {
                /* ignore */
              }
              return
            }
            const prev = matchConnToPublicId.get(conn)
            if (prev && prev !== msg.publicId) {
              matchPeersByPublicId.delete(prev)
            }
            matchConnToPublicId.set(conn, msg.publicId)
            matchPeersByPublicId.set(msg.publicId, {
              publicId: msg.publicId,
              displayName: String(msg.displayName ?? '').slice(0, 80),
              username: String(msg.username ?? '').slice(0, 32)
            })
            broadcastMatchPeers()
          }
        } catch {
          /* ignore */
        }
      }
    })
    conn.on('close', () => {
      const pid = matchConnToPublicId.get(conn)
      matchConnToPublicId.delete(conn)
      if (pid) {
        matchPeersByPublicId.delete(pid)
        broadcastMatchPeers()
      }
    })
  })
  matchSwarm.on('update', broadcastMatchPeers)
  matchSwarm.join(matchTopic, { client: true, server: true })
  broadcastMatchPeers()
}

let dmSwarm = null
const dmSockets = new Set()
const localDmWireId = crypto.randomBytes(4).toString('hex')

function stopDmChat() {
  if (!dmSwarm) return
  dmSwarm.destroy()
  dmSwarm = null
  dmSockets.clear()
  dmActiveRemotePublicId = null
  rendererDmUiOpenPublicId = null
  sendToAll('dm:closed', {})
}

function dmBroadcastLine(payload) {
  const line = JSON.stringify(payload) + '\n'
  for (const c of dmSockets) {
    if (!c.destroyed) c.write(line)
  }
}

function startDmChat(remotePublicId) {
  if (!cachedProfile || !remotePublicId) return false
  const b = String(remotePublicId)
  if (isBlocked(b)) return false
  if (dmSwarm && dmActiveRemotePublicId === b) {
    return true
  }
  stopDmChat()
  dmActiveRemotePublicId = b
  const a = String(cachedProfile.publicId)
  const topicKey = [a, b].sort().join(':')
  const topic = crypto
    .createHash('sha256')
    .update('hello-pear-electron-dm:' + topicKey)
    .digest()
  dmSwarm = new Hyperswarm()
  dmSwarm.on('connection', (conn) => {
    dmSockets.add(conn)
    let buf = ''
    conn.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let i
      while ((i = buf.indexOf('\n')) !== -1) {
        const raw = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!raw) continue
        try {
          const msg = JSON.parse(raw)
          if (typeof msg.text === 'string' && typeof msg.from === 'string') {
            const peerPublicId = typeof msg.publicId === 'string' ? msg.publicId : undefined
            if (peerPublicId && isBlocked(peerPublicId)) {
              continue
            }
            const name = typeof msg.name === 'string' ? msg.name.slice(0, 80) : undefined
            const out = {
              text: msg.text,
              from: msg.from,
              name,
              publicId: peerPublicId
            }
            sendToAll('dm:message', out)
            if (peerPublicId && peerPublicId !== rendererDmUiOpenPublicId) {
              notifyIncomingDm(name, msg.text)
            }
          }
        } catch {
          /* ignore */
        }
      }
    })
    conn.on('close', () => {
      dmSockets.delete(conn)
    })
  })
  dmSwarm.join(topic, { client: true, server: true })
  return true
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

function microphoneSettingsAppName() {
  return app.isPackaged ? appName : 'Electron'
}

async function promptMicrophonePrivacy(evt) {
  const win = BrowserWindow.fromWebContents(evt.sender)
  const parent = win && !win.isDestroyed() ? win : undefined
  const listName = microphoneSettingsAppName()
  if (process.platform === 'darwin') {
    const { response } = await dialog.showMessageBox(parent, {
      type: 'info',
      buttons: ['Open System Settings', 'Not now'],
      defaultId: 0,
      cancelId: 1,
      title: 'Microphone access',
      message: 'Microphone is turned off for this app.',
      detail: app.isPackaged
        ? `In Privacy & Security → Microphone, turn on the switch for ${listName}. Then fully quit and reopen the app before recording again.`
        : `While developing, macOS lists this app as Electron (not "${appName}"). Turn on its microphone switch, then fully quit and reopen this window before recording again.`
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
  let status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') {
    return { ok: true }
  }
  if (status === 'restricted') {
    return {
      ok: false,
      message:
        'Microphone is restricted on this Mac (for example by a management profile). You may need an administrator to allow access.'
    }
  }

  // Must call this for macOS to add the app to Privacy → Microphone. Do not bail early on
  // "denied" — status can be wrong before the first real prompt, and skipping askForMediaAccess
  // leaves the app missing from the list entirely.
  const granted = await systemPreferences.askForMediaAccess('microphone')
  if (granted) {
    return { ok: true }
  }

  status = systemPreferences.getMediaAccessStatus('microphone')
  const listName = microphoneSettingsAppName()
  if (status === 'denied') {
    return {
      ok: false,
      message: app.isPackaged
        ? `Microphone is off for ${listName}. Open System Settings → Privacy & Security → Microphone, turn on ${listName}, then quit and reopen the app.`
        : `Microphone is off for ${listName}. In System Settings → Privacy & Security → Microphone, find Electron (the dev runtime, not "${appName}"), turn it on, then quit and reopen this app.`
    }
  }
  return {
    ok: false,
    message: `Microphone access was not granted. Check Privacy & Security → Microphone for ${listName}, or use the button below to open settings.`
  }
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 880,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.js'),
      // Sandboxed renderers often fail to register with macOS microphone privacy; the app never
      // appears under Privacy → Microphone until this matches how most Electron media apps run.
      sandbox: false,
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

ipcMain.handle('matchmaking:start', async () => {
  await ensureBlocklistLoaded()
  startMatchmaking()
  return true
})
ipcMain.handle('matchmaking:stop', () => {
  stopMatchmaking()
  return true
})
ipcMain.handle('dm:open', (_, remotePublicId) => startDmChat(remotePublicId))
ipcMain.handle('dm:send', (_, text) => {
  const t = String(text ?? '')
    .replace(/\r?\n/g, ' ')
    .trim()
    .slice(0, 2000)
  if (!t || !dmSwarm) return false
  const name =
    typeof cachedProfile?.displayName === 'string'
      ? String(cachedProfile.displayName).slice(0, 80)
      : typeof cachedProfile?.username === 'string'
        ? String(cachedProfile.username).slice(0, 80)
        : undefined
  const payload = {
    from: localDmWireId,
    publicId: String(cachedProfile.publicId),
    text: t,
    name
  }
  dmBroadcastLine(payload)
  sendToAll('dm:message', { ...payload, self: true })
  return true
})
ipcMain.handle('dm:close', () => {
  stopDmChat()
  return true
})
ipcMain.handle('dm:uiState', (_, openWithPublicId) => {
  rendererDmUiOpenPublicId =
    typeof openWithPublicId === 'string' && openWithPublicId ? openWithPublicId : null
  return true
})
ipcMain.handle('blocklist:get', async () => {
  await ensureBlocklistLoaded()
  return { publicIds: [...blockedPublicIds].sort() }
})
ipcMain.handle('blocklist:add', async (_, publicId) => {
  await addBlockedPeer(publicId)
  if (dmActiveRemotePublicId === String(publicId)) {
    stopDmChat()
  }
  return true
})
ipcMain.handle('blocklist:remove', async (_, publicId) => {
  await removeBlockedPeer(publicId)
  return true
})

ipcMain.handle('account:get', async () => {
  try {
    const raw = await fs.readFile(profilePath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (!isStoredProfileComplete(parsed)) {
      cachedProfile = null
      return null
    }
    cachedProfile = parsed
    await ensureBlocklistLoaded()
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
  stopMatchmaking()
  stopDmChat()
  await clearBlocklist()
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
    ensureBlocklistLoaded().catch((err) => console.error('blocklist load:', err))
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

  app.on('before-quit', () => {
    stopMatchmaking()
    stopDmChat()
  })
}
