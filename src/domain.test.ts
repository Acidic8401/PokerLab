import { describe, expect, it } from 'vitest'
import { parseFile } from './domain'
import { handImportKey } from './storage'
import fixture from '../fixtures/888poker/tournament-two-hands.txt?raw'
import blastFixture from '../fixtures/888poker/blast-one-hand.txt?raw'

describe('888poker adapter', () => {
  it('parses two hands from the confirmed tournament format and preserves action order', async () => {
    const result = await parseFile(fixture, '888poker')
    expect(result.unsupported).toBe(false)
    expect(result.hands).toHaveLength(2)
    expect(result.hands[0].sourceHandId).toBe('789023403')
    expect(result.hands[0].tournamentId).toBe('296544341')
    expect(result.hands[0].playedAt).toBe('2026-10-04T03:00:46')
    expect(result.hands[0].heroCards).toEqual(['Td', '3h'])
    expect(result.hands[0].boardCards).toEqual(['3c', 'Qh', '8s', '5s', 'As'])
    expect(result.hands[0].actions.map(a => a.actionType)).toContain('collect')
    expect(result.hands[0].actions.every(a => a.amount === null || Number.isInteger(a.amount))).toBe(true)
    expect(result.hands[0].rawTextHash).toMatch(/^[a-f0-9]{64}$/)
  })
  it('reports unknown action lines while retaining a parsed partial hand', async () => {
    const result = await parseFile(fixture.replace('Player1 folds', 'Player1 does a mystery action'), '888poker')
    expect(result.hands[0].parseStatus).toBe('partial')
    expect(result.diagnostics.some(d => d.message.includes('Unrecognized line'))).toBe(true)
  })
  it('reports malformed hand blocks without treating them as valid', async () => {
    const result = await parseFile('#Game No : 123\nnot an 888 hand block', '888poker')
    expect(result.hands).toHaveLength(0)
    expect(result.failedCount).toBe(1)
    expect(result.diagnostics[0].severity).toBe('error')
  })
  it('parses the observed BLAST header variant', async () => {
    const result = await parseFile(blastFixture, '888poker')
    expect(result.hands).toHaveLength(1)
    expect(result.hands[0].sourceHandId).toBeTruthy()
    expect(result.hands[0].players).toHaveLength(3)
  })
  it('parses comma-grouped blind amounts as integer chips', async () => {
    const result = await parseFile(fixture.replace('20/40 Blinds', '1,200/2,400 Blinds'), '888poker')
    expect(result.hands[0].smallBlind).toBe(1200)
    expect(result.hands[0].bigBlind).toBe(2400)
  })
  it('handles CRLF and absent optional hole cards', async () => {
    const crlf = fixture.replace(/\r?\n/g, '\n').replaceAll('\n', '\r\n')
    const result = await parseFile(crlf.replace(/Dealt to [^\r\n]+\r\n/, ''), '888poker')
    expect(result.hands).toHaveLength(2)
    expect(result.hands[0].heroCards).toBeNull()
    expect(result.hands[0].warnings).toContain('Hero cards were not present in this hand.')
  })
})

describe('unsupported inputs', () => {
  it('keeps Sky Poker explicitly unsupported until a real sample is reviewed', async () => {
    const result = await parseFile('unrecognized hand history', 'sky_poker')
    expect(result.unsupported).toBe(true)
    expect(result.hands).toEqual([])
    expect(result.diagnostics[0].severity).toBe('warning')
  })
  it('reports an empty file as an error', async () => {
    expect((await parseFile(' \r\n ', '888poker')).diagnostics[0].severity).toBe('error')
  })
  it('rejects a non-hand text file instead of importing it', async () => {
    const result = await parseFile('just some notes', '888poker')
    expect(result.hands).toHaveLength(0)
    expect(result.unsupported).toBe(true)
  })
  it('creates an idempotency key from site plus source hand ID', async () => {
    const result = await parseFile(fixture, '888poker')
    expect(handImportKey(result.hands[0])).toBe('888poker:789023403')
    expect(handImportKey(result.hands[0])).not.toBe(handImportKey(result.hands[1]))
  })
})
