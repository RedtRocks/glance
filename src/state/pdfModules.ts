/** Lazy loaders for the pdf-lib based modules (ADR 0002). */
import type * as PageOps from '../core/pageOps'
import type * as Annotations from '../core/annotations'
import type * as Redact from '../core/redact'

let pageOpsP: Promise<typeof PageOps> | null = null
let annotationsP: Promise<typeof Annotations> | null = null
let redactP: Promise<typeof Redact> | null = null

export const pageOps = (): Promise<typeof PageOps> => (pageOpsP ??= import('../core/pageOps'))
export const annotations = (): Promise<typeof Annotations> => (annotationsP ??= import('../core/annotations'))
export const redact = (): Promise<typeof Redact> => (redactP ??= import('../core/redact'))
