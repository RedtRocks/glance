/** Where a desktop copy came from, as the anonymous install count reports it (ADR 0016). */
export function installSource(store: boolean, flatpak: boolean): 'Microsoft Store' | 'Flatpak' | 'GitHub' {
  // A Flatpak can't tell Flathub from a GitHub download: its branch is the publisher's choice, not provenance.
  return store ? 'Microsoft Store' : flatpak ? 'Flatpak' : 'GitHub'
}
