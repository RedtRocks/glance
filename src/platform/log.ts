import { isTauri } from '.'

/** Mirrors webview errors to the backend's stderr (see `log_frontend`). */
export function forwardErrors(): void {
  if (!isTauri) return
  const send = (level: string, message: string): void => {
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke('log_frontend', { level, message }).catch(() => undefined))
  }
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      send(level, args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(' '))
    }
  }
  window.addEventListener('error', (e) => send('uncaught', `${e.message} at ${e.filename}:${e.lineno}`))
  window.addEventListener('unhandledrejection', (e) => send('unhandled', String(e.reason?.stack ?? e.reason)))
}
