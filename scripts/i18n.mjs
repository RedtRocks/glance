#!/usr/bin/env node
/**
 * Translation tooling (see src/i18n/index.ts).
 *
 *   npm run i18n              list UI text that skips t() and each catalog's coverage
 *   npm run i18n -- de fr     create or update src/i18n/locales/de.json and fr.json:
 *                             new text is added with an empty translation, text no
 *                             longer in the app is dropped
 *
 * A line (or the line above it) containing "i18n-ignore" is skipped by the check.
 */
import ts from 'typescript'
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
export const LOCALES = join(SRC, 'i18n', 'locales')

/** Props and dialog fields that hold text the user reads. */
const TEXT_PROPS = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label', 'description', 'heading', 'text', 'message', 'busyLabel'])
/** Functions whose first argument is text the user reads. */
const TEXT_CALLS = new Set(['toast', 'alertDialog', 'promptText', 'withBusy', 'confirm', 'alert'])

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return files(p)
    return /\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [p] : []
  })
}

const wordy = (s) => /[A-Za-z]{2,}/.test(s)

/**
 * Scans the source. Returns every message passed to t()/msg(), calls whose message
 * isn't a plain string (the tooling can't see those), and UI text that skips t().
 */
export function scan(root = SRC) {
  const messages = new Map()
  const dynamic = []
  const hardcoded = []
  for (const file of files(root)) {
    const code = readFileSync(file, 'utf8')
    const lines = code.split('\n')
    const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const where = (node) => {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line
      return { file: relative(ROOT, file).replaceAll('\\', '/'), line: line + 1, ignored: /i18n-ignore/.test(lines[line] + (lines[line - 1] ?? '')) }
    }
    const flag = (node, text) => {
      const w = where(node)
      if (!w.ignored) hardcoded.push({ file: w.file, line: w.line, text: text.trim().replace(/\s+/g, ' ') })
    }
    /** A string literal or template with English in it. */
    const literalText = (node) => {
      if (!node) return null
      if (ts.isParenthesizedExpression(node)) return literalText(node.expression)
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return wordy(node.text) ? node.text : null
      if (ts.isTemplateExpression(node)) {
        const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join('…')
        return wordy(parts) ? parts : null
      }
      if (ts.isConditionalExpression(node)) return literalText(node.whenTrue) ?? literalText(node.whenFalse)
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) return literalText(node.right)
      return null
    }
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text
        if (name === 't' || name === 'msg') {
          const arg = node.arguments[0]
          if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
            const w = where(arg)
            if (!messages.has(arg.text)) messages.set(arg.text, [])
            messages.get(arg.text).push(`${w.file}:${w.line}`)
          } else if (name === 'msg' || (arg && !ts.isIdentifier(arg) && !ts.isPropertyAccessExpression(arg) && !ts.isElementAccessExpression(arg))) {
            // t(c.label) translates text marked elsewhere; anything built on the spot can't be extracted.
            const w = where(node)
            if (!w.ignored) dynamic.push({ file: w.file, line: w.line, text: node.getText(sf).slice(0, 80) })
          }
          return // the arguments are handled
        }
        if (TEXT_CALLS.has(name)) {
          const text = literalText(node.arguments[0])
          if (text) flag(node.arguments[0], text)
        }
      }
      if (ts.isJsxText(node) && wordy(node.text)) flag(node, node.text)
      if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
        const text = literalText(node.expression)
        if (text) flag(node, text)
      }
      if (ts.isJsxAttribute(node) && TEXT_PROPS.has(node.name.getText(sf)) && node.initializer) {
        const init = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer
        const text = literalText(init)
        if (text) flag(node, text)
      }
      if (ts.isPropertyAssignment(node) && TEXT_PROPS.has(node.name.getText(sf).replace(/['"]/g, ''))) {
        const text = literalText(node.initializer)
        if (text) flag(node, text)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return { messages, dynamic, hardcoded }
}

export function readCatalog(code) {
  const p = join(LOCALES, `${code}.json`)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
}

export function catalogCodes() {
  return existsSync(LOCALES) ? readdirSync(LOCALES).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []
}

function main(args) {
  const { messages, dynamic, hardcoded } = scan()
  if (args.length) {
    for (const code of args) {
      const old = readCatalog(code)
      const next = {}
      for (const m of [...messages.keys()].sort((a, b) => a.localeCompare(b))) next[m] = old[m] ?? ''
      writeFileSync(join(LOCALES, `${code}.json`), JSON.stringify(next, null, 2) + '\n')
      const done = Object.values(next).filter(Boolean).length
      const dropped = Object.keys(old).filter((m) => !(m in next)).length
      console.log(`${code}: ${done}/${messages.size} translated${dropped ? `, ${dropped} unused removed` : ''}`)
    }
    return
  }
  console.log(`${messages.size} messages go through t()/msg().`)
  for (const code of catalogCodes()) {
    const cat = readCatalog(code)
    console.log(`  ${code}: ${[...messages.keys()].filter((m) => cat[m]).length}/${messages.size} translated`)
  }
  if (dynamic.length) {
    console.log(`\n${dynamic.length} calls whose text the tooling can't see (pass a plain string, with {placeholders}):`)
    for (const d of dynamic) console.log(`  ${d.file}:${d.line}  ${d.text}`)
  }
  if (hardcoded.length) {
    console.log(`\n${hardcoded.length} pieces of UI text skip t():`)
    for (const h of hardcoded) console.log(`  ${h.file}:${h.line}  ${h.text}`)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2))
