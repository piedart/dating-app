const { app, BrowserWindow, ipcMain } = require('electron')
const crypto = require('crypto')
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

const localChatId = crypto.randomBytes(4).toString('hex')
const devChatTopic = crypto.createHash('sha256').update('hello-pear-electron-dev-chat').digest()
let chatSwarm = null
const chatSockets = new Set()

const appName = productName ?? name

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

function sendChatPeerCount() {
  sendToAll('p2p-chat:peers', { count: chatSockets.size, id: localChatId })
}

function broadcastChatLine(payload) {
  const line = JSON.stringify(payload) + '\n'
  for (const conn of chatSockets) {
    if (!conn.destroyed) conn.write(line)
  }
}

function startDevChat() {
  if (chatSwarm) return
  chatSwarm = new Hyperswarm()
  chatSwarm.on('connection', (conn) => {
    chatSockets.add(conn)
    sendChatPeerCount()
    let buf = ''
    conn.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let i
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line)
          if (typeof msg.text === 'string' && typeof msg.from === 'string') {
            sendToAll('p2p-chat:message', { text: msg.text, from: msg.from })
          }
        } catch {
          /* ignore malformed line */
        }
      }
    })
    conn.on('close', () => {
      chatSockets.delete(conn)
      sendChatPeerCount()
    })
  })
  chatSwarm.on('update', sendChatPeerCount)
  const discovery = chatSwarm.join(devChatTopic, { server: true, client: true })
  discovery.flushed().then(sendChatPeerCount).catch(sendChatPeerCount)
  sendChatPeerCount()
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

async function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 720,
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

ipcMain.handle('p2p-chat:send', (_, text) => {
  const t = String(text ?? '')
    .replace(/\r?\n/g, ' ')
    .trim()
    .slice(0, 2000)
  if (!t) return false
  broadcastChatLine({ from: localChatId, text: t })
  sendToAll('p2p-chat:message', { from: localChatId, text: t, self: true })
  return true
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
    startDevChat()
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
    if (chatSwarm) {
      chatSwarm.destroy()
      chatSwarm = null
      chatSockets.clear()
    }
  })
}
