/**
 * Lazily loaded PDF.js (ADR 0002: engines load only when a PDF is opened).
 *
 * We use the "legacy" build: the modern one relies on JavaScript features newer than
 * the WebView2 runtimes found on managed or older Windows 10 machines, where pages
 * would silently fail to render.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { t } from '../i18n'

type PdfJs = typeof import('pdfjs-dist')
let loading: Promise<PdfJs> | null = null

export function pdfjs(): Promise<PdfJs> {
  if (!loading) {
    loading = (import('pdfjs-dist/legacy/build/pdf.mjs') as Promise<PdfJs>).then((m) => {
      m.GlobalWorkerOptions.workerSrc = workerUrl
      return m
    })
  }
  return loading
}

const assetBase = new URL('pdfjs/', document.baseURI).href

export class PasswordRequired extends Error {
  constructor(readonly incorrect: boolean) {
    super(incorrect ? t('Incorrect password') : t('Password required'))
  }
}

/** Opens PDF bytes. The bytes are copied because PDF.js transfers them to its worker. */
export async function openPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const lib = await pdfjs()
  const task = lib.getDocument({
    data: bytes.slice(),
    password,
    cMapUrl: `${assetBase}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    iccUrl: `${assetBase}iccs/`,
    wasmUrl: `${assetBase}wasm/`
  })
  try {
    return await task.promise
  } catch (e) {
    const err = e as { name?: string; code?: number }
    if (err?.name === 'PasswordException') throw new PasswordRequired(err.code === 2)
    throw e
  }
}

export interface OutlineNode {
  title: string
  pageIndex: number | null
  children: OutlineNode[]
}

export async function readOutline(doc: PDFDocumentProxy): Promise<OutlineNode[]> {
  const raw = await doc.getOutline()
  if (!raw) return []
  const resolve = async (dest: unknown): Promise<number | null> => {
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : (dest as unknown[] | null)
      if (!explicit || !explicit[0]) return null
      const ref = explicit[0]
      return typeof ref === 'number' ? ref : await doc.getPageIndex(ref as never)
    } catch {
      return null
    }
  }
  const walk = async (items: typeof raw): Promise<OutlineNode[]> =>
    Promise.all(
      items.map(async (it) => ({
        title: it.title,
        pageIndex: await resolve(it.dest),
        children: await walk(it.items ?? [])
      }))
    )
  return walk(raw)
}
