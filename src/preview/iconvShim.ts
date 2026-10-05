/**
 * The part of iconv-lite that @kenjiuno/msgreader uses (reading Outlook's older
 * "ANSI" strings), on the browser's TextDecoder instead of Node's Buffer.
 * Aliased in vite.config.ts.
 */
const NAMES: Record<string, string> = { cp932: 'shift_jis', cp936: 'gbk', cp949: 'euc-kr', cp950: 'big5', utf16le: 'utf-16le', ucs2: 'utf-16le', binary: 'latin1' }

export function decode(bytes: Uint8Array, encoding: string): string {
  const e = encoding.toLowerCase().replace(/[^a-z0-9]/g, '')
  const label = NAMES[e] ?? (/^cp(\d+)$/.test(e) ? `windows-${e.slice(2)}` : encoding)
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes)
  }
}

export function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function encodingExists(encoding: string): boolean {
  try {
    decode(new Uint8Array(), encoding)
    return true
  } catch {
    return false
  }
}

export default { decode, encode, encodingExists }
