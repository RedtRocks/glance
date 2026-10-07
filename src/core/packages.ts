/** Install command for `pkg` on the running Linux distribution, from /etc/os-release text. */
export function linuxInstallCommand(pkg: string, osRelease: string): string {
  for (const line of osRelease.split('\n')) {
    const match = line.match(/^(?:ID|ID_LIKE)=(.*)$/)
    if (!match) continue
    const tokens = match[1].replace(/["']/g, '').split(/\s+/)
    if (tokens.some((token) => token === 'debian' || token === 'ubuntu')) return `sudo apt install ${pkg}`
  }
  return `sudo dnf install ${pkg}`
}
