'use strict'

const { spawn } = require('node:child_process')
const net = require('node:net')
const path = require('node:path')

const root = path.join(__dirname, '..')

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      const port = typeof addr === 'object' && addr ? addr.port : addr
      s.close(() => resolve(port))
    })
  })
}

function waitForUrl(url) {
  return new Promise((resolve, reject) => {
    const cli = path.join(root, 'node_modules', 'wait-on', 'bin', 'wait-on')
    const p = spawn(process.execPath, [cli, url, '--timeout', '60000'], {
      stdio: 'inherit',
      cwd: root
    })
    p.on('error', reject)
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`wait-on exited with code ${code}`))
    )
  })
}

async function main() {
  const port =
    process.env.VITE_DEV_PORT && /^\d+$/.test(process.env.VITE_DEV_PORT)
      ? Number(process.env.VITE_DEV_PORT)
      : await getFreePort()

  const url = `http://127.0.0.1:${port}`
  const extra = process.argv.slice(2)

  const viteJs = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  const vite = spawn(process.execPath, [viteJs, '--port', String(port)], {
    stdio: 'inherit',
    cwd: root
  })

  let shuttingDown = false

  const viteFailed = new Promise((_, reject) => {
    vite.once('exit', (code, signal) => {
      if (shuttingDown) return
      if (signal && signal !== 'SIGTERM') {
        reject(new Error(`vite stopped (${signal})`))
      } else if (!signal && code !== 0 && code !== null) {
        reject(new Error(`vite exited with code ${code}`))
      }
    })
  })

  try {
    await Promise.race([waitForUrl(url), viteFailed])
  } catch (err) {
    shuttingDown = true
    vite.kill('SIGTERM')
    throw err
  }

  const forgeCli = path.join(
    root,
    'node_modules',
    '@electron-forge',
    'cli',
    'dist',
    'electron-forge.js'
  )
  const electron = spawn(process.execPath, [forgeCli, 'start', '--', '--no-updates', ...extra], {
    stdio: 'inherit',
    cwd: root,
    env: { ...process.env, PEAR_DEV_SERVER_URL: url }
  })

  electron.on('exit', (code) => {
    shuttingDown = true
    vite.kill('SIGTERM')
    process.exit(code ?? 0)
  })

  function forwardSignal(sig) {
    shuttingDown = true
    if (electron.pid) electron.kill(sig)
    vite.kill('SIGTERM')
  }
  process.on('SIGINT', () => forwardSignal('SIGINT'))
  process.on('SIGTERM', () => forwardSignal('SIGTERM'))
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
