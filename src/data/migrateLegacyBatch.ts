// ONE-TIME migration: moves batches from the old location
// (migration/batches/entries/{oldId}, old id format batch-{fileId}-{month})
// to the current one (migration/data/batches/{newId}, new id format
// batch-{department}-{hq}-{month}-{driveFileId}), copying the rows
// subcollection and deleting the legacy docs afterward.
//
// Safe to run more than once — it no-ops once the legacy collection is empty.
// Delete this file (and its call site) once run successfully in production.

import { collection, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Batch, MigrationRow } from '../types'
import { slugify } from './slug'

export async function migrateLegacyBatchesOnce(onProgress?: (line: string) => void): Promise<string[]> {
  const log: string[] = []
  const push = (line: string) => {
    log.push(line)
    onProgress?.(line)
  }

  const legacyCol = collection(db, 'migration', 'batches', 'entries')
  push('Reading migration/batches/entries…')
  const legacySnap = await getDocs(legacyCol)

  if (legacySnap.empty) {
    push('No legacy batches found — nothing to do.')
    return log
  }
  push(`Found ${legacySnap.docs.length} legacy batch(es).`)

  for (const legacyDoc of legacySnap.docs) {
    const batch = legacyDoc.data() as Batch
    const oldId = legacyDoc.id
    const newId = [
      'batch',
      slugify(batch.department),
      batch.hq ? slugify(batch.hq) : null,
      batch.month,
      batch.driveFileId,
    ]
      .filter(Boolean)
      .join('-')

    push(`${oldId} → ${newId}`)

    push('  reading rows…')
    const legacyRowsSnap = await getDocs(collection(legacyCol, oldId, 'rows'))
    const rows = legacyRowsSnap.docs.map((d) => d.data() as MigrationRow)
    push(`  found ${rows.length} row(s)`)

    await setDoc(doc(db, 'migration', 'data', 'batches', newId), { ...batch, id: newId })
    for (let i = 0; i < rows.length; i += 450) {
      const chunk = rows.slice(i, i + 450)
      const wb = writeBatch(db)
      for (const row of chunk) {
        wb.set(doc(db, 'migration', 'data', 'batches', newId, 'rows', row.id), row)
      }
      await wb.commit()
      push(`  wrote rows ${i + 1}-${i + chunk.length}/${rows.length}`)
    }
    push(`  wrote batch + ${rows.length} row(s) to migration/data/batches/${newId}`)

    // batched deletes (450/op) instead of one deleteDoc per row
    for (let i = 0; i < legacyRowsSnap.docs.length; i += 450) {
      const chunk = legacyRowsSnap.docs.slice(i, i + 450)
      const wb = writeBatch(db)
      for (const rowDoc of chunk) wb.delete(rowDoc.ref)
      await wb.commit()
      push(`  deleted legacy rows ${i + 1}-${i + chunk.length}/${legacyRowsSnap.docs.length}`)
    }
    const finalWb = writeBatch(db)
    finalWb.delete(legacyDoc.ref)
    await finalWb.commit()
    push(`  deleted legacy migration/batches/entries/${oldId}`)
  }

  push('Done.')
  return log
}
