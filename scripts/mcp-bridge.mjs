#!/usr/bin/env node
/**
 * Builds glance-mcp (src-tauri/mcp-bridge), the program AI apps start to use Glance, for
 * the target Tauri is bundling and copies it to src-tauri/target/mcp-bridge/, where the
 * NSIS installer hooks, RPM config and packaging/msix/pack.ps1 pick it up. Runs as part
 * of Tauri's beforeBundleCommand; does nothing off Windows and Linux.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const triple = process.env.TAURI_ENV_TARGET_TRIPLE

const platform = process.env.TAURI_ENV_PLATFORM
if ((platform !== 'windows' && platform !== 'linux') || (platform === 'windows' && !triple)) {
  console.log('mcp-bridge: not bundling for Windows or Linux, skipped')
} else {
  const crate = join(ROOT, 'src-tauri', 'mcp-bridge')
  execFileSync('cargo', ['build', '--release', '--locked', ...(triple ? ['--target', triple] : [])], { cwd: crate, stdio: 'inherit' })
  const out = join(ROOT, 'src-tauri', 'target', 'mcp-bridge')
  mkdirSync(out, { recursive: true })
  const binary = platform === 'windows' ? 'glance-mcp.exe' : 'glance-mcp'
  copyFileSync(join(crate, 'target', ...(triple ? [triple] : []), 'release', binary), join(out, binary))
  if (platform === 'linux') chmodSync(join(out, binary), 0o755)
  console.log(`mcp-bridge: built for ${triple || platform}`)
}
