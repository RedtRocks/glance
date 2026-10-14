import { useRef } from 'preact/hooks'
import { settings, updateSettings } from '../../state/settings'
import { ACCENT_PRESETS, DEFAULT_ACCENT } from '../../core/theme'
import { GRADIENT_PRESETS, MAX_DOTS, dotAt, dotColour, dotFor, harmonise, harmoniesFor, pointOf, windowGradient, type Dot, type Harmony } from '../../core/colourWheel'
import { Icon } from '../Icon'
import { t } from '../../i18n'

const WHEEL = 200

function accentName(id: (typeof ACCENT_PRESETS)[number]['id']): string {
  const names = { violet: t('Violet'), periwinkle: t('Periwinkle'), pink: t('Pink'), orange: t('Orange'), yellow: t('Yellow'), green: t('Green'), blue: t('Blue'), ink: t('Ink') }
  return names[id]
}

function presetName(id: (typeof GRADIENT_PRESETS)[number]['id']): string {
  const names = { dusk: t('Dusk'), lagoon: t('Lagoon'), sunrise: t('Sunrise'), aurora: t('Aurora') }
  return names[id]
}

function harmonyName(h: Harmony): string {
  const names = { complementary: t('Opposite'), analogous: t('Neighbours'), triadic: t('Triangle'), split: t('Split'), free: t('Free') }
  return names[h]
}

/**
 * Window colours, as Zen Browser picks them: click the wheel to place a colour, drag dots to
 * move them, add up to three for a gradient. The first dot is also the accent colour.
 */
export function ColourPanel() {
  const s = settings.value
  const colours = s.colours
  const dots = colours.map(dotFor)
  const wheel = useRef<HTMLDivElement>(null)
  const drag = useRef<number | null>(null)

  const save = (next: Dot[], harmony = s.harmony): void => {
    const placed = harmonise(next, harmony)
    updateSettings({ colours: placed.map(dotColour), harmony })
  }
  const pointer = (e: PointerEvent): Dot => {
    const box = wheel.current!.getBoundingClientRect()
    return dotAt(((e.clientX - box.left) / box.width) * WHEEL, ((e.clientY - box.top) / box.height) * WHEEL, WHEEL)
  }
  const moveDot = (i: number, dot: Dot): void => {
    const next = [...dots]
    next[i] = dot
    // Moving another dot by hand frees the harmony; moving the first carries the others along.
    if (i > 0 && s.harmony !== 'free') return save(next, 'free')
    save(next)
  }
  const addDot = (): void => {
    if (dots.length >= MAX_DOTS) return
    const base = dots[0] ?? dotFor(DEFAULT_ACCENT)
    const harmony = harmoniesFor(dots.length + 1)[0]
    save([...dots, { ...base, hue: (base.hue + 180) % 360 }], harmony)
  }
  const removeDot = (i: number): void => {
    const next = dots.filter((_, j) => j !== i)
    save(next, harmoniesFor(next.length).includes(s.harmony) ? s.harmony : harmoniesFor(next.length)[0])
  }
  const cycleHarmony = (): void => {
    const list = harmoniesFor(dots.length)
    save(dots, list[(list.indexOf(s.harmony) + 1) % list.length])
  }
  const nudge = (i: number, e: KeyboardEvent): void => {
    const d = dots[i]
    const step = e.shiftKey ? 15 : 3
    const moves: Record<string, Dot> = {
      ArrowLeft: { ...d, hue: (d.hue - step + 360) % 360 },
      ArrowRight: { ...d, hue: (d.hue + step) % 360 },
      ArrowUp: { ...d, sat: Math.min(1, d.sat + step / 100) },
      ArrowDown: { ...d, sat: Math.max(0, d.sat - step / 100) }
    }
    if (moves[e.key]) {
      e.preventDefault()
      moveDot(i, moves[e.key])
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && dots.length > 1) {
      e.preventDefault()
      removeDot(i)
    }
  }

  return (
    <div class="colour-panel">
      <div class="colour-wheel-wrap">
        <div
          ref={wheel}
          class="colour-wheel"
          onPointerDown={(e) => {
            if (e.button !== 0 || (e.target as HTMLElement).classList.contains('colour-dot')) return
            // Clicking the wheel places the first colour, or moves it there.
            const dot = pointer(e)
            if (!dots.length) save([dot])
            else moveDot(0, dot)
            drag.current = 0
            wheel.current!.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => drag.current !== null && moveDot(drag.current, pointer(e))}
          onPointerUp={() => void (drag.current = null)}
          onPointerCancel={() => void (drag.current = null)}
        >
          {dots.map((d, i) => {
            const { x, y } = pointOf(d, WHEEL)
            return (
              <button
                key={i}
                class={`colour-dot ${i === 0 ? 'primary' : ''}`}
                style={{ left: `${(x / WHEEL) * 100}%`, top: `${(y / WHEEL) * 100}%`, background: colours[i] }}
                aria-label={i === 0 ? t('Main colour {colour}', { colour: colours[i] }) : t('Colour {colour}', { colour: colours[i] })}
                title={t('Drag to change. Right-click to remove.')}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  drag.current = i
                  wheel.current!.setPointerCapture(e.pointerId)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (dots.length > 1) removeDot(i)
                }}
                onKeyDown={(e) => nudge(i, e)}
              />
            )
          })}
        </div>
        <div class="colour-wheel-actions">
          <button class="icon-button" aria-label={t('Add a colour')} title={t('Add a colour')} disabled={dots.length >= MAX_DOTS} onClick={addDot}>
            <Icon name="add" size={16} />
          </button>
          <button class="icon-button" aria-label={t('Remove a colour')} title={t('Remove a colour')} disabled={dots.length < 2} onClick={() => removeDot(dots.length - 1)}>
            <Icon name="trash" size={16} />
          </button>
          <button class="btn colour-harmony" disabled={dots.length < 2} title={t('How the other colours follow the main one')} onClick={cycleHarmony}>
            {harmonyName(dots.length < 2 ? 'free' : s.harmony)}
          </button>
        </div>
      </div>

      <div class="colour-controls">
        <label class="colour-slider">
          <span>{t('Strength')}</span>
          <input type="range" min={0} max={1} step={0.01} value={s.strength} aria-valuetext={`${Math.round(s.strength * 100)}%`}
            onInput={(e) => updateSettings({ strength: Number((e.target as HTMLInputElement).value) })} />
        </label>
        <label class="colour-slider">
          <span>{t('Grain')}</span>
          <input type="range" min={0} max={1} step={1 / 16} value={s.grain} aria-valuetext={`${Math.round(s.grain * 100)}%`}
            onInput={(e) => updateSettings({ grain: Number((e.target as HTMLInputElement).value) })} />
        </label>

        <span class="colour-label">{t('Colours')}</span>
        <div class="accent-swatches" role="radiogroup" aria-label={t('Colours')}>
          {ACCENT_PRESETS.map((p) => (
            <button key={p.id} class="accent-swatch" role="radio" aria-checked={colours.length === 1 && colours[0] === p.hex}
              aria-label={accentName(p.id)} title={accentName(p.id)} style={{ background: p.hex }}
              onClick={() => updateSettings({ colours: [p.hex] })} />
          ))}
          <label class="accent-swatch accent-custom" title={t('Add an exact colour')}>
            <input type="color" aria-label={t('Add an exact colour')} value={colours[0] ?? DEFAULT_ACCENT}
              onChange={(e) => {
                const hex = (e.target as HTMLInputElement).value
                updateSettings(dots.length && dots.length < MAX_DOTS ? { colours: [...colours, hex], harmony: 'free' } : { colours: [hex] })
              }} />
          </label>
        </div>

        <span class="colour-label">{t('Gradients')}</span>
        <div class="accent-swatches" role="radiogroup" aria-label={t('Gradients')}>
          {GRADIENT_PRESETS.map((p) => (
            <button key={p.id} class="accent-swatch gradient-swatch" role="radio" aria-checked={colours.join() === p.colours.join()}
              aria-label={presetName(p.id)} title={presetName(p.id)}
              style={{ background: windowGradient([...p.colours], 1.6) }}
              onClick={() => updateSettings({ colours: [...p.colours], harmony: 'free', strength: s.strength || 0.6 })} />
          ))}
        </div>
      </div>
    </div>
  )
}
