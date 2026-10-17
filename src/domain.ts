import { z } from 'zod'

export const SiteSchema = z.enum(['888poker', 'sky_poker'])
export type Site = z.infer<typeof SiteSchema>
export type ParseStatus = 'complete' | 'partial' | 'failed'
export type ImportDiagnostic = { severity: 'warning' | 'error'; message: string; line?: number }
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'other'
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'post_blind' | 'post_ante' | 'collect' | 'show' | 'other'
export type HandAction = { sequence: number; street: Street; player: string | null; actionType: ActionType; amount: number | null; amountTo: number | null; sourceText: string }
export type HandPlayer = { name: string; seat: number; position: string | null; startingStack: number | null; holeCards: string[] | null; shownCards: string[] | null; isHero: boolean }
export type Hand = { id: string; site: Site; sourceHandId: string | null; tournamentId: string | null; tournamentName: string | null; buyInMinor: number | null; feeMinor: number | null; currency: string | null; tableName: string | null; playedAt: string | null; smallBlind: number | null; bigBlind: number | null; ante: number | null; buttonSeat: number | null; heroCards: string[] | null; position: string | null; resultChips: number | null; boardCards: string[]; players: HandPlayer[]; actions: HandAction[]; rawText: string; rawTextHash: string; parserName: string; parserVersion: string; parseStatus: ParseStatus; warnings: string[] }
const nullableText = z.string().nullable()
const nullableInteger = z.number().int().nonnegative().nullable()
export const HandSchema = z.object({
  id: z.string().min(1), site: SiteSchema, sourceHandId: nullableText, tournamentId: nullableText,
  tournamentName: nullableText, buyInMinor: nullableInteger, feeMinor: nullableInteger, currency: nullableText,
  tableName: nullableText, playedAt: nullableText, smallBlind: nullableInteger, bigBlind: nullableInteger,
  ante: nullableInteger, buttonSeat: z.number().int().positive().nullable(), heroCards: z.array(z.string()).nullable(),
  position: nullableText, resultChips: nullableInteger, boardCards: z.array(z.string()),
  players: z.array(z.object({ name: z.string(), seat: z.number().int().positive(), position: nullableText, startingStack: nullableInteger, holeCards: z.array(z.string()).nullable(), shownCards: z.array(z.string()).nullable(), isHero: z.boolean() })),
  actions: z.array(z.object({ sequence: z.number().int().nonnegative(), street: z.enum(['preflop', 'flop', 'turn', 'river', 'showdown', 'other']), player: nullableText, actionType: z.enum(['fold', 'check', 'call', 'bet', 'raise', 'post_blind', 'post_ante', 'collect', 'show', 'other']), amount: nullableInteger, amountTo: nullableInteger, sourceText: z.string() })),
  rawText: z.string(), rawTextHash: z.string(), parserName: z.string().min(1), parserVersion: z.string().min(1),
  parseStatus: z.enum(['complete', 'partial', 'failed']), warnings: z.array(z.string()),
}) satisfies z.ZodType<Hand>
export type ParseResult = { site: Site; parserName: string; parserVersion: string; hands: Hand[]; diagnostics: ImportDiagnostic[]; unsupported: boolean; failedCount: number }

const parserVersion = '1.1.0'
const handStart = /^#Game No\s*:\s*(\d+)\s*$/m
const money = (value: string | undefined): number | null => value == null ? null : Number(value.replaceAll(',', ''))
const cards = (value: string): string[] => value.split(',').map((card) => card.trim()).filter(Boolean)
const actionPattern = /^(.+?) (posts ante|posts small blind|posts big blind|folds|checks|calls|bets|raises|collected|shows|mucks|did not show his hand)(?: \[([^\]]+)\])?$/

function toMinorUnits(value: string | undefined): number | null {
  if (!value) return null
  const normalized = value.replaceAll(',', '')
  const parts = normalized.split('.')
  if (parts.length > 2 || (parts[1]?.length ?? 0) > 2 || !/^\d+$/.test(parts[0])) return null
  const cents = Number(`${parts[0]}${(parts[1] ?? '').padEnd(2, '0')}`)
  return Number.isSafeInteger(cents) ? cents : null
}

function fileTournamentMetadata(fileName: string | undefined) {
  if (!fileName) return { tournamentName: null, buyInMinor: null, feeMinor: null, currency: null }
  const baseName = fileName.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, '') ?? fileName
  const match = baseName.match(/Tournament\s+([$€£])\s*([\d,]+(?:\.\d{1,2})?)\s*\+\s*([$€£])?\s*([\d,]+(?:\.\d{1,2})?)\s+(.+?)\s+\((\d+)\)\s+.+$/i)
  if (!match) return { tournamentName: null, buyInMinor: null, feeMinor: null, currency: null }
  return { tournamentName: match[5].trim(), buyInMinor: toMinorUnits(match[2]), feeMinor: toMinorUnits(match[4]), currency: match[3] && match[3] !== match[1] ? null : match[1] }
}

function positionBySeat(players: HandPlayer[], buttonSeat: number | null): Map<number, string> {
  const positions = new Map<number, string>()
  if (buttonSeat === null || !players.some(player => player.seat === buttonSeat) || players.length < 2) return positions
  const sortedSeats = [...players].map(player => player.seat).sort((a, b) => a - b)
  const buttonIndex = sortedSeats.indexOf(buttonSeat)
  const clockwise = [...sortedSeats.slice(buttonIndex), ...sortedSeats.slice(0, buttonIndex)]
  if (clockwise.length === 2) {
    positions.set(clockwise[0], 'BTN/SB')
    positions.set(clockwise[1], 'BB')
    return positions
  }
  const labelsByPlayerCount: Record<number, string[]> = {
    3: ['BTN', 'SB', 'BB'],
    4: ['BTN', 'SB', 'BB', 'UTG'],
    5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
    6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
    7: ['BTN', 'SB', 'BB', 'UTG', 'MP', 'HJ', 'CO'],
    8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'LJ', 'HJ', 'CO'],
  }
  const labels = labelsByPlayerCount[clockwise.length]
  if (labels) clockwise.forEach((seat, index) => positions.set(seat, labels[index]))
  return positions
}

function parse888Hand(raw: string, lineOffset: number, fileMetadata: ReturnType<typeof fileTournamentMetadata>): { hand?: Hand; diagnostics: ImportDiagnostic[] } {
  const diagnostics: ImportDiagnostic[] = []
  const lines = raw.split(/\r?\n/)
  const fail = (message: string): { hand?: Hand; diagnostics: ImportDiagnostic[] } => ({ diagnostics: [{ severity: 'error', message, line: lineOffset }] })
  const game = raw.match(/^\*{5} 888poker (?:BLAST )?Hand History for Game (\d+) \*{5}$/m)
  const idLine = lines.find((line) => handStart.test(line))?.match(handStart)?.[1]
  if (!game || !idLine || game[1] !== idLine) return fail('Missing or inconsistent 888poker hand ID/header; this block was not imported.')
  if (!/^[\d,]+\/[\d,]+ Blinds No Limit Holdem - \*{3} \d{2} \d{2} \d{4} \d{2}:\d{2}:\d{2}$/m.test(raw)) return fail('Unrecognized 888poker game header; this block was not imported.')
  const blindMatch = lines[2]?.match(/^([\d,]+)\/([\d,]+) Blinds (.+?) - \*{3} (\d{2}) (\d{2}) (\d{4}) (\d{2}:\d{2}:\d{2})$/)
  const tournamentLine = lines.find((line) => /^Tournament #/.test(line))
  const tournamentId = tournamentLine?.match(/^Tournament #(\d+)/)?.[1] ?? null
  const tableMatch = tournamentLine?.match(/- Table #([^ ]+)/)
  const priceMatch = tournamentLine?.match(/Tournament #\d+\s+([$€£])\s*([\d,]+(?:\.\d{1,2})?)\s*\+\s*([$€£])?\s*([\d,]+(?:\.\d{1,2})?)/)
  const headerCurrency = priceMatch && priceMatch[3] && priceMatch[1] !== priceMatch[3] ? null : priceMatch?.[1] ?? null
  const buyInMinor = priceMatch ? toMinorUnits(priceMatch[2]) : fileMetadata.buyInMinor
  const feeMinor = priceMatch ? toMinorUnits(priceMatch[4]) : fileMetadata.feeMinor
  const currency = headerCurrency ?? fileMetadata.currency
  const seats = new Map<string, HandPlayer>()
  for (const line of lines) {
    const seat = line.match(/^Seat (\d+): (.+?) \(\s*([\d,]+)\s*\)$/)
    if (seat) seats.set(seat[2], { name: seat[2], seat: Number(seat[1]), position: null, startingStack: money(seat[3]), holeCards: null, shownCards: null, isHero: false })
  }
  if (seats.size === 0) diagnostics.push({ severity: 'warning', message: 'No seat and starting-stack rows were found.', line: lineOffset })
  const heroLine = lines.find((line) => /^Dealt to /.test(line))
  const heroMatch = heroLine?.match(/^Dealt to (.+?) \[ ([^\]]+) \]$/)
  if (heroLine && !heroMatch) diagnostics.push({ severity: 'warning', message: 'The dealt-to cards could not be read.', line: lineOffset + lines.indexOf(heroLine) })
  const heroName = heroMatch?.[1] ?? null
  if (heroName && seats.has(heroName)) seats.get(heroName)!.isHero = true
  const heroCards = heroMatch ? cards(heroMatch[2]) : null
  const boardCards: string[] = []
  const actions: HandAction[] = []
  let street: Street = 'preflop'
  let ante: number | null = null
  let resultChips: number | null = null
  const buttonSeat = Number(lines.find((line) => / is the button$/.test(line))?.match(/^Seat (\d+)/)?.[1] ?? NaN)
  const parsedButtonSeat = Number.isNaN(buttonSeat) ? null : buttonSeat
  const positions = positionBySeat([...seats.values()], parsedButtonSeat)
  for (const player of seats.values()) player.position = positions.get(player.seat) ?? null
  const heroPosition = heroName ? seats.get(heroName)?.position ?? null : null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const deal = line.match(/^\*\* Dealing (flop|turn|river) \*\* \[ ([^\]]+) \]$/)
    if (deal) { street = deal[1] as Street; boardCards.push(...cards(deal[2])); continue }
    if (!line || line.startsWith('#Game') || line.startsWith('*****') || / Blinds No Limit Holdem /.test(line) || line.startsWith('Tournament #') || line.includes('is the button') || line.startsWith('Total number of players') || line.startsWith('Seat ') || line === '** Dealing down cards **' || line === '** First runout **' || line === '** Summary **') continue
    if (line.startsWith('Dealt to ')) continue
    if (line.startsWith('First runout ')) {
      const collect = line.match(/^First runout (.+?) collected \[ ([\d,]+) \]$/)
      if (collect) {
        actions.push({ sequence: actions.length, street: 'showdown', player: collect[1], actionType: 'collect', amount: money(collect[2]), amountTo: null, sourceText: line })
        if (collect[1] === heroName) resultChips = money(collect[2])
      } else diagnostics.push({ severity: 'warning', message: 'Unrecognized runout summary line.', line: lineOffset + i })
      continue
    }
    const action = line.match(actionPattern)
    if (!action) {
      diagnostics.push({ severity: 'warning', message: 'Unrecognized line in hand block; it was retained in the source text.', line: lineOffset + i })
      continue
    }
    const [, player, verb, rawAmount] = action
    if (!seats.has(player)) diagnostics.push({ severity: 'warning', message: 'An action refers to a player missing from the seat list.', line: lineOffset + i })
    let actionType: ActionType
    if (verb === 'posts ante') { actionType = 'post_ante'; ante = money(rawAmount) }
    else if (verb === 'posts small blind' || verb === 'posts big blind') actionType = 'post_blind'
    else if (verb === 'did not show his hand' || verb === 'mucks') actionType = 'show'
    else if (verb === 'shows') actionType = 'show'
    else if (verb === 'collected') actionType = 'collect'
    else actionType = verb.replace(/s$/, '') as ActionType
    const shownCards = (verb === 'shows' || verb === 'mucks') && rawAmount ? cards(rawAmount) : null
    if (shownCards?.length && seats.has(player)) seats.get(player)!.shownCards = shownCards
    const numeric = verb === 'shows' || verb === 'mucks' || verb === 'did not show his hand' ? null : money(rawAmount)
    actions.push({ sequence: actions.length, street: street === 'preflop' && (actionType === 'collect' || actionType === 'show') ? 'showdown' : street, player, actionType, amount: numeric, amountTo: actionType === 'raise' ? numeric : null, sourceText: line })
    if (verb === 'collected' && player === heroName) resultChips = numeric
  }
  if (!heroCards) diagnostics.push({ severity: 'warning', message: 'Hero cards were not present in this hand.', line: lineOffset })
  const warnings = diagnostics.map((d) => d.message)
  const playedAt = blindMatch ? `${blindMatch[6]}-${blindMatch[5]}-${blindMatch[4]}T${blindMatch[7]}` : null
  return { diagnostics, hand: { id: `888poker:${game[1]}`, site: '888poker', sourceHandId: game[1], tournamentId, tournamentName: fileMetadata.tournamentName, buyInMinor, feeMinor, currency, tableName: tableMatch ? `Table #${tableMatch[1]}` : null, playedAt, smallBlind: blindMatch ? Number(blindMatch[1].replaceAll(',', '')) : null, bigBlind: blindMatch ? Number(blindMatch[2].replaceAll(',', '')) : null, ante, buttonSeat: parsedButtonSeat, heroCards, position: heroPosition, resultChips, boardCards, players: [...seats.values()], actions, rawText: raw, rawTextHash: '', parserName: '888poker', parserVersion, parseStatus: diagnostics.length ? 'partial' : 'complete', warnings } }
}

export async function parseFile(text: string, site: Site, fileName?: string): Promise<ParseResult> {
  if (site === 'sky_poker') return { site, parserName: 'sky-poker', parserVersion: '0.0.0', hands: [], diagnostics: [{ severity: 'warning', message: 'Sky Poker format is not confirmed. No hands were imported.' }], unsupported: true, failedCount: 0 }
  if (!text.trim()) return { site, parserName: '888poker', parserVersion, hands: [], diagnostics: [{ severity: 'error', message: 'The selected file is empty.' }], unsupported: false, failedCount: 0 }
  const starts = [...text.matchAll(/^#Game No\s*:\s*\d+\s*$/gm)]
  if (!starts.length) return { site, parserName: '888poker', parserVersion, hands: [], diagnostics: [{ severity: 'error', message: 'No 888poker hand boundaries were found. Check that this is a supported hand-history file.' }], unsupported: true, failedCount: 0 }
  const hands: Hand[] = []
  const fileMetadata = fileTournamentMetadata(fileName)
  const diagnostics: ImportDiagnostic[] = []
  let failedCount = 0
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index ?? 0
    const end = starts[i + 1]?.index ?? text.length
    const raw = text.slice(start, end).trim()
    const lineOffset = text.slice(0, start).split(/\r?\n/).length
    const parsed = parse888Hand(raw, lineOffset, fileMetadata)
    diagnostics.push(...parsed.diagnostics)
    if (parsed.hand) hands.push(parsed.hand)
    else failedCount++
  }
  for (const hand of hands) hand.rawTextHash = await hashText(hand.rawText)
  return { site, parserName: '888poker', parserVersion, hands, diagnostics, unsupported: false, failedCount }
}

export async function hashText(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((v) => v.toString(16).padStart(2, '0')).join('')
}
