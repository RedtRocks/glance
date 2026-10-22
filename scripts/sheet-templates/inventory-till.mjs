// Writes the Inventory board's hidden Till sheet (one row per sale line) into
// scripts/sheet-templates/Inventory.json, so the Sales sheet's weekly grid, best sellers and
// average basket all add up from it to the board's figures: 1,214 lines, £20,290 in all.
// Run: node scripts/sheet-templates/inventory-till.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const file = join(here, 'Inventory.json')

const cats = ['Foliage', 'Succulents', 'Flowering', 'Pots', 'Care']
// Takings by week (rows, w/c 24 Aug to 12 Oct) and category, from the board.
const grid = [
  [980, 310, 260, 420, 140], [1040, 290, 240, 450, 150], [1110, 330, 220, 470, 160], [1060, 350, 280, 430, 150],
  [1180, 320, 300, 510, 170], [1290, 380, 410, 560, 190], [1420, 410, 520, 640, 210], [1350, 360, 440, 590, 200]
]
const weekStart = (w) => new Date(Date.UTC(2026, 7, 24 + 7 * w))
// The best sellers: name, category, price, units over the 8 weeks.
const best = [
  ["Pothos 'Marble Queen'", 'Foliage', 12, 96], ['Monstera deliciosa', 'Foliage', 28, 41], ["Snake plant 'Laurentii'", 'Foliage', 22, 48],
  ['Terracotta pot', 'Pots', 6, 150], ['Moth orchid', 'Flowering', 24, 34], ["Cyclamen 'Winter Ruby'", 'Flowering', 9, 88],
  ['Christmas cactus', 'Flowering', 13, 52], ['Peat-free compost', 'Care', 8, 72]
]
const others = {
  Foliage: ['ZZ plant', 'Calathea orbifolia', 'Boston fern', 'Fiddle-leaf fig'],
  Succulents: ['Echeveria trio', 'String of pearls', 'Aloe vera'],
  Flowering: ['Peace lily'],
  Pots: ["Glazed pot 'Sage'", 'Macramé hanger'],
  Care: ['Liquid plant feed', 'Brass mister']
}
const LINES = 1214

// Spread n whole units over weights, largest remainder first.
function spread(n, weights) {
  const sum = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map((w) => (n * w) / sum)
  const out = raw.map(Math.floor)
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0])
  const short = n - out.reduce((a, b) => a + b, 0)
  for (let k = 0; k < short; k++) out[order[k][1]]++
  return out
}

const lines = []
const rest = [] // [week, cat, amount] left for the other items
const topUnits = best.map(([, cat, , units]) => spread(units, grid.map((row) => row[cats.indexOf(cat)])))
for (let w = 0; w < 8; w++) {
  cats.forEach((cat, c) => {
    let left = grid[w][c]
    best.forEach(([name, tc, price], t) => {
      if (tc !== cat) return
      for (let u = 0; u < topUnits[t][w]; u++) lines.push([w, name, cat, 1, price])
      left -= topUnits[t][w] * price
    })
    if (left < 0) throw new Error(`week ${w} ${cat} goes over by ${-left}`)
    rest.push([w, cat, left])
  })
}
// The other items' takings, in lines of a few pounds each, so the line count comes out right.
const counts = spread(LINES - lines.length, rest.map((r) => r[2]))
rest.forEach(([w, cat, amount], i) => {
  const n = Math.max(counts[i], amount > 0 ? 1 : 0)
  const parts = spread(amount, Array(n).fill(1))
  parts.forEach((p, k) => lines.push([w, others[cat][k % others[cat].length], cat, 1, p]))
})
if (lines.length !== LINES) throw new Error(`${lines.length} lines, not ${LINES}`)

// Order by week, then put each line on a day of its week (Monday to Saturday).
lines.sort((a, b) => a[0] - b[0])
const perWeek = {}
const rows = lines.map(([w, name, cat, units, takings]) => {
  const k = (perWeek[w] = (perWeek[w] ?? -1) + 1)
  const d = weekStart(w)
  d.setUTCDate(d.getUTCDate() + (k % 6))
  const date = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
  return [date, name, cat, units, takings]
})

const overlay = JSON.parse(readFileSync(file, 'utf8'))
overlay.ops = overlay.ops.filter((op) => !(op.sheet === 'Till' && op.op === 'set' && op.range?.startsWith('A2:')))
const at = overlay.ops.findIndex((op) => op.op === 'addSheet' && op.name === 'Till')
overlay.ops.splice(at + 1, 0, { op: 'set', sheet: 'Till', range: `A2:E${rows.length + 1}`, values: rows })
const { ops, ...head } = overlay
const top = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')
writeFileSync(file, `{\n${top}\n  "ops": [\n${ops.map((op) => `    ${JSON.stringify(op)}`).join(',\n')}\n  ]\n}\n`)
console.log(`${rows.length} till lines written`)
