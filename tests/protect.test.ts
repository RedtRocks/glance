import { describe, expect, it } from 'vitest'
import { protectPdf } from '../src/core/protect'
import { labeledPdf } from './fixtures'

async function open(bytes: Uint8Array, password?: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: bytes.slice(), password, isEvalSupported: false } as never)
  try {
    const doc = await task.promise
    const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
    return { pages: doc.numPages, text }
  } finally {
    await task.destroy()
  }
}

describe('password protection', () => {
  it('encrypts so the file only opens with the password', async () => {
    const plain = await labeledPdf(2)
    const locked = await protectPdf(plain, { password: 'hunter2', allowPrinting: true, allowCopying: false, allowEditing: false })
    await expect(open(locked)).rejects.toThrow(/password/i)
    await expect(open(locked, 'wrong')).rejects.toThrow(/password/i)
    const opened = await open(locked, 'hunter2')
    expect(opened.pages).toBe(2)
    expect(opened.text).toContain('Page 1')
  })

  it('refuses an empty password', async () => {
    await expect(protectPdf(await labeledPdf(1), { password: '', allowPrinting: true, allowCopying: true, allowEditing: true })).rejects.toThrow()
  })
})
