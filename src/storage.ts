import { HandSchema, type Hand, type HandTag } from './domain'
import type Database from '@tauri-apps/plugin-sql'

const DB_NAME = 'pokerlab-local'
const STORE = 'hands'
export const handImportKey = (hand: Hand): string => `${hand.site}:${hand.sourceHandId ?? hand.rawTextHash}`
type StoredHand = Hand & { importKey: string }

type SqlDatabase = Database
let desktopDb: Promise<SqlDatabase> | undefined
export const isDesktopRuntime = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
async function getDesktopDb(): Promise<SqlDatabase> {
  desktopDb ??= import('@tauri-apps/plugin-sql').then(({ default: Database }) => Database.load('sqlite:pokerlab.db') as Promise<SqlDatabase>)
  return desktopDb
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3)
    request.onupgradeneeded = (event) => {
      const db = request.result
      const tx = request.transaction!
      const store = db.objectStoreNames.contains(STORE) ? tx.objectStore(STORE) : db.createObjectStore(STORE, { keyPath: 'id' })
      if (!store.indexNames.contains('importKey')) store.createIndex('importKey', 'importKey', { unique: true })
      if (!db.objectStoreNames.contains('hand_tags')) db.createObjectStore('hand_tags', { keyPath: ['handId', 'name'] })
      if (event.oldVersion > 0 && event.oldVersion < 2) {
        const cursor = store.openCursor()
        cursor.onsuccess = () => {
          const item = cursor.result
          if (!item) return
          const hand = item.value as Hand
          item.update({ ...hand, importKey: handImportKey(hand) })
          item.continue()
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function getHands(): Promise<Hand[]> {
  if (isDesktopRuntime()) {
    const db = await getDesktopDb()
    const rows = await db.select<{ payload: string }[]>('SELECT payload FROM hands ORDER BY played_at DESC, id')
    return rows.map(row => JSON.parse(row.payload) as Hand)
  }
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll()
    req.onsuccess = () => resolve((req.result as StoredHand[]).map(({ importKey: _key, ...hand }) => hand))
    req.onerror = () => reject(req.error)
  })
}
export async function deleteAllHands(): Promise<void> {
  if (isDesktopRuntime()) {
    const db = await getDesktopDb()
    await db.execute('DELETE FROM hand_tags')
    await db.execute('DELETE FROM hands')
    return
  }
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, 'hand_tags'], 'readwrite')
    tx.objectStore(STORE).clear()
    tx.objectStore('hand_tags').clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getHandTags(): Promise<HandTag[]> {
  if (isDesktopRuntime()) {
    const db = await getDesktopDb()
    return db.select<HandTag[]>('SELECT hand_id as handId, name, color, created_at as createdAt FROM hand_tags ORDER BY created_at, name')
  }
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction('hand_tags').objectStore('hand_tags').getAll()
    req.onsuccess = () => resolve(req.result as HandTag[])
    req.onerror = () => reject(req.error)
  })
}

export async function saveHandTag(tag: HandTag): Promise<void> {
  const name = tag.name.trim()
  if (!name || name.length > 32 || !/^#[\da-f]{6}$/i.test(tag.color)) throw new Error('Use a tag name of 1–32 characters and a valid color.')
  const saved = { ...tag, name, color: tag.color.toLowerCase() }
  if (isDesktopRuntime()) {
    const db = await getDesktopDb()
    await db.execute('INSERT INTO hand_tags (hand_id, name, color, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT(hand_id, name) DO UPDATE SET color = excluded.color, created_at = excluded.created_at', [saved.handId, saved.name, saved.color, saved.createdAt])
    return
  }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('hand_tags', 'readwrite')
    tx.objectStore('hand_tags').put(saved)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function removeHandTag(handId: string, name: string): Promise<void> {
  if (isDesktopRuntime()) {
    const db = await getDesktopDb()
    await db.execute('DELETE FROM hand_tags WHERE hand_id = $1 AND name = $2', [handId, name])
    return
  }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('hand_tags', 'readwrite')
    tx.objectStore('hand_tags').delete([handId, name])
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
function fillMissingTournamentMetadata(existing: Hand, incoming: Hand): Hand {
  return {
    ...existing,
    tournamentName: existing.tournamentName ?? incoming.tournamentName,
    buyInMinor: existing.buyInMinor ?? incoming.buyInMinor,
    feeMinor: existing.feeMinor ?? incoming.feeMinor,
    currency: existing.currency ?? incoming.currency,
  }
}

export async function saveHands(hands: Hand[]): Promise<{ imported: number; duplicates: number }> {
  const invalid = hands.find((hand) => !HandSchema.safeParse(hand).success)
  if (invalid) throw new Error(`Hand ${invalid.id || '(unknown)'} failed local data validation and was not saved.`)
  if (isDesktopRuntime()) {
    const db = await getDesktopDb()
    const existing = await db.select<{ id: string; import_key: string; payload: string }[]>('SELECT id, import_key, payload FROM hands')
    const existingByKey = new Map(existing.map(row => [row.import_key, row]))
    const keys = new Set(existingByKey.keys())
    const ids = new Set(existing.map(row => row.id))
    let imported = 0
    let duplicates = 0
    const pending: Hand[] = []
    const metadataUpdates: { importKey: string; payload: string }[] = []
    for (const hand of hands) {
      const importKey = handImportKey(hand)
      if (keys.has(importKey)) {
        duplicates++
        const row = existingByKey.get(importKey)
        if (row) {
          const oldHand = JSON.parse(row.payload) as Hand
          const merged = fillMissingTournamentMetadata(oldHand, hand)
          if (merged.tournamentName !== oldHand.tournamentName || merged.buyInMinor !== oldHand.buyInMinor || merged.feeMinor !== oldHand.feeMinor || merged.currency !== oldHand.currency) metadataUpdates.push({ importKey, payload: JSON.stringify(merged) })
        }
        continue
      }
      if (ids.has(hand.id)) throw new Error(`Hand ID collision for ${hand.id}; no hands from this batch were saved.`)
      keys.add(importKey)
      ids.add(hand.id)
      pending.push(hand)
    }

    for (let offset = 0; offset < metadataUpdates.length; offset += 100) {
      const batch = metadataUpdates.slice(offset, offset + 100)
      const values: unknown[] = []
      const cases = batch.map(({ importKey, payload }) => {
        values.push(importKey, payload)
        const keyParam = values.length - 1
        const payloadParam = values.length
        return `WHEN $${keyParam} THEN $${payloadParam}`
      })
      const keysSql = batch.map((_, index) => `$${index * 2 + 1}`).join(', ')
      await db.execute(`UPDATE hands SET payload = CASE import_key ${cases.join(' ')} ELSE payload END WHERE import_key IN (${keysSql})`, values)
    }

    // Each Tauri SQL call can use a different pooled SQLite connection. Keeping a
    // BEGIN/COMMIT transaction open across separate IPC calls can strand a write
    // lock on the pool, so insert each bounded batch with one atomic statement.
    for (let offset = 0; offset < pending.length; offset += 200) {
      const batch = pending.slice(offset, offset + 200)
      const values: unknown[] = []
      const rows = batch.map(hand => {
        const importKey = handImportKey(hand)
        values.push(hand.id, importKey, hand.playedAt, JSON.stringify(hand))
        const first = values.length - 3
        return `($${first}, $${first + 1}, $${first + 2}, $${first + 3})`
      })
      const query = `INSERT INTO hands (id, import_key, played_at, payload) VALUES ${rows.join(', ')} ON CONFLICT(import_key) DO NOTHING`
      let result: Awaited<ReturnType<typeof db.execute>> | undefined
      for (let attempt = 0; ; attempt++) {
        try {
          result = await db.execute(query, values)
          break
        } catch (error) {
          const message = String(error).toLowerCase()
          const isLocked = message.includes('database is locked') || message.includes('sqlite_busy') || message.includes('code: 5')
          if (!isLocked || attempt >= 4) throw error
          await new Promise(resolve => window.setTimeout(resolve, 120 * (2 ** attempt)))
        }
      }
      imported += result.rowsAffected
      duplicates += batch.length - result.rowsAffected
    }
    return { imported, duplicates }
  }
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  const existingReq = store.getAll()
  let added = 0
  let duplicates = 0
  let failed = false
  existingReq.onsuccess = () => {
    const existing = existingReq.result as StoredHand[]
    const byKey = new Map(existing.map(hand => [hand.importKey ?? handImportKey(hand), hand]))
    const keys = new Set(byKey.keys())
    for (const hand of hands) {
      const key = handImportKey(hand)
      if (keys.has(key)) {
        duplicates++
        const oldHand = byKey.get(key)
        if (oldHand) store.put({ ...fillMissingTournamentMetadata(oldHand, hand), importKey: key } satisfies StoredHand)
        continue
      }
      keys.add(key)
      store.put({ ...hand, importKey: key } satisfies StoredHand)
      added++
    }
  }
  existingReq.onerror = () => { failed = true; tx.abort() }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => failed ? reject(new Error('Could not read existing local hands.')) : resolve({ imported: added, duplicates })
    tx.onerror = () => reject(tx.error)
  })
}
