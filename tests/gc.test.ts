import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName } from '@cantoo/pdf-lib'
import { collectGarbage } from '../src/core/gc'
import { reveals } from './fixtures'

async function replacedContent(gc: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([100, 100])
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream('BT (OLD-SECRET) Tj ET')))
  const loaded = await PDFDocument.load(await doc.save())
  loaded.getPage(0).node.set(PDFName.of('Contents'), loaded.context.register(loaded.context.stream('BT (NEW) Tj ET')))
  if (gc) collectGarbage(loaded)
  return loaded.save({ useObjectStreams: false })
}

describe('collectGarbage', () => {
  it('control: without it, replaced page content survives in the saved file', async () => {
    expect(await reveals(await replacedContent(false), 'OLD-SECRET')).toBe(true)
  })
  it('drops unreachable objects so replaced content is really gone', async () => {
    const bytes = await replacedContent(true)
    expect(await reveals(bytes, 'OLD-SECRET')).toBe(false)
    expect(await reveals(bytes, 'NEW')).toBe(true)
  })
})
