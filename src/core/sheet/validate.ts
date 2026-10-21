/**
 * Data validation: whether a value fits a cell's rule (a drop-down list, whole or decimal
 * numbers, dates, text length or a tick box), and the words to say when it doesn't.
 * Messages are English: the grid shows them through t(), AI apps read them as they are.
 */
import { dateFromSerial } from './format'
import { isError, type Validation, type Value } from './model'

const date = (n: number) => {
  const d = dateFromSerial(n)
  return `${d.d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.m - 1]} ${d.y}`
}

/** The choices of a list rule: its own values, or the cells of its source range. */
export function listChoices(v: Validation, rangeValues: (ref: string) => string[]): string[] {
  if (v.type !== 'list') return []
  return v.source ? rangeValues(v.source) : (v.values ?? [])
}

/** Null when `value` is allowed, else why not. */
export function validationProblem(v: Validation, value: Value, rangeValues: (ref: string) => string[]): string | null {
  if (value === null || value === '') return v.allowBlank === false ? 'this cell can’t be left blank' : null
  if (isError(value)) return null
  switch (v.type) {
    case 'list': {
      const choices = listChoices(v, rangeValues)
      const text = String(value)
      if (!choices.length || choices.some((c) => c.toLowerCase() === text.toLowerCase())) return null
      return `pick one of ${choices.slice(0, 12).join(', ')}${choices.length > 12 ? ', …' : ''}`
    }
    case 'checkbox':
      return typeof value === 'boolean' ? null : 'this is a tick box: use true or false'
    case 'whole':
    case 'decimal':
    case 'date': {
      if (typeof value !== 'number') return v.type === 'date' ? 'enter a date' : 'enter a number'
      if (v.type === 'whole' && !Number.isInteger(value)) return 'enter a whole number'
      const show = (n: number) => (v.type === 'date' ? date(n) : String(n))
      if (v.min !== undefined && value < v.min) return v.max !== undefined ? `enter something from ${show(v.min)} to ${show(v.max)}` : `enter ${show(v.min)} or more`
      if (v.max !== undefined && value > v.max) return v.min !== undefined ? `enter something from ${show(v.min)} to ${show(v.max)}` : `enter ${show(v.max)} or less`
      return null
    }
    case 'textLength': {
      const n = String(value).length
      if (v.min !== undefined && n < v.min) return `use at least ${v.min} characters`
      if (v.max !== undefined && n > v.max) return `use at most ${v.max} characters`
      return null
    }
  }
  return null
}

/** A short description of the rule, for the grid's hint and AI apps. */
export function describeRule(v: Validation): string {
  switch (v.type) {
    case 'list':
      return v.source ? `one of the values in ${v.source}` : `one of ${(v.values ?? []).join(', ')}`
    case 'checkbox':
      return 'a tick box (TRUE or FALSE)'
    case 'textLength':
      return `text of ${v.min ?? 0} to ${v.max ?? '∞'} characters`
    default: {
      const kind = v.type === 'whole' ? 'a whole number' : v.type === 'date' ? 'a date' : 'a number'
      const show = (n: number) => (v.type === 'date' ? date(n) : String(n))
      if (v.min !== undefined && v.max !== undefined) return `${kind} from ${show(v.min)} to ${show(v.max)}`
      if (v.min !== undefined) return `${kind} of ${show(v.min)} or more`
      if (v.max !== undefined) return `${kind} of ${show(v.max)} or less`
      return kind
    }
  }
}
