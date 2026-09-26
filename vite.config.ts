import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import { cpSync, existsSync } from 'node:fs'

/**
 * PDF.js needs its CMaps (CJK text), standard fonts, ICC profiles and WASM decoders
 * (JPEG 2000 / JBIG2 images inside PDFs) as static files. Copy them into public/.
 */
function pdfjsAssets(): Plugin {
  return {
    name: 'glance-pdfjs-assets',
    buildStart() {
      for (const dir of ['cmaps', 'standard_fonts', 'iccs', 'wasm']) {
        const dest = `public/pdfjs/${dir}`
        if (!existsSync(dest)) {
          cpSync(`node_modules/pdfjs-dist/${dir}`, dest, {
            recursive: true,
            // The QuickJS sandbox runs embedded PDF JavaScript; Glance never executes it.
            filter: (src: string) => !/quickjs/.test(src)
          })
        }
      }
    }
  }
}

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [preact(), pdfjsAssets()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] }
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    // WebView2 is evergreen Chromium; no need to down-level.
    target: 'chrome120',
    minify: 'esbuild',
    sourcemap: false,
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      output: {
        manualChunks: {
          pdfjs: ['pdfjs-dist/legacy/build/pdf.mjs'],
          pdflib: ['@cantoo/pdf-lib']
        }
      }
    }
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
} as never)
