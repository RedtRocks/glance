/**
 * Video and audio, played by the web view's own players. Formats the system has no
 * codec for (some MKV and MOV files) report an error instead of a blank player.
 */
import * as platform from '../platform'
import { t } from '../i18n'
import type { PreviewFile, PreviewRendering } from './render'

const NOTE = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18 34.5a6.5 6.5 0 1 1-4-6V10l24-5v24.5a6.5 6.5 0 1 1-4-6V14.3l-16 3.3v16.9Z" fill="currentColor"/></svg>'

export async function renderMedia(flavor: 'video' | 'audio', file: PreviewFile, container: HTMLElement): Promise<PreviewRendering> {
  const { url, revoke } = await platform.mediaUrl(file.path, file.name)
  const stage = document.createElement('div')
  stage.className = `media-stage media-${flavor}`
  const player = document.createElement(flavor)
  player.controls = true
  player.preload = 'metadata'
  player.setAttribute('controlsList', 'nodownload')
  if (flavor === 'audio') {
    const card = document.createElement('div')
    card.className = 'media-card'
    const art = document.createElement('div')
    art.className = 'media-art'
    art.innerHTML = NOTE
    const title = document.createElement('h2')
    title.textContent = file.name.replace(/\.[^.]+$/, '')
    card.append(art, title, player)
    stage.append(card)
  } else {
    ;(player as HTMLVideoElement).playsInline = true
    stage.append(player)
  }
  container.append(stage)

  const dispose = () => {
    player.pause()
    player.removeAttribute('src')
    player.load()
    revoke()
  }
  try {
    await new Promise<void>((resolve, reject) => {
      player.addEventListener('loadedmetadata', () => resolve(), { once: true })
      player.addEventListener('error', () => reject(new Error(t('This video or sound uses a format your system can’t play.'))), { once: true })
      player.src = url
    })
  } catch (e) {
    dispose()
    throw e
  }
  return {
    pageCount: 1,
    sheetNames: [],
    goTo: () => {},
    // Zooming a player makes little sense; the video already fits the window.
    setZoom: () => {},
    dispose
  }
}
