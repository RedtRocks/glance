/** Lazy loaders for the pdf-lib based modules (ADR 0002). */
import type * as PageOps from '../core/pageOps'
import type * as Annotations from '../core/annotations'
import type * as Redact from '../core/redact'
import type * as Cleanup from '../core/cleanup'
import type * as PdfSignatures from '../core/pdfSignatures'

let pageOpsP: Promise<typeof PageOps> | null = null
let annotationsP: Promise<typeof Annotations> | null = null
let redactP: Promise<typeof Redact> | null = null
let cleanupP: Promise<typeof Cleanup> | null = null
let pdfSignaturesP: Promise<typeof PdfSignatures> | null = null

export const pageOps = (): Promise<typeof PageOps> => (pageOpsP ??= import('../core/pageOps'))
export const annotations = (): Promise<typeof Annotations> => (annotationsP ??= import('../core/annotations'))
export const cleanup = (): Promise<typeof Cleanup> => (cleanupP ??= import('../core/cleanup'))
export const redact = (): Promise<typeof Redact> => (redactP ??= import('../core/redact'))
export const pdfSignatures = (): Promise<typeof PdfSignatures> => (pdfSignaturesP ??= import('../core/pdfSignatures'))
