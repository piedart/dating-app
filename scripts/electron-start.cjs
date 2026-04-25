'use strict'

const { spawn, spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.join(__dirname, '..')
const extra = process.argv.slice(2)

const viteJs = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const build = spawnSync(process.execPath, [viteJs, 'build'], {
  stdio: 'inherit',
  cwd: root
})
if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

const env = { ...process.env }
delete env.PEAR_DEV_SERVER_URL

// Windows has no extensionless shim in .bin; run the CLI entry with node (same idea as vite above).
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
  env
})

electron.on('exit', (code) => process.exit(code ?? 0))
