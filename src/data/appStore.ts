import { create } from 'zustand'
import type {
  Batch,
  Credentials,
  CustomerProfile,
  MasterMapEntry,
  MigrationRow,
  RegexMapEntry,
  SecondaryConfig,
  UserPrefs,
} from '../types'
import { countRows, validateRow, type ValidationContext } from '../engine/validateRow'
import { DEFAULT_PREFS, EMPTY_CREDENTIALS, EMPTY_SECONDARY_CONFIG } from './defaults'
import { persistence } from './persistence'

interface AppState {
  loaded: boolean
  uid: string
  credentials: Credentials
  secondaryConfig: SecondaryConfig
  masterMap: MasterMapEntry[]
  regexMap: RegexMapEntry[]
  batches: Batch[]
  prefs: UserPrefs
  /** rows of the currently open batch */
  activeBatchId: string | null
  rows: MigrationRow[]
  /** ERP snapshot used by validation (empty before fetch) */
  erpItemsIndex: Map<string, string>
  erpCustomersIndex: Map<string, string>
  erpExisting: ValidationContext['erpExisting']
  customerProfiles: Map<string, CustomerProfile[]>

  loadAll(uid: string): Promise<void>
  saveCredentials(c: Credentials): Promise<void>
  saveSecondaryConfig(c: SecondaryConfig): Promise<void>
  upsertMasterMap(e: MasterMapEntry): Promise<void>
  removeMasterMap(id: string): Promise<void>
  /** Confirm a fuzzy (or overridden) master-data match — upserts the global mapping, keyed by field + normalized Ecubix value, so every future batch reuses it. */
  confirmMasterMatch(
    field: string,
    ecubixValue: string,
    erpValue: string,
    source?: MasterMapEntry['source'],
    comment?: string,
  ): Promise<void>
  upsertRegexMap(e: RegexMapEntry): Promise<void>
  removeRegexMap(id: string): Promise<void>
  savePrefs(p: UserPrefs): Promise<void>
  saveBatch(b: Batch): Promise<void>
  openBatch(batchId: string): Promise<void>
  closeBatch(): void
  setErpSnapshot(
    items: Map<string, string>,
    customers: Map<string, string>,
    existing: ValidationContext['erpExisting'],
    customerProfiles: Map<string, CustomerProfile[]>,
  ): void
  /** Replace rows (parse) or patch a subset (fixes), persist, and refresh counts. */
  putRows(batchId: string, rows: MigrationRow[], replace?: boolean): Promise<void>
  /** Re-run validation over active rows after mappings changed. */
  revalidate(): Promise<void>
}

/** Group flat MasterMapEntry rows into the field → ecubixValue → erpValue lookup ValidationContext expects. */
export function buildMasterMap(entries: MasterMapEntry[]): Map<string, Map<string, string>> {
  const byField = new Map<string, Map<string, string>>()
  for (const e of entries) {
    if (!byField.has(e.field)) byField.set(e.field, new Map())
    byField.get(e.field)!.set(e.ecubixValue, e.erpValue)
  }
  return byField
}

function validationCtx(
  s: Pick<AppState, 'masterMap' | 'regexMap' | 'erpItemsIndex' | 'erpCustomersIndex' | 'erpExisting' | 'customerProfiles'>,
  batchHq?: string,
  batchDepartment?: string,
): ValidationContext {
  return {
    masterMap: buildMasterMap(s.masterMap),
    regexMap: s.regexMap,
    erpItemsIndex: s.erpItemsIndex,
    erpCustomersIndex: s.erpCustomersIndex,
    erpExisting: s.erpExisting,
    customerProfiles: s.customerProfiles,
    batchHq,
    batchDepartment,
    hasErpSnapshot: s.erpItemsIndex.size > 0,
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  loaded: false,
  uid: '',
  credentials: EMPTY_CREDENTIALS,
  secondaryConfig: EMPTY_SECONDARY_CONFIG,
  masterMap: [],
  regexMap: [],
  batches: [],
  prefs: DEFAULT_PREFS,
  activeBatchId: null,
  rows: [],
  erpItemsIndex: new Map(),
  erpCustomersIndex: new Map(),
  erpExisting: new Map(),
  customerProfiles: new Map(),

  async loadAll(uid) {
    const snap = await persistence.loadAll(uid)
    set({ ...snap, uid, loaded: true })
  },

  async saveCredentials(c) {
    set({ credentials: c })
    await persistence.saveCredentials(c)
  },

  async saveSecondaryConfig(c) {
    set({ secondaryConfig: c })
    await persistence.saveSecondaryConfig(c)
  },

  async upsertMasterMap(e) {
    set((s) => ({ masterMap: [...s.masterMap.filter((x) => x.id !== e.id), e] }))
    await persistence.saveMasterMapEntry(e)
    await get().revalidate()
  },

  async removeMasterMap(id) {
    set((s) => ({ masterMap: s.masterMap.filter((x) => x.id !== id) }))
    await persistence.deleteMasterMapEntry(id)
    await get().revalidate()
  },

  async upsertRegexMap(e) {
    set((s) => ({ regexMap: [...s.regexMap.filter((x) => x.id !== e.id), e] }))
    await persistence.saveRegexMapEntry(e)
    await get().revalidate()
  },

  async removeRegexMap(id) {
    set((s) => ({ regexMap: s.regexMap.filter((x) => x.id !== id) }))
    await persistence.deleteRegexMapEntry(id)
    await get().revalidate()
  },

  async confirmMasterMatch(field, ecubixValue, erpValue, source = 'fuzzy', comment) {
    const norm = ecubixValue.trim().toLowerCase()
    const existing = get().masterMap.find((m) => m.field === field && m.ecubixValue === norm)
    await get().upsertMasterMap({
      id: existing?.id ?? `master-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      field,
      ecubixValue: norm,
      displayEcubixValue: ecubixValue,
      erpValue,
      source,
      comment: comment ?? existing?.comment ?? '',
      createdBy: get().uid,
      createdAt: new Date().toISOString(),
    })
  },

  async savePrefs(p) {
    set({ prefs: p })
    await persistence.savePrefs(get().uid, p)
  },

  async saveBatch(b) {
    set((s) => ({ batches: [b, ...s.batches.filter((x) => x.id !== b.id)] }))
    await persistence.saveBatch(b)
  },

  async openBatch(batchId) {
    console.log('[openBatch]', batchId, 'loading rows…')
    const rows = await persistence.loadRows(batchId)
    console.log('[openBatch]', batchId, 'loaded', rows.length, 'rows')
    set({ activeBatchId: batchId, rows })
  },

  closeBatch() {
    set({ activeBatchId: null, rows: [] })
  },

  setErpSnapshot(items, customers, existing, customerProfiles) {
    set({ erpItemsIndex: items, erpCustomersIndex: customers, erpExisting: existing, customerProfiles })
  },

  async putRows(batchId, rows, replace = false) {
    const current = get()
    const merged = replace
      ? rows
      : (() => {
          const byId = new Map(current.rows.map((r) => [r.id, r]))
          for (const r of rows) byId.set(r.id, r)
          return [...byId.values()].sort((a, b) => a.rowIndex - b.rowIndex)
        })()

    if (current.activeBatchId === batchId) set({ rows: merged })
    await persistence.saveRows(batchId, rows)

    const batch = current.batches.find((b) => b.id === batchId)
    if (batch) {
      const updated = { ...batch, counts: countRows(merged), lastRunAt: new Date().toISOString() }
      await get().saveBatch(updated)
    }
  },

  async revalidate() {
    const s = get()
    if (!s.activeBatchId || s.rows.length === 0) return
    const batch = s.batches.find((b) => b.id === s.activeBatchId)
    const ctx = validationCtx(s, batch?.hq, batch?.department)
    const next = s.rows.map((r) => validateRow(r, ctx))
    const changed = next.filter((r, i) => JSON.stringify(r) !== JSON.stringify(s.rows[i]))
    if (changed.length === 0) return
    await s.putRows(s.activeBatchId, changed)
  },
}))
