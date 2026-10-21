import { useEffect, useState } from 'preact/hooks'
import { buildPlan, changeRequest, planning, skipPlan } from '../../state/plan'
import type { Density, Plan, PlanItem } from '../../core/ai/guide'
import { TEMPLATES } from '../../state/templates'
import { THEMES } from '../../core/deck/themes'
import { designsVersion, loadBoard, loadedBoard, sampleText } from '../../state/designs'
import { boardDeck } from '../../core/deck/template'
import { SlidePreview } from '../deck/SlideFrame'
import { themeLabel } from '../deck/labels'
import { t } from '../../i18n'
import { Icon } from '../Icon'

const DOTS = ['#f47933', '#f258a8', '#6312f6', '#f8d32c']

/** A look's picture: a template's cover, or a title slide in a theme. */
function LookPreview({ look, width }: { look: string; width: number }) {
  void designsVersion.value
  const board = loadedBoard(look)
  useEffect(() => void loadBoard(look), [look])
  if (TEMPLATES.some((x) => x.id === look)) {
    const first = board ? boardDeck(board, sampleText).slides[0] : undefined
    return first ? <SlidePreview slide={first} theme="wollo" width={width} /> : <span class="outline-look-empty" style={{ width: `${width}px` }} />
  }
  return <SlidePreview slide={{ id: 'look', layout: 'title', slots: { title: { kind: 'text', value: t('Your Title Here') } }, notes: '', hidden: false }} theme={look} width={width} />
}

const lookName = (id: string): string => {
  const tpl = TEMPLATES.find((x) => x.id === id)
  return tpl ? t(tpl.look) : themeLabel(id)
}

/** "Here's the plan": the AI's plan for a new file, to change before it builds. */
export function OutlineScreen() {
  const p = planning.value
  const [items, setItems] = useState<PlanItem[]>([])
  const [answers, setAnswers] = useState<string[]>([])
  const [look, setLook] = useState<string | undefined>()
  const [density, setDensity] = useState<Density>('some')
  const [editing, setEditing] = useState<number | null>(null)
  useEffect(() => {
    if (p?.plan) {
      setItems(p.plan.items)
      setAnswers((p.plan.questions ?? []).map(() => ''))
      setLook(p.plan.look)
    }
  }, [p?.plan])
  if (!p) return null
  const deck = p.kind === 'deck'
  const unit = (n: number) => (deck ? t('{count, plural, one {# slide} other {# slides}}', { count: n }) : p.kind === 'document' ? t('{count, plural, one {# section} other {# sections}}', { count: n }) : t('{count, plural, one {# sheet} other {# sheets}}', { count: n }))
  const looks = deck ? [...new Set([...(look ? [look] : []), ...TEMPLATES.map((x) => x.id), ...Object.keys(THEMES)])] : []
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    setItems(next)
  }
  const add = () => {
    setItems([...items, { title: deck ? t('New slide') : t('New section') }])
    setEditing(items.length)
  }
  const build = () => {
    const plan: Plan = { ...p.plan!, items: items.filter((it) => it.title.trim()), look, questions: (p.plan!.questions ?? []).map((q, i) => ({ question: q.question, answer: answers[i] })) }
    void buildPlan(plan, density)
  }

  return (
    <div class="make-screen outline-screen" role="dialog" aria-modal="true" aria-label={t('Here’s the plan')}>
      <div class="outline-head">
        <div>
          <h1>{p.status === 'ready' ? t('Here’s the Plan') : t('Planning…')}</h1>
          <span class="outline-asked">{t('You asked for: {request}', { request: p.request })}</span>
        </div>
        <button class="link-button" onClick={changeRequest}>{t('Change what I asked')}</button>
      </div>
      {p.status === 'waiting' ? (
        <div class="outline-waiting">
          <span class="spinner" aria-hidden="true" />
          <p>{t('The AI is planning it. You can change the plan before it builds anything.')}</p>
          <button class="btn" onClick={() => void skipPlan()}>{t('Just make it')}</button>
        </div>
      ) : (
        <div class="outline-body">
          <div class="outline-plan">
            <div class="outline-controls">
              <span class="outline-label">{deck ? t('Slides') : p.kind === 'document' ? t('Sections') : t('Sheets')}</span>
              <div class="outline-stepper">
                <button aria-label={t('Fewer')} disabled={items.length <= 1} onClick={() => setItems(items.slice(0, -1))}>−</button>
                <span>{items.length}</span>
                <button aria-label={t('More')} onClick={add}>+</button>
              </div>
              <span class="outline-label">{t('Words')}</span>
              <div class="outline-words" role="group" aria-label={t('How many words')}>
                {(['few', 'some', 'lots'] as const).map((d) => (
                  <button key={d} aria-pressed={density === d} onClick={() => setDensity(d)}>
                    {d === 'few' ? t('Few') : d === 'some' ? t('Some') : t('Lots')}
                  </button>
                ))}
              </div>
            </div>
            <ol class="outline-items">
              {items.map((it, i) => (
                <li key={i} class={editing === i ? 'on' : ''} onClick={() => setEditing(i)}>
                  <span class="outline-num" style={{ background: DOTS[i % DOTS.length], color: i % DOTS.length === 2 ? '#fff' : undefined }}>{i + 1}</span>
                  <div class="outline-text">
                    {editing === i ? (
                      <input
                        value={it.title}
                        aria-label={t('Title of {count}', { count: unit(1) })}
                        ref={(el) => el?.focus()}
                        onInput={(e) => setItems(items.map((x, j) => (j === i ? { ...x, title: e.currentTarget.value } : x)))}
                        onKeyDown={(e) => e.key === 'Enter' && setEditing(null)}
                      />
                    ) : (
                      <span class="outline-title">{it.title}</span>
                    )}
                    {it.detail && <span class="outline-detail">{it.detail}</span>}
                  </div>
                  <div class="outline-item-buttons">
                    <button aria-label={t('Move up')} title={t('Move up')} disabled={i === 0} onClick={(e) => (e.stopPropagation(), move(i, -1))}><Icon name="up" size={12} /></button>
                    <button aria-label={t('Move down')} title={t('Move down')} disabled={i === items.length - 1} onClick={(e) => (e.stopPropagation(), move(i, 1))}><Icon name="down" size={12} /></button>
                    <button aria-label={t('Remove')} title={t('Remove')} onClick={(e) => (e.stopPropagation(), setItems(items.filter((_, j) => j !== i)), setEditing(null))}><Icon name="close" size={12} /></button>
                  </div>
                </li>
              ))}
            </ol>
            <button class="outline-add" onClick={add}>{deck ? t('+ Add a Slide') : t('+ Add a Section')}</button>
            {!!p.plan?.questions?.length && (
              <div class="outline-questions">
                <h2>{t('A Few Questions')}</h2>
                <span class="outline-asked">{t('Leave any blank and the AI writes a placeholder like [date] for you to fill.')}</span>
                {p.plan.questions.map((q, i) => (
                  <label key={i}>
                    <span>{q.question}</span>
                    <input value={answers[i] ?? ''} onInput={(e) => setAnswers(answers.map((a, j) => (j === i ? e.currentTarget.value : a)))} />
                  </label>
                ))}
              </div>
            )}
          </div>
          <div class="outline-side">
            {deck && (
              <>
                <h2>{t('Pick a Look')}</h2>
                <span class="outline-asked">{t('Shown with your first slide. You can switch any time.')}</span>
                {look && (
                  <button class="outline-look big" aria-pressed="true">
                    <LookPreview look={look} width={356} />
                    <span>{lookName(look)}</span>
                  </button>
                )}
                <div class="outline-looks">
                  {looks.filter((l) => l !== look).map((l) => (
                    <button key={l} class="outline-look" aria-pressed="false" onClick={() => setLook(l)}>
                      <LookPreview look={l} width={168} />
                      <span>{lookName(l)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <button class="outline-build" disabled={!items.length} onClick={build}>
              <Icon name="sparkle" size={18} />
              {deck ? t('Make My {count, plural, one {# Slide} other {# Slides}}', { count: items.length }) : t('Build It')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
