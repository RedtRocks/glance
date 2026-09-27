#!/usr/bin/env node
/**
 * Builds the Explorer PDF thumbnail handler (src-tauri/thumbnailer) for the target Tauri
 * is bundling and copies it to src-tauri/target/thumbnailer/, where the NSIS installer
 * hooks pick it up. Runs as Tauri's beforeBundleCommand; does nothing off Windows.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const triple = process.env.TAURI_ENV_TARGET_TRIPLE

if (process.env.TAURI_ENV_PLATFORM !== 'windows' || !triple) {
  console.log('thumbnailer: not bundling for Windows, skipped')
} else {
  const crate = join(ROOT, 'src-tauri', 'thumbnailer')
  execFileSync('cargo', ['build', '--release', '--locked', '--target', triple], { cwd: crate, stdio: 'inherit' })
  const out = join(ROOT, 'src-tauri', 'target', 'thumbnailer')
  mkdirSync(out, { recursive: true })
  copyFileSync(join(crate, 'target', triple, 'release', 'glance_thumbnailer.dll'), join(out, 'glance_thumbnailer.dll'))
  console.log(`thumbnailer: built for ${triple}`)
}
