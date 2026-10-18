const ranks: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, '10': 10, J: 11, Q: 12, K: 13, A: 14 }
const suits = ['c', 'd', 'h', 's'] as const
export type EquityResult = { wins: number; ties: number; losses: number; trials: number; equity: number }

export function parseCardList(value: string): string[] | null {
  const tokens = value.trim().split(/[\s,]+/).filter(Boolean)
  if (!tokens.length) return []
  const parsed = tokens.map(normalizeCard)
  return parsed.some(card => card === null) ? null : parsed as string[]
}

function normalizeCard(value: string): string | null {
  const match = value.match(/^(10|[2-9tjqka])([cdhs])$/i)
  if (!match) return null
  const rank = match[1].toUpperCase() === '10' ? 'T' : match[1].toUpperCase()
  return `${rank}${match[2].toLowerCase()}`
}

function rankOf(card: string): number { return ranks[card.slice(0, -1).toUpperCase()] }
function scoreFive(cards: string[]): number {
  const values = cards.map(rankOf).sort((a, b) => b - a)
  const counts = new Map<number, number>()
  for (const rank of values) counts.set(rank, (counts.get(rank) ?? 0) + 1)
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const flush = cards.every(card => card.at(-1) === cards[0].at(-1))
  const unique = [...new Set(values)]
  const straightHigh = (): number => {
    if (unique.length !== 5) return 0
    if (unique[0] - unique[4] === 4) return unique[0]
    if (unique[0] === 14 && unique[1] === 5 && unique[4] === 2) return 5
    return 0
  }
  const straight = straightHigh()
  let category: number
  let tieBreak: number[]
  if (flush && straight) { category = 8; tieBreak = [straight] }
  else if (groups[0][1] === 4) { category = 7; tieBreak = [groups[0][0], groups[1][0]] }
  else if (groups[0][1] === 3 && groups[1][1] === 2) { category = 6; tieBreak = [groups[0][0], groups[1][0]] }
  else if (flush) { category = 5; tieBreak = values }
  else if (straight) { category = 4; tieBreak = [straight] }
  else if (groups[0][1] === 3) { category = 3; tieBreak = [groups[0][0], ...groups.slice(1).map(group => group[0]).sort((a, b) => b - a)] }
  else if (groups[0][1] === 2 && groups[1][1] === 2) { category = 2; tieBreak = [Math.max(groups[0][0], groups[1][0]), Math.min(groups[0][0], groups[1][0]), groups[2][0]] }
  else if (groups[0][1] === 2) { category = 1; tieBreak = [groups[0][0], ...groups.slice(1).map(group => group[0]).sort((a, b) => b - a)] }
  else { category = 0; tieBreak = values }
  return [...tieBreak, 0, 0, 0, 0, 0].slice(0, 5).reduce((score, rank) => score * 15 + rank, category)
}

function bestOfSeven(cards: string[]): number {
  let best = -1
  for (let a = 0; a < cards.length - 1; a++) for (let b = a + 1; b < cards.length; b++) {
    const five = cards.filter((_, index) => index !== a && index !== b)
    best = Math.max(best, scoreFive(five))
  }
  return best
}

export function calculateShowdownEquity(heroInput: string[], opponentInput: string[], boardInput: string[], samples = 8000): EquityResult {
  const hero = heroInput.map(normalizeCard)
  const opponent = opponentInput.map(normalizeCard)
  const board = boardInput.map(normalizeCard)
  if (hero.length !== 2 || opponent.length !== 2 || board.length > 5 || [...hero, ...opponent, ...board].some(card => card === null)) throw new Error('Enter two valid hole cards for each player and up to five valid board cards.')
  const known = [...hero, ...opponent, ...board] as string[]
  if (new Set(known).size !== known.length) throw new Error('A card cannot appear more than once.')
  const knownCards = known as string[]
  const deck = ranksList().flatMap(rank => suits.map(suit => `${rank}${suit}`)).filter(card => !knownCards.includes(card))
  const missing = 5 - board.length
  const trials = missing === 0 ? 1 : samples
  let wins = 0, ties = 0, losses = 0
  let seed = knownCards.join('').split('').reduce((value, char) => (value * 33 + char.charCodeAt(0)) >>> 0, 5381)
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000 }
  for (let trial = 0; trial < trials; trial++) {
    const remaining = [...deck]
    const runout: string[] = []
    for (let index = 0; index < missing; index++) {
      const picked = index + Math.floor(random() * (remaining.length - index))
      ;[remaining[index], remaining[picked]] = [remaining[picked], remaining[index]]
      runout.push(remaining[index])
    }
    const finalBoard = [...board as string[], ...runout]
    const heroScore = bestOfSeven([...hero as string[], ...finalBoard])
    const opponentScore = bestOfSeven([...opponent as string[], ...finalBoard])
    if (heroScore > opponentScore) wins++
    else if (heroScore === opponentScore) ties++
    else losses++
  }
  return { wins, ties, losses, trials, equity: (wins + ties / 2) / trials }
}

function ranksList(): string[] { return ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] }
