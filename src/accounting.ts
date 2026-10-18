import type { Hand, HandAction } from './domain'

export type ActionAccounting = {
  potAfter: number
  contribution: number
  returnedBeforeAction: number
  actorStackAfter: number | null
  playerStacks: Record<string, number | null>
}

export type HandAccounting = {
  actions: ActionAccounting[]
  heroNetChips: number | null
  playerNetChips: Record<string, number> | null
  complete: boolean
}

type PlayerState = { stack: number | null; contributed: number; streetContributed: number; collected: number }

function chipContribution(action: HandAction, streetContributed: number): number | null {
  if (action.actionType === 'post_ante' || action.actionType === 'post_blind' || action.actionType === 'call' || action.actionType === 'bet') {
    return action.amount
  }
  if (action.actionType === 'raise') {
    const raiseTo = action.amountTo ?? action.amount
    return raiseTo === null ? null : Math.max(0, raiseTo - streetContributed)
  }
  return 0
}

export function deriveHandAccounting(hand: Hand): HandAccounting {
  const states = new Map<string, PlayerState>()
  for (const player of hand.players) states.set(player.name, { stack: player.startingStack ?? null, contributed: 0, streetContributed: 0, collected: 0 })
  let totalContributed = 0
  let totalCollected = 0
  let currentStreet = 'preflop'
  let complete = hand.actions.length > 0

  for (const action of hand.actions) {
    if (['preflop', 'flop', 'turn', 'river'].includes(action.street) && action.street !== currentStreet) {
      currentStreet = action.street
      for (const state of states.values()) state.streetContributed = 0
    }
    if (action.actionType === 'other' || !action.player) { complete = false; continue }
    const state = states.get(action.player) ?? { stack: null, contributed: 0, streetContributed: 0, collected: 0 }
    states.set(action.player, state)
    if (action.actionType === 'collect') {
      if (action.amount === null) complete = false
      else { state.collected += action.amount; totalCollected += action.amount }
      continue
    }
    const amount = chipContribution(action, state.streetContributed)
    if (amount === null) { complete = false; continue }
    const actual = state.stack === null ? amount : Math.min(amount, Math.max(0, state.stack))
    state.stack = state.stack === null ? null : state.stack - actual
    state.contributed += actual
    totalContributed += actual
    if (action.street !== 'showdown' && action.street !== 'other' && action.actionType !== 'post_ante') {
      state.streetContributed += actual
    }
  }

  let refund = 0
  let refundPlayer: string | null = null
  if (totalCollected > totalContributed) complete = false
  if (totalCollected > 0 && totalContributed > totalCollected) {
    refund = totalContributed - totalCollected
    const commitments = [...states.entries()].map(([name, state]) => [name, state.streetContributed] as const).sort((a, b) => b[1] - a[1])
    const unmatched = commitments.length ? commitments[0][1] - (commitments[1]?.[1] ?? 0) : 0
    if (unmatched >= refund && commitments[0]) refundPlayer = commitments[0][0]
    else complete = false
  }
  if (totalCollected === 0) complete = false
  if (hand.warnings.some(warning => warning.includes('Unrecognized line') || warning.includes('missing from the seat list'))) complete = false

  let pot = 0
  let refundApplied = false
  const snapshotStates = new Map<string, PlayerState>()
  for (const player of hand.players) snapshotStates.set(player.name, { stack: player.startingStack ?? null, contributed: 0, streetContributed: 0, collected: 0 })
  currentStreet = 'preflop'
  const snapshots = hand.actions.map((action): ActionAccounting => {
    let contribution = 0
    let returnedBeforeAction = 0
    if (['preflop', 'flop', 'turn', 'river'].includes(action.street) && action.street !== currentStreet) {
      currentStreet = action.street
      for (const state of snapshotStates.values()) state.streetContributed = 0
    }
    let state = action.player ? snapshotStates.get(action.player) : undefined
    if (action.player && !state) {
      state = { stack: null, contributed: 0, streetContributed: 0, collected: 0 }
      snapshotStates.set(action.player, state)
    }
    if (action.actionType === 'collect') {
      if (!refundApplied && refund > 0 && refundPlayer) {
        returnedBeforeAction = refund
        pot = Math.max(0, pot - refund)
        const refundedState = snapshotStates.get(refundPlayer)
        if (refundedState?.stack !== null && refundedState?.stack !== undefined) refundedState.stack += refund
        refundApplied = true
      }
      if (action.amount !== null) {
        pot = Math.max(0, pot - action.amount)
        if (state?.stack !== null && state?.stack !== undefined) { state.stack += action.amount; state.collected += action.amount }
      }
    } else if (state) {
      const amount = chipContribution(action, state.streetContributed)
      if (amount !== null && amount > 0) {
        contribution = state.stack === null ? amount : Math.min(amount, Math.max(0, state.stack))
        state.stack = state.stack === null ? null : state.stack - contribution
        state.streetContributed += action.actionType === 'post_ante' ? 0 : contribution
        pot += contribution
      }
    }
    return { potAfter: pot, contribution, returnedBeforeAction, actorStackAfter: state?.stack ?? null, playerStacks: Object.fromEntries([...snapshotStates.entries()].map(([name, playerState]) => [name, playerState.stack])) }
  })

  if (refund > 0 && !refundApplied && refundPlayer) {
    const last = snapshots.at(-1)
    if (last) { last.returnedBeforeAction = refund; last.potAfter = Math.max(0, last.potAfter - refund) }
    const state = snapshotStates.get(refundPlayer)
    if (state?.stack !== null && state?.stack !== undefined) state.stack += refund
  }

  const net = Object.fromEntries([...states.entries()].map(([name, state]) => [name, state.collected - state.contributed + (refundPlayer === name ? refund : 0)]))
  return { actions: snapshots, heroNetChips: complete ? (hand.players.find(player => player.isHero) ? net[hand.players.find(player => player.isHero)!.name] ?? null : null) : null, playerNetChips: complete ? net : null, complete }
}
