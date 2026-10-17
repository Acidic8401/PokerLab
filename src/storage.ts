import { HandSchema, type Hand } from './domain'
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
    const request = indexedDB.open(DB_NAME, 2)
    request.onupgradeneeded = (event) => {
      const db = request.result
      const tx = request.transaction!
      const store = db.objectStoreNames.contains(STORE) ? tx.objectStore(STORE) : db.createObjectStore(STORE, { keyPath: 'id' })
      if (!store.indexNames.contains('importKey')) store.createIndex('importKey', 'importKey', { unique: true })
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
    await db.execute('DELETE FROM hands')
    return
  }
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).clear()
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}
export async function saveHands(hands: Hand[]): Promise<{ imported: number; duplicates: number }> {
  const invalid = hands.find((hand) => !HandSchema.safeParse(hand).success)
  if (invalid) throw new Error(`Hand ${invalid.id || '(unknown)'} failed local data validation and was not saved.`)
  if (isDesktopRuntime()) {
    const db = await getDesktopDb()
    await db.execute('BEGIN IMMEDIATE')
    try {
    const existing = await db.select<{ id: string; import_key: string }[]>('SELECT id, import_key FROM hands')
    const keys = new Set(existing.map(row => row.import_key))
    const ids = new Set(existing.map(row => row.id))
    let imported = 0
    let duplicates = 0
    for (const hand of hands) {
      const importKey = handImportKey(hand)
      if (keys.has(importKey)) { duplicates++; continue }
      if (ids.has(hand.id)) throw new Error(`Hand ID collision for ${hand.id}; no hands from this batch were saved.`)
      await db.execute('INSERT INTO hands (id, import_key, played_at, payload) VALUES ($1, $2, $3, $4)', [hand.id, importKey, hand.playedAt, JSON.stringify(hand)])
      keys.add(importKey)
      ids.add(hand.id)
      imported++
    }
    await db.execute('COMMIT')
    return { imported, duplicates }
    } catch (error) {
      try { await db.execute('ROLLBACK') } catch { /* Preserve the original storage error. */ }
      throw error
    }
  }
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  const existingReq = store.getAll()
  let added = 0
  let duplicates = 0
  let failed = false
  existingReq.onsuccess = () => {
    const keys = new Set((existingReq.result as StoredHand[]).map(hand => hand.importKey ?? handImportKey(hand)))
    for (const hand of hands) {
      const key = handImportKey(hand)
      if (keys.has(key)) { duplicates++; continue }
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
