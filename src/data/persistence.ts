// Persistence adapter: Firestore-backed. All reads/writes go through here so
// components never talk to Firestore directly.
//
// Everything lives under one top-level "migration" collection so this app
// doesn't sprawl across netstar's shared Firestore namespace:
//   migration/secrets                    — ERPNext credentials (admin-only)
//   migration/config                     — secondary-Ecubix parsing config
//   migration/mapping/secondary/{id}      — Ecubix-value → ERP-value mappings (see MasterMapEntry)
//   migration/mapping/regex/{id}          — regex → ERP-value overrides for Product master data (see RegexMapEntry)
//   migration/data/batches/{batchId} (+ rows subcollection)

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore/lite'
import { db } from '../lib/firebase'
import type {
  Batch,
  Credentials,
  MasterMapEntry,
  MigrationRow,
  RegexMapEntry,
  SecondaryConfig,
  UserPrefs,
} from '../types'
import { DEFAULT_PREFS, EMPTY_CREDENTIALS, EMPTY_SECONDARY_CONFIG, normalizeHeaderMap } from './defaults'

export interface Snapshot {
  credentials: Credentials
  secondaryConfig: SecondaryConfig
  masterMap: MasterMapEntry[]
  regexMap: RegexMapEntry[]
  batches: Batch[]
  prefs: UserPrefs
}

export interface Persistence {
  loadAll(uid: string): Promise<Snapshot>
  saveCredentials(c: Credentials): Promise<void>
  saveSecondaryConfig(c: SecondaryConfig): Promise<void>
  saveMasterMapEntry(e: MasterMapEntry): Promise<void>
  deleteMasterMapEntry(id: string): Promise<void>
  saveRegexMapEntry(e: RegexMapEntry): Promise<void>
  deleteRegexMapEntry(id: string): Promise<void>
  saveBatch(b: Batch): Promise<void>
  saveRows(batchId: string, rows: MigrationRow[]): Promise<void>
  loadRows(batchId: string): Promise<MigrationRow[]>
  savePrefs(uid: string, p: UserPrefs): Promise<void>
}

const secondaryMappingEntries = () => collection(db, 'migration', 'mapping', 'secondary')
const regexMappingEntries = () => collection(db, 'migration', 'mapping', 'regex')
const batchesCol = () => collection(db, 'migration', 'data', 'batches')

export const persistence: Persistence = {
  async loadAll(uid) {
    const [credSnap, cfgSnap, masterMapSnap, regexMapSnap, batchesSnap, userSnap] = await Promise.all([
      getDoc(doc(db, 'migration', 'secrets')).catch(() => null), // non-admins may lack access
      getDoc(doc(db, 'migration', 'config')),
      getDocs(secondaryMappingEntries()),
      getDocs(regexMappingEntries()),
      getDocs(batchesCol()),
      getDoc(doc(db, 'users', uid)),
    ])
    return {
      credentials: (credSnap?.data() as Credentials | undefined) ?? EMPTY_CREDENTIALS,
      secondaryConfig: (() => {
        const loaded = (cfgSnap.data() as SecondaryConfig | undefined) ?? EMPTY_SECONDARY_CONFIG
        return { ...loaded, headerMap: normalizeHeaderMap(loaded.headerMap) }
      })(),
      masterMap: masterMapSnap.docs.map((d) => d.data() as MasterMapEntry),
      regexMap: regexMapSnap.docs.map((d) => d.data() as RegexMapEntry),
      batches: batchesSnap.docs
        .map((d) => d.data() as Batch)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      prefs: ((userSnap.data() as { tweaks?: UserPrefs } | undefined)?.tweaks) ?? DEFAULT_PREFS,
    }
  },
  saveCredentials: (c) => setDoc(doc(db, 'migration', 'secrets'), c),
  saveSecondaryConfig: (c) => setDoc(doc(db, 'migration', 'config'), c),
  saveMasterMapEntry: (e) => setDoc(doc(secondaryMappingEntries(), e.id), e),
  deleteMasterMapEntry: (id) => deleteDoc(doc(secondaryMappingEntries(), id)),
  saveRegexMapEntry: (e) => setDoc(doc(regexMappingEntries(), e.id), e),
  deleteRegexMapEntry: (id) => deleteDoc(doc(regexMappingEntries(), id)),
  saveBatch: (b) => setDoc(doc(batchesCol(), b.id), b),
  async saveRows(batchId, rows) {
    // Firestore batched writes cap at 500 ops.
    for (let i = 0; i < rows.length; i += 450) {
      const chunk = rows.slice(i, i + 450)
      const wb = writeBatch(db)
      for (const row of chunk) {
        wb.set(doc(batchesCol(), batchId, 'rows', row.id), row)
      }
      await wb.commit()
    }
  },
  async loadRows(batchId) {
    const snap = await getDocs(collection(batchesCol(), batchId, 'rows'))
    return snap.docs.map((d) => d.data() as MigrationRow).sort((a, b) => a.rowIndex - b.rowIndex)
  },
  savePrefs: (uid, p) => setDoc(doc(db, 'users', uid), { tweaks: p }, { merge: true }),
}
