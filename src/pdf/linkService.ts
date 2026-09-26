/** The subset of PDF.js's link service its annotation layer calls, wired to Glance. */
import type { PdfDoc } from '../state/documents'
import { openUrl } from '../platform'

export function createLinkService(doc: PdfDoc) {
  const noop = (): void => {}
  return {
    eventBus: { dispatch: noop, on: noop, off: noop, _on: noop, _off: noop },
    externalLinkEnabled: true,
    get pagesCount(): number {
      return doc.pageCount.peek()
    },
    get page(): number {
      return doc.current.peek() + 1
    },
    getDestinationHash: (): string => '#',
    getAnchorUrl: (): string => '#',
    addLinkAttributes(link: HTMLAnchorElement, url: string): void {
      link.href = url
      link.title = url
      link.rel = 'noopener noreferrer'
      link.onclick = (e) => {
        e.preventDefault()
        void openUrl(url)
        return false
      }
    },
    async goToDestination(dest: unknown): Promise<void> {
      const proxy = doc.proxy.peek()
      if (!proxy) return
      const explicit = (typeof dest === 'string' ? await proxy.getDestination(dest) : dest) as unknown[] | null
      const ref = explicit?.[0]
      if (ref == null) return
      doc.goTo(typeof ref === 'number' ? ref : await proxy.getPageIndex(ref as never))
    },
    goToPage(n: number): void {
      doc.goTo(n - 1)
    },
    executeNamedAction(action: string): void {
      const cur = doc.current.peek()
      const map: Record<string, number> = { NextPage: cur + 1, PrevPage: cur - 1, FirstPage: 0, LastPage: doc.pageCount.peek() - 1 }
      if (action in map) doc.goTo(map[action])
    },
    executeSetOCGState: noop,
    navigateTo: noop,
    getAttachmentContent: async (): Promise<null> => null
  }
}
