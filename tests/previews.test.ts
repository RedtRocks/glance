import { describe, expect, it } from 'vitest'
import { columnName, parseDelimited } from '../src/preview/render'
import { formatValue, parseRef } from '../src/preview/xlsx'
import { readFileSync } from 'node:fs'
import { PREVIEWS, previewExt, previewFlavor } from '../src/core/previews'
import { decodeText, tidyJson } from '../src/preview/text'
import { splitFrontMatter } from '../src/preview/markdown'
import { resolvePath } from '../src/preview/ebook'
import { fontNames } from '../src/preview/font'
import { readEml } from '../src/preview/email'
import { decode as iconvDecode } from '../src/preview/iconvShim'

describe('preview files', () => {
  it('sorts extensions into the right view', () => {
    expect(previewFlavor('DOCX')).toBe('word')
    expect(previewFlavor('ppsx')).toBe('slides')
    expect(previewFlavor('csv')).toBe('sheets')
    expect(previewFlavor('md')).toBe('markdown')
    expect(previewFlavor('py')).toBe('text')
    expect(previewFlavor('webm')).toBe('video')
    expect(previewFlavor('flac')).toBe('audio')
    expect(previewFlavor('epub')).toBe('ebook')
    expect(previewFlavor('woff2')).toBe('font')
    expect(previewFlavor('msg')).toBe('email')
    expect(previewFlavor('doc')).toBeNull()
  })

  it('reads extensions, and names like Dockerfile', () => {
    expect(previewExt('C:\\notes\\Plan.Final.MD')).toBe('md')
    expect(previewExt('/src/Dockerfile')).toBe('dockerfile')
  })

  it('matches the list the Windows app classifies', () => {
    const rs = readFileSync('src-tauri/src/decode/formats.rs', 'utf8')
    const list = /const PREVIEWS: &\[&str\] = &\[([\s\S]*?)\];/.exec(rs)?.[1] ?? ''
    expect([...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort()).toEqual([...PREVIEWS].sort())
  })
})

describe('text', () => {
  it('follows byte-order marks and falls back from bad UTF-8', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe('hi')
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0, 0x69, 0]))).toBe('hi')
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe('café')
    expect(decodeText(new TextEncoder().encode('café ☕'))).toBe('café ☕')
  })

  it('lays out one-line JSON and leaves the rest alone', () => {
    expect(tidyJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}')
    expect(tidyJson('{"a":')).toBe('{"a":')
    expect(tidyJson('{\n"a": 1,\n"b": 2\n}')).toBe('{\n"a": 1,\n"b": 2\n}')
  })

  it('separates Markdown front matter', () => {
    expect(splitFrontMatter('---\ntitle: x\n---\n# Hi')).toEqual({ front: 'title: x', body: '# Hi' })
    expect(splitFrontMatter('# Hi\n---\n')).toEqual({ front: null, body: '# Hi\n---\n' })
  })

  it('reads Outlook ANSI strings without Node', () => {
    expect(iconvDecode(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), 'cp1252')).toBe('café')
    expect(iconvDecode(new Uint8Array([0x68, 0, 0x69, 0]), 'utf16le')).toBe('hi')
  })
})

describe('books, fonts and email', () => {
  it('resolves paths inside an EPUB', () => {
    expect(resolvePath('OEBPS/text/ch1.xhtml', '../images/a%20b.png')).toBe('OEBPS/images/a b.png')
    expect(resolvePath('OEBPS/content.opf', 'text/ch2.xhtml#part')).toBe('OEBPS/text/ch2.xhtml')
    expect(resolvePath('ch1.xhtml', 'ch2.xhtml')).toBe('ch2.xhtml')
  })

  it('reads a font’s names', async () => {
    expect(await fontNames(sfntWithNames({ 1: 'Harbor Sans', 2: 'Bold', 5: 'Version 1.0' }))).toMatchObject({ family: 'Harbor Sans', style: 'Bold', version: 'Version 1.0' })
    expect(await fontNames(new Uint8Array(16))).toEqual({})
  })

  it('reads an email with its attachments', async () => {
    const eml = [
      'From: Maya <maya@example.com>',
      'To: Sam <sam@example.com>',
      'Subject: =?UTF-8?Q?Caf=C3=A9?=',
      'Date: Mon, 05 Oct 2026 08:14:00 +0000',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'See you Monday.',
      '--b',
      'Content-Type: text/csv; name="orders.csv"',
      'Content-Disposition: attachment; filename="orders.csv"',
      'Content-Transfer-Encoding: base64',
      '',
      btoa('a,b\n1,2\n'),
      '--b--',
      ''
    ].join('\r\n')
    const mail = await readEml(new TextEncoder().encode(eml))
    expect(mail).toMatchObject({ subject: 'Café', from: 'Maya <maya@example.com>', to: 'Sam <sam@example.com>', html: null })
    expect(mail.text?.trim()).toBe('See you Monday.')
    expect(mail.date?.toISOString()).toBe('2026-10-05T08:14:00.000Z')
    expect(mail.attachments.map((a) => [a.name, new TextDecoder().decode(a.data)])).toEqual([['orders.csv', 'a,b\n1,2\n']])
  })
})

/** A TrueType file with just a name table holding Windows English names. */
function sfntWithNames(names: Record<number, string>): Uint8Array {
  const entries = Object.entries(names).map(([id, text]) => {
    const s = new Uint8Array(text.length * 2)
    for (let i = 0; i < text.length; i++) s[i * 2 + 1] = text.charCodeAt(i)
    return { id: Number(id), s }
  })
  const header = 6 + entries.length * 12
  const tableLen = header + entries.reduce((n, e) => n + e.s.length, 0)
  const out = new Uint8Array(12 + 16 + tableLen)
  const v = new DataView(out.buffer)
  v.setUint32(0, 0x00010000)
  v.setUint16(4, 1)
  out.set([0x6e, 0x61, 0x6d, 0x65], 12) // "name"
  v.setUint32(12 + 8, 28)
  v.setUint32(12 + 12, tableLen)
  v.setUint16(28 + 2, entries.length)
  v.setUint16(28 + 4, header)
  let offset = 0
  entries.forEach((e, i) => {
    const at = 28 + 6 + i * 12
    v.setUint16(at, 3)
    v.setUint16(at + 2, 1)
    v.setUint16(at + 4, 0x409)
    v.setUint16(at + 6, e.id)
    v.setUint16(at + 8, e.s.length)
    v.setUint16(at + 10, offset)
    out.set(e.s, 28 + header + offset)
    offset += e.s.length
  })
  return out
}

describe('CSV', () => {
  it('handles quotes, doubled quotes and line endings', () => {
    expect(parseDelimited('a,b\r\n"x, y","say ""hi"""\n1,\n', ',')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['1', '']
    ])
  })
  it('keeps a last line without a newline', () => {
    expect(parseDelimited('a\tb\n1\t2', '\t')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })
})

describe('spreadsheet cells', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
    expect(parseRef('B12')).toEqual([11, 1])
    expect(parseRef('$AA$3')).toEqual([2, 26])
  })

  it('formats numbers the way their format says', () => {
    expect(formatValue(1234.5, undefined)).toBe('1234.5')
    expect(formatValue(12400, '"$"#,##0')).toBe('$12,400')
    expect(formatValue(12400, '$#,##0')).toBe('$12,400')
    expect(formatValue(0.256, '0.0%')).toBe('25.6%')
    expect(formatValue(-3.5, '0.00')).toBe('-3.50')
    expect(formatValue(-3.5, '#,##0.00;(#,##0.00)')).toBe('(3.50)')
    expect(formatValue(1500, '[$€-407]#,##0.00')).toBe('€1,500.00')
  })

  it('formats dates from Excel serial numbers', () => {
    // 45566 is 2024-10-01.
    expect(formatValue(45566, 'yyyy-mm-dd')).toBe('2024-10-01')
    expect(formatValue(45566, 'm/d/yyyy')).toBe('10/1/2024')
    expect(formatValue(45566, 'd-mmm-yy')).toBe('1-Oct-24')
    expect(formatValue(45566.75, 'h:mm AM/PM')).toBe('6:00 PM')
    expect(formatValue(45566.5, 'hh:mm:ss')).toBe('12:00:00')
  })
})
