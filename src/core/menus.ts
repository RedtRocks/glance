/** The menuOpen value for the toolbar's More options (⋯) menu. */
export const OVERFLOW_MENU = '__overflow'

/** What the toolbar's More options (⋯) menu lists: command ids, '-' for a separator. */
export const OVERFLOW_ITEMS: string[] = [
  'file.share', 'file.print', 'file.export', 'file.openWith', '-',
  'image.setWallpaper', 'image.setLockScreen', '-',
  'view.slideshow', 'view.darkPdf', '-',
  'view.customizeToolbar', 'file.settings'
]

/**
 * Whether an open menu belongs to the menu bar. The menu bar closes only its own
 * menus on an outside press: closing the overflow menu on pointerdown would
 * unmount it before the item's click lands, so none of its items would run.
 */
export function isMenuBarMenu(open: string | null): boolean {
  return !!open && open !== OVERFLOW_MENU
}
