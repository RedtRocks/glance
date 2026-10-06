#!/usr/bin/env node
/**
 * Builds glance-mcp (src-tauri/mcp-bridge), the program AI apps start to use Glance, for
 * the target Tauri is bundling and copies it to src-tauri/target/mcp-bridge/, where the
 * NSIS installer hooks and packaging/msix/pack.ps1 pick it up. Runs as part of Tauri's
 * beforeBundleCommand; does nothing off Windows.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const triple = process.env.TAURI_ENV_TARGET_TRIPLE

if (process.env.TAURI_ENV_PLATFORM !== 'windows' || !triple) {
  console.log('mcp-bridge: not bundling for Windows, skipped')
} else {
  const crate = join(ROOT, 'src-tauri', 'mcp-bridge')
  execFileSync('cargo', ['build', '--release', '--locked', '--target', triple], { cwd: crate, stdio: 'inherit' })
  const out = join(ROOT, 'src-tauri', 'target', 'mcp-bridge')
  mkdirSync(out, { recursive: true })
  copyFileSync(join(crate, 'target', triple, 'release', 'glance-mcp.exe'), join(out, 'glance-mcp.exe'))
  console.log(`mcp-bridge: built for ${triple}`)
}
