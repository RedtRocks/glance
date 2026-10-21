// Writes guests 25 to 84 of the WeddingGuests board into scripts/sheet-templates/WeddingGuests.json.
// The board shows the first 24 guests; its totals (96 invited, 71 attending, 16 awaiting,
// 9 declined, the meal and dietary counts and each table's seats) are for all 84, so the
// rest are made up here to add up to them exactly.
// Run: node scripts/sheet-templates/wedding-guests.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const file = join(dirname(fileURLToPath(import.meta.url)), 'WeddingGuests.json')

const names = [
  'Harriet Cole', 'George Cole', 'Matteo Ferreira', 'Sofia Ferreira', 'Bea Ellison', 'Arthur Ellison', 'Leila Nasser', 'Jonah Park',
  'Clara Booth', 'Ivy Booth', 'Rory Fraser', 'Megan Fraser', 'Tariq Aziz', 'Hollie Shaw', 'Dan Whitlock', 'Esme Whitlock',
  'Felix Andrade', 'Rosa Andrade', 'Kit Lambert', 'Phoebe Lambert', 'Amir Haddad', 'Nora Quinn', 'Ben Talbot', 'Zoe Talbot',
  'Luis Moreno', 'Carmen Moreno', 'Oliver Grant', 'Maisie Grant', 'Henry Ward', 'Lottie Ward', 'Samir Patel', 'Anya Patel',
  'Will Harding', 'Jess Harding', 'Elliot Rowe', 'Mira Rowe', 'Callie Brooks', 'Dev Sharma', 'Ruby Sharma', 'Toby Kerr',
  'Agnes Kerr', 'Fin Doyle', 'Cara Doyle', 'Hugo Barnes', 'Lena Barnes', 'Marta Silva', 'Pedro Silva', 'Josie Lane',
  'Alfie Lane', 'Iris Hope', 'Gus Hope', 'Neil Archer', 'Wendy Archer', 'Kai Morgan', 'Elsie Morgan', 'Ray Okafor',
  'Dina Okafor', 'Ted Fisher', 'Polly Fisher', 'Ada Quinn'
]

// Attending rows: [plus-one, table, meal, dietary]. 44 rows, 47 people.
const seats = { 1: 3, 2: 5, 3: 6, 4: 6, 5: 6, 6: 5, 7: 4, 8: 6, 9: 6 }
const meals = { Lamb: 19, 'Sea bass': 13, 'Mushroom risotto': 11, "Child's menu": 4 }
const diets = ['Gluten free', 'Gluten free', 'Halal', 'Halal', 'Vegan', 'Vegan', 'Dairy free', 'Nut allergy']
const plusOneTables = [3, 4, 8]

const attending = []
for (const [t, n] of Object.entries(seats)) {
  let left = n
  if (plusOneTables.includes(+t)) { attending.push({ plus: true, table: +t }); left -= 2 }
  for (let i = 0; i < left; i++) attending.push({ plus: false, table: +t })
}
// Meals by people: plus-one rows take two of the same adult meal; children's menus go to single rows.
const mealQueue = []
for (const [m, n] of Object.entries(meals)) for (let i = 0; i < n; i++) mealQueue.push(m)
for (const g of attending.filter((g) => g.plus)) {
  g.meal = 'Lamb'
  mealQueue.splice(mealQueue.indexOf('Lamb'), 1)
  mealQueue.splice(mealQueue.indexOf('Lamb'), 1)
}
const singles = attending.filter((g) => !g.plus)
// Children on the young families' table, everyone else in turn.
const kids = mealQueue.filter((m) => m === "Child's menu")
const adults = mealQueue.filter((m) => m !== "Child's menu")
singles.filter((g) => g.table === 9).slice(0, kids.length).forEach((g) => { g.meal = kids.shift() })
singles.filter((g) => !g.meal).forEach((g, i) => { g.meal = adults[i] })
if (attending.some((g) => !g.meal) || adults.length !== singles.filter((g) => g.meal !== "Child's menu").length) throw new Error('meals do not add up')
singles.filter((g) => g.meal !== "Child's menu").slice(0, diets.length).forEach((g, i) => { g.diet = diets[i] })

// Awaiting: 9 rows, one with a plus-one (10 people). Declined: 7 rows.
const rows = [
  ...attending.map((g) => ['Attending', g]),
  ...Array.from({ length: 9 }, (_, i) => ['Awaiting', { plus: i === 0 }]),
  ...Array.from({ length: 7 }, () => ['Declined', { plus: false }])
]
if (rows.length !== 60) throw new Error(`${rows.length} rows, not 60`)
// Mix the statuses down the list, the way replies come in.
const order = rows.map((r, i) => [((i * 37) % 60) + i / 1000, r]).sort((a, b) => a[0] - b[0]).map((x) => x[1])

const values = order.map(([rsvp, g], i) => {
  const yes = rsvp === 'Attending'
  return [25 + i, names[i], i % 2 ? 'Tomás' : 'Hannah', rsvp, yes ? g.meal : '–', yes ? g.diet ?? '–' : '–', yes ? g.table : '–', !!g.plus]
})

const people = (s) => order.filter(([r]) => r === s).reduce((n, [, g]) => n + (g.plus ? 2 : 1), 0)
console.log(`attending ${people('Attending')}, awaiting ${people('Awaiting')}, declined ${people('Declined')}`)

const overlay = JSON.parse(readFileSync(file, 'utf8'))
const at = overlay.ops.findIndex((op) => op.sheet === 'Guest List' && op.op === 'set' && op.range === 'A33:H92')
const op = { op: 'set', sheet: 'Guest List', range: 'A33:H92', values }
if (at >= 0) overlay.ops[at] = op
else throw new Error('add a set A33:H92 op where the guests go')
const { ops, ...head } = overlay
const top = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')
writeFileSync(file, `{\n${top}\n  "ops": [\n${ops.map((o) => `    ${JSON.stringify(o)}`).join(',\n')}\n  ]\n}\n`)
