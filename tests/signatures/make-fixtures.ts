/**
 * Regenerates the signed PDF fixtures with OpenSSL and a throwaway self-signed certificate:
 *   npx vite-node tests/signatures/make-fixtures.ts
 * Also writes the Rust fixtures in src-tauri/testdata/.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from '@cantoo/pdf-lib'
import { labeledPdf } from '../fixtures'
import { embedSignature, prepareSignature } from '../../src/core/pdfSign'
import { signedBytes } from '../../src/core/pdfSignatures'

const dir = mkdtempSync(join(tmpdir(), 'glance-sig-'))
const key = join(dir, 'key.pem')
const cert = join(dir, 'cert.pem')
const ssl = (...args: string[]): void => void execFileSync('openssl', args, { stdio: 'pipe' })
ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '36500', '-subj', '/CN=Glance Test Signer/O=Glance/emailAddress=test@example.com')

function cms(data: Uint8Array, extra: string[] = []): Uint8Array {
  const input = join(dir, 'in.bin')
  const out = join(dir, 'out.p7s')
  writeFileSync(input, data)
  ssl('cms', '-sign', '-binary', '-in', input, '-signer', cert, '-inkey', key, '-outform', 'DER', '-out', out, ...extra)
  return new Uint8Array(readFileSync(out))
}

async function sign(bytes: Uint8Array, name: string, time: number): Promise<Uint8Array> {
  const prepared = await prepareSignature(bytes, { name, reason: 'Approved', location: 'Test', time })
  return embedSignature(prepared, cms(signedBytes(prepared.pdf, prepared.byteRange), ['-md', 'sha256']))
}

const T = Date.UTC(2026, 0, 15, 12, 0, 0)
const signed = await sign(await labeledPdf(2), 'Glance Test Signer', T)
writeFileSync('tests/signatures/signed.pdf', signed)
writeFileSync('tests/signatures/signed-twice.pdf', await sign(signed, 'Second Signer', T + 60_000))

// Changed after signing: an incremental update that retitles the document.
const doc = await PDFDocument.load(signed, { forIncrementalUpdate: true, updateMetadata: false })
doc.setTitle('Changed later')
const info = doc.context.trailerInfo.Info
if (info) doc.context.snapshot?.markRefForSave(info as never)
writeFileSync('tests/signatures/signed-then-changed.pdf', await doc.commit({ useObjectStreams: false }))

// Rust: a detached signature, the bytes it covers, and an adbe.pkcs7.sha1-style signature.
const data = new TextEncoder().encode('Glance signature test data\n')
writeFileSync('src-tauri/testdata/data.bin', data)
writeFileSync('src-tauri/testdata/detached.p7s', cms(data, ['-md', 'sha256']))
const sha1 = new Uint8Array(await crypto.subtle.digest('SHA-1', data))
writeFileSync('src-tauri/testdata/embedded-sha1.p7s', cms(sha1, ['-nodetach', '-md', 'sha1']))
console.log('fixtures written')
