'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useShallow } from 'zustand/react/shallow'
import { StatusChip } from '../../components/StatusChip'
import { buildMasterMap, useAppStore } from '../../data/appStore'
import { countRows, findErpLine, groupKey } from '../../engine/validateRow'
import type { CustomerProfile, ErpSecondaryDoc, ItemDepartment, MigrationRow, RowState } from '../../types'
import { VALUE_FIELDS } from '../../types'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Checkbox } from '../../ui/Checkbox'
import { OutlineChipButton } from '../../ui/Chip'
import { cn } from '../../ui/cn'
import { Spinner } from '../../ui/Spinner'
import { Faint, Muted, PageHead, SectionLabel } from '../../ui/Text'
import { SearchableSelect } from '../../ui/Combobox'
import { StatTile } from '../../ui/StatTile'
import { EbsCodesDialog } from './EbsCodesDialog'
import { ItemDepartmentsDialog } from './ItemDepartmentsDialog'
import { MapCustomerDialog } from './MapCustomerDialog'
import { RoleProfileDialog } from './RoleProfileDialog'
import { RowDetailPanel } from './RowDetailPanel'
import {
  erpClientFrom,
  fetchErpSnapshot,
  fetchItemDepartments,
  matchCustomersByEbsCode,
  matchItemsByName,
  pushRows,
  validatePushed,
  type MasterMatchResult,
  type PushProgress,
} from './erpActions'

const FILTERS: { key: RowState | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'matched', label: 'Matched' },
  { key: 'error', label: 'Errors' },
  { key: 'conflict', label: 'Conflicts' },
  { key: 'synced', label: 'Synced' },
  { key: 'skipped', label: 'Skipped' },
]

function fmt(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('en-IN')
}

function fmtCurrency(n: number): string {
  return `₹${fmt(n)}`
}

// Per-field ERP value for a row: 'new' rows have no ERP record at all;
// otherwise a diff entry means the field mismatched (use its recorded erp
// value), and absence of a diff entry means the field matched (same as Ecubix).
function erpValueFor(r: MigrationRow, field: string): string | number | null | undefined {
  if (r.state === 'new') return undefined
  const d = r.diff.find((d) => d.field === field)
  if (d) return d.erp
  return r.raw[field]
}

/**
 * The *expected total* ERP value for an item — sums every ERP line sharing
 * this item's normalized name on the matched doc (findErpLine with no
 * ecubixValues), independent of which specific Ecubix row is asking. Used
 * for group/aggregate totals, where r.diff isn't right: r.diff now pairs
 * each row to its own best-matching ERP line (to avoid false conflicts when
 * two Ecubix rows for one item cleanly correspond to two separate ERP
 * lines), which reflects a single line, not the pooled total this displays.
 */
function erpAggregateValueFor(
  r: MigrationRow,
  field: string,
  erpExisting: Map<string, ErpSecondaryDoc>,
): number | null | undefined {
  if (r.state === 'new' || !r.resolved.distributor || !r.resolved.item) return undefined
  const doc = erpExisting.get(groupKey(r.resolved.distributor, r.resolved.date))
  if (!doc) return undefined
  const line = findErpLine(doc, r.resolved.item)
  return line ? line[field as (typeof VALUE_FIELDS)[number]] : undefined
}

function fmtCell(v: string | number | null | undefined): string {
  if (v === undefined) return '—'
  return typeof v === 'number' ? fmt(v) : (v ?? '—')
}

const ISSUE_LABELS: Record<string, string> = {
  FIELD_MISSING: 'Field missing',
  CUSTOMER_UNMAPPED: 'Customer unmapped',
  ITEM_UNMAPPED: 'Item unmapped',
  HQ_UNMAPPED: 'HQ unmapped',
  MULTI_DEPT: 'Multiple departments',
  FIELD_INVALID: 'Field invalid',
  DATE_INVALID: 'Date invalid',
  NEGATIVE_VALUE: 'Negative value',
  PUSH_FAILED: 'Push failed',
  POST_PUSH_MISMATCH: 'Post-push mismatch',
}

function issueLabel(code: string): string {
  return ISSUE_LABELS[code] ?? code
}

export function SecondaryPage() {
  const params = useParams<{ batchId?: string }>()
  const batchId = params.batchId
  const router = useRouter()
  const {
    batches,
    rows,
    activeBatchId,
    openBatch,
    closeBatch,
    putRows,
    credentials,
    prefs,
    masterMap,
    regexMap,
    erpExisting,
    customerProfiles,
    setErpSnapshot,
    secondaryConfig,
    confirmMasterMatch,
    saveBatch,
    revalidate,
  } = useAppStore(
    useShallow((s) => ({
      batches: s.batches,
      rows: s.rows,
      activeBatchId: s.activeBatchId,
      openBatch: s.openBatch,
      closeBatch: s.closeBatch,
      putRows: s.putRows,
      credentials: s.credentials,
      prefs: s.prefs,
      masterMap: s.masterMap,
      regexMap: s.regexMap,
      erpExisting: s.erpExisting,
      customerProfiles: s.customerProfiles,
      setErpSnapshot: s.setErpSnapshot,
      secondaryConfig: s.secondaryConfig,
      confirmMasterMatch: s.confirmMasterMatch,
      saveBatch: s.saveBatch,
      revalidate: s.revalidate,
    })),
  )

  const batch = batches.find((b) => b.id === batchId)

  const [filter, setFilter] = useState<RowState | 'all'>('all')
  const [viewMode, setViewMode] = useState<'flat' | 'stockist'>('stockist')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailRowId, setDetailRowId] = useState<string | null>(null)
  const [mapDialog, setMapDialog] = useState<{ ebsCode: string; customerName: string } | null>(null)
  const [roleProfileDialog, setRoleProfileDialog] = useState<{ customerName: string; profiles: CustomerProfile[] } | null>(
    null,
  )
  const [ebsCodesDialog, setEbsCodesDialog] = useState<{ customerName: string; values: string[] } | null>(null)
  const [itemDepartmentsDialog, setItemDepartmentsDialog] = useState<{
    itemName: string
    departments: ItemDepartment[]
  } | null>(null)
  const [pushProgress, setPushProgress] = useState<PushProgress | null>(null)
  const [bulkPushing, setBulkPushing] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [erpFetchError, setErpFetchError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)

  useEffect(() => {
    if (batchId && batchId !== activeBatchId) void openBatch(batchId)
    if (!batchId && activeBatchId) closeBatch()
  }, [batchId, activeBatchId, openBatch, closeBatch, batch])

  useEffect(() => {
    setSelected(new Set())
  }, [batchId])

  // Fetching a batch directly (refresh, Reopen, Dashboard link) doesn't go
  // through the batch-creation flow, so the ERP snapshot used for the
  // "fetched from ERP" comparison column might not be loaded yet — fetch it here too.
  useEffect(() => {
    if (!batch || rows.length === 0 || erpExisting.size > 0) return
    const erp = erpClientFrom(credentials)
    if (!erp) return
    const masterMapCtx = buildMasterMap(masterMap)
    const confirmedDistributors = Object.fromEntries(masterMapCtx.get('distributor') ?? [])
    const ebsCodeErpFields = secondaryConfig.headerMap.find((h) => h.field === 'ebsCode')?.erpFields ?? []
    const ebsCodes = [...new Set(rows.map((r) => r.ebsCode).filter((c): c is string => Boolean(c)))]
    if (ebsCodes.length === 0) return
    fetchErpSnapshot(erp, ebsCodes, ebsCodeErpFields, confirmedDistributors, batch.month)
      .then((snapshot) => setErpSnapshot(snapshot.items, snapshot.customers, snapshot.existing, snapshot.customerProfiles))
      .catch((e) => setErpFetchError(e instanceof Error ? e.message : String(e)))
  }, [batch, rows, erpExisting.size, credentials, masterMap, secondaryConfig, setErpSnapshot])

  // Rows persisted from an earlier session (or from before a validation-logic
  // change, e.g. clubbing duplicate ERP item lines) carry whatever diff was
  // computed back then. Once this batch's rows AND an ERP snapshot are both
  // available — however they got loaded, cached-in-store or freshly fetched
  // above — re-run validation once so the stored diff reflects current logic.
  const revalidatedBatchRef = useRef<string | null>(null)
  useEffect(() => {
    if (!batch || rows.length === 0 || erpExisting.size === 0) return
    if (revalidatedBatchRef.current === batch.id) return
    revalidatedBatchRef.current = batch.id
    void revalidate()
  }, [batch, rows.length, erpExisting.size, revalidate])

  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.state === filter)),
    [rows, filter],
  )

  const mappedHeaderMap = useMemo(
    () => secondaryConfig.headerMap.filter((h) => h.ecubixHeader.trim()),
    [secondaryConfig.headerMap],
  )

  const numericHeaderMap = useMemo(
    () => mappedHeaderMap.filter((h) => h.type === 'int' || h.type === 'currency'),
    [mappedHeaderMap],
  )

  const displayHeaderMap = useMemo(
    () => mappedHeaderMap.filter((h) => h.field !== 'ebsCode'),
    [mappedHeaderMap],
  )

  const groupedVisible = useMemo(() => {
    if (viewMode === 'flat') return null
    const groups = new Map<
      string,
      {
        count: number
        sums: Record<string, number>
        erpSums: Record<string, number>
        states: Partial<Record<RowState, number>>
        issueCount: number
        rows: MigrationRow[]
        ebsCode?: string
        erpCounted: Set<string>
      }
    >()
    for (const r of visible) {
      const key = r.customerName || '—'
      const g =
        groups.get(key) ??
        { count: 0, sums: {}, erpSums: {}, states: {}, issueCount: 0, rows: [], ebsCode: r.ebsCode || undefined, erpCounted: new Set() }
      g.count++
      // Two Ecubix rows for the same item resolve to the same ERP item line
      // (diffRow matches by item name, not by Ecubix row) — so the ERP side
      // must only be counted once per distinct item, or it gets multiplied
      // by however many Ecubix rows share that item.
      const erpKey = `${r.resolved.item ?? r.itemName}|${r.resolved.date}`
      const alreadyCountedErp = g.erpCounted.has(erpKey)
      if (!alreadyCountedErp) g.erpCounted.add(erpKey)
      for (const h of numericHeaderMap) {
        const v = r.raw[h.field]
        if (typeof v === 'number') g.sums[h.field] = (g.sums[h.field] ?? 0) + v
        if (!alreadyCountedErp) {
          const erpV = erpAggregateValueFor(r, h.field, erpExisting)
          if (typeof erpV === 'number') g.erpSums[h.field] = (g.erpSums[h.field] ?? 0) + erpV
        }
      }
      g.states[r.state] = (g.states[r.state] ?? 0) + 1
      g.issueCount += r.issues.length > 0 ? r.issues.length : r.diff.length
      g.rows.push(r)
      groups.set(key, g)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [visible, viewMode, numericHeaderMap, erpExisting])

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  useEffect(() => {
    setExpandedGroups(new Set())
  }, [viewMode, batchId])

  const toggleGroup = (groupName: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupName)) next.delete(groupName)
      else next.add(groupName)
      return next
    })
  }

  // Only the flat row view needs virtualization — grouped views are bounded
  // by distinct stockist/item count, far smaller than raw row count.
  const tableScrollRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual's returned functions are intentionally unmemoized
  const rowVirtualizer = useVirtualizer({
    count: groupedVisible ? 0 : visible.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 40,
    overscan: 12,
  })

  const detailRow = rows.find((r) => r.id === detailRowId) ?? null
  const erp = erpClientFrom(credentials)

  // MASTER DATA — fixed to Customer (matched by EBS code, exact only) and
  // Item (matched by product name, fuzzy) — see Settings → Header → ERP
  // field map → EBS code / Item name → ERP Field for which ERP field(s) each
  // matches against.
  const customerRows = useMemo(() => {
    const byCode = new Map<string, { ebsCode: string; customerName: string }>()
    for (const r of rows) {
      if (r.ebsCode && !byCode.has(r.ebsCode)) byCode.set(r.ebsCode, { ebsCode: r.ebsCode, customerName: r.customerName })
    }
    return [...byCode.values()].sort((a, b) => a.ebsCode.localeCompare(b.ebsCode))
  }, [rows])

  const itemRows = useMemo(() => {
    const names = new Set<string>()
    for (const r of rows) if (r.itemName) names.add(r.itemName)
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [rows])

  const ebsCodeErpFields = useMemo(
    () => secondaryConfig.headerMap.find((h) => h.field === 'ebsCode')?.erpFields ?? [],
    [secondaryConfig.headerMap],
  )
  const itemNameErpFields = useMemo(
    () => secondaryConfig.headerMap.find((h) => h.field === 'itemName')?.erpFields ?? [],
    [secondaryConfig.headerMap],
  )

  const [customerMatches, setCustomerMatches] = useState<Map<string, MasterMatchResult>>(new Map())
  const [customerOptions, setCustomerOptions] = useState<string[]>([])
  const [customerEbsValues, setCustomerEbsValues] = useState<Map<string, string[]>>(new Map())
  const [pendingCustomerOverrides, setPendingCustomerOverrides] = useState<Map<string, string>>(new Map())
  const [itemMatches, setItemMatches] = useState<Map<string, MasterMatchResult>>(new Map())
  const [itemOptions, setItemOptions] = useState<string[]>([])
  const [itemDepartments, setItemDepartments] = useState<Map<string, ItemDepartment[]>>(new Map())
  const [pendingItemOverrides, setPendingItemOverrides] = useState<Map<string, string>>(new Map())
  const [customerMatchesLoading, setCustomerMatchesLoading] = useState(false)
  const [itemMatchesLoading, setItemMatchesLoading] = useState(false)
  const [confirmingCustomer, setConfirmingCustomer] = useState<string | null>(null)
  const [confirmingItem, setConfirmingItem] = useState<string | null>(null)
  // Only suppress rows during the *first* fetch (no cached matches yet) — a
  // background refetch (e.g. masterMap changed) keeps showing stale-but-real
  // data instead of flashing a loader over already-visible rows.
  const customerMatchesPending = customerMatchesLoading && customerMatches.size === 0
  const itemMatchesPending = itemMatchesLoading && itemMatches.size === 0

  useEffect(() => {
    if (customerRows.length === 0) return
    const erpClient = erpClientFrom(credentials)
    if (!erpClient) return
    let cancelled = false
    setCustomerMatchesLoading(true)
    const confirmed = Object.fromEntries(buildMasterMap(masterMap).get('distributor') ?? [])
    matchCustomersByEbsCode(erpClient, customerRows.map((c) => c.ebsCode), ebsCodeErpFields, confirmed)
      .then((outcome) => {
        if (cancelled) return
        setCustomerMatches(outcome.matches)
        setCustomerOptions(outcome.options)
        setCustomerEbsValues(outcome.valuesByDoc ?? new Map())
      })
      .catch((e) => console.error('[SecondaryPage] customer match failed', e))
      .finally(() => {
        if (!cancelled) setCustomerMatchesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [customerRows, ebsCodeErpFields, credentials, masterMap])

  useEffect(() => {
    if (itemRows.length === 0) return
    const erpClient = erpClientFrom(credentials)
    if (!erpClient) return
    let cancelled = false
    setItemMatchesLoading(true)
    const confirmed = Object.fromEntries(buildMasterMap(masterMap).get('item') ?? [])
    matchItemsByName(erpClient, itemRows, itemNameErpFields, confirmed, regexMap)
      .then((outcome) => {
        if (cancelled) return
        setItemMatches(outcome.matches)
        setItemOptions(outcome.options)
      })
      .catch((e) => console.error('[SecondaryPage] item match failed', e))
      .finally(() => {
        if (!cancelled) setItemMatchesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [itemRows, itemNameErpFields, credentials, masterMap, regexMap])

  const matchedItemDocs = useMemo(
    () => [...new Set([...itemMatches.values()].map((m) => m.erpValue).filter((v): v is string => Boolean(v)))],
    [itemMatches],
  )

  useEffect(() => {
    if (matchedItemDocs.length === 0) return
    const erpClient = erpClientFrom(credentials)
    if (!erpClient) return
    let cancelled = false
    fetchItemDepartments(erpClient, matchedItemDocs)
      .then((departments) => {
        if (!cancelled) setItemDepartments(departments)
      })
      .catch((e) => console.error('[SecondaryPage] item department fetch failed', e))
    return () => {
      cancelled = true
    }
  }, [matchedItemDocs, credentials])

  // "Matched" requires both an ERP customer resolved AND (when the batch has a
  // tagged HQ/department) a role profile matching it — same rule as the
  // per-row Matched cell, shared here so the card header's unresolved count
  // agrees with the table.
  const customerMatchStatus = useMemo(() => {
    const wantedHq = (batch?.hq ?? '').trim().toLowerCase()
    const wantedDept = (batch?.department ?? '').trim().toLowerCase()
    const hasBatchTag = Boolean(wantedHq || wantedDept)
    const map = new Map<string, boolean>()
    for (const c of customerRows) {
      const m = customerMatches.get(c.ebsCode)
      const profiles = m?.erpValue ? (customerProfiles.get(m.erpValue) ?? []) : []
      const roleProfileMatches =
        !hasBatchTag ||
        profiles.some(
          (p) =>
            (!wantedHq || p.hq.trim().toLowerCase().replace(/^hq-/, '') === wantedHq) &&
            (!wantedDept || p.department.trim().toLowerCase() === wantedDept),
        )
      map.set(c.ebsCode, Boolean(m?.erpValue) && roleProfileMatches)
    }
    return map
  }, [customerRows, customerMatches, customerProfiles, batch?.hq, batch?.department])

  const customerUnresolvedCount = useMemo(
    () => customerRows.filter((c) => !customerMatchStatus.get(c.ebsCode)).length,
    [customerRows, customerMatchStatus],
  )

  async function confirmCustomerMatch(ebsCode: string, erpValue: string) {
    setConfirmingCustomer(ebsCode)
    await confirmMasterMatch('distributor', ebsCode, erpValue)
    setCustomerMatches((prev) => new Map(prev).set(ebsCode, { erpValue, suggestion: null, score: null }))
    setPendingCustomerOverrides((prev) => {
      const next = new Map(prev)
      next.delete(ebsCode)
      return next
    })
    setConfirmingCustomer(null)
  }

  async function confirmItemMatch(itemName: string, erpValue: string) {
    setConfirmingItem(itemName)
    await confirmMasterMatch('item', itemName, erpValue)
    setItemMatches((prev) => new Map(prev).set(itemName, { erpValue, suggestion: null, score: null }))
    setPendingItemOverrides((prev) => {
      const next = new Map(prev)
      next.delete(itemName)
      return next
    })
    setConfirmingItem(null)
  }

  // KPI strip — Ecubix-vs-ERP comparison. Value fields are summed Ecubix-side
  // (row.values) and ERP-side (the matching ErpSecondaryDoc item line, found
  // the same way diffRow does), so "diff" here means the same thing it does
  // in the per-row Status/Issues column.
  const kpis = useMemo(() => {
    const counts = countRows(rows)
    const customersMapped = customerRows.filter((c) => customerMatches.get(c.ebsCode)?.erpValue).length
    const itemsMapped = itemRows.filter((n) => itemMatches.get(n)?.erpValue).length
    let ecubixSalesValue = 0
    let erpSalesValue = 0
    let ecubixClosingValue = 0
    let erpClosingValue = 0
    let ecubixSalesQty = 0
    let erpSalesQty = 0
    let ecubixClosingQty = 0
    let erpClosingQty = 0
    let matchedEqualValue = 0
    // Two Ecubix rows for the same distributor+date+item resolve to the same
    // ERP item line — count that line's values only once, or the ERP-side
    // total gets multiplied by however many Ecubix rows share it.
    const erpCounted = new Set<string>()
    for (const r of rows) {
      ecubixSalesValue += r.values.sales_value ?? 0
      ecubixClosingValue += r.values.closing_balance ?? 0
      ecubixSalesQty += r.values.sales_qty ?? 0
      ecubixClosingQty += r.values.closing_qty ?? 0
      const doc = r.resolved.distributor ? erpExisting.get(groupKey(r.resolved.distributor, r.resolved.date)) : undefined
      const line = doc && r.resolved.item ? findErpLine(doc, r.resolved.item) : undefined
      if (line) {
        if (r.diff.length === 0) matchedEqualValue += r.values.sales_value ?? 0
        const erpKey = `${r.resolved.distributor}|${r.resolved.date}|${r.resolved.item}`
        if (!erpCounted.has(erpKey)) {
          erpCounted.add(erpKey)
          erpSalesValue += line.sales_value ?? 0
          erpClosingValue += line.closing_balance ?? 0
          erpSalesQty += line.sales_qty ?? 0
          erpClosingQty += line.closing_qty ?? 0
        }
      }
    }
    return {
      counts,
      customersTotal: customerRows.length,
      customersMapped,
      itemsUnmapped: itemRows.length - itemsMapped,
      customersUnmapped: customerRows.length - customersMapped,
      ecubixSalesValue,
      erpSalesValue,
      ecubixClosingValue,
      erpClosingValue,
      ecubixSalesQty,
      erpSalesQty,
      ecubixClosingQty,
      erpClosingQty,
      matchedEqualValue,
      matchedPct: ecubixSalesValue > 0 ? Math.round((matchedEqualValue / ecubixSalesValue) * 100) : 0,
      masterDataPending: customerMatchesPending || itemMatchesPending,
    }
  }, [rows, customerRows, customerMatches, itemRows, itemMatches, erpExisting, customerMatchesPending, itemMatchesPending])

  async function updateRows(updated: MigrationRow[]) {
    if (!batch) return
    await putRows(batch.id, updated)
  }

  async function bulkSkip() {
    const targets = rows.filter((r) => selected.has(r.id) && r.state !== 'synced')
    if (targets.length === 0) return
    await updateRows(targets.map((r) => ({ ...r, state: 'skipped' as const })))
    setSelected(new Set())
  }

  async function bulkUnskip() {
    const targets = rows.filter((r) => selected.has(r.id) && r.state === 'skipped')
    if (targets.length === 0) return
    await updateRows(targets.map((r) => ({ ...r, state: 'new' as const, resolution: null })))
    setSelected(new Set())
    await revalidate()
  }

  /** Bulk version of RowDetailPanel's "Keep ERP values" conflict resolution. */
  async function bulkMarkSynced() {
    const targets = rows.filter((r) => selected.has(r.id) && r.state === 'conflict')
    if (targets.length === 0) return
    await updateRows(targets.map((r) => ({ ...r, resolution: 'keep-erp' as const, state: 'synced' as const })))
    setSelected(new Set())
  }

  /** Bulk version of RowDetailPanel's "Use Ecubix values" conflict resolution. */
  async function bulkUseEcubix() {
    const targets = rows.filter((r) => selected.has(r.id) && r.state === 'conflict')
    if (targets.length === 0) return
    await updateRows(targets.map((r) => ({ ...r, resolution: 'use-ecubix' as const, state: 'matched' as const })))
    setSelected(new Set())
  }

  /**
   * Push only the selected rows — but expanded to every row sharing a
   * distributor|date group with a selected row. buildDocPayload replaces a
   * doc's item list wholesale (Ecubix-owns-doc policy), so pushing a partial
   * group would silently drop that doc's other items.
   */
  async function bulkPush() {
    if (!batch || !erp) {
      setFlash('Connect ERPNext in Settings before pushing.')
      return
    }
    const selectedRows = rows.filter((r) => selected.has(r.id))
    if (selectedRows.length === 0) return
    const keys = new Set(
      selectedRows.filter((r) => r.resolved.distributor).map((r) => groupKey(r.resolved.distributor!, r.resolved.date)),
    )
    const targets = rows.filter((r) => r.resolved.distributor && keys.has(groupKey(r.resolved.distributor, r.resolved.date)))
    setBulkPushing(true)
    try {
      const updated = await pushRows(erp, targets, setPushProgress)
      await updateRows(updated)
      setPushProgress(null)
      const validated = await validatePushed(erp, useAppStore.getState().rows)
      await updateRows(validated)
      setFlash(`Pushed ${updated.length} row(s) from ${selected.size} selected.`)
      setSelected(new Set())
    } finally {
      setBulkPushing(false)
    }
  }

  async function runPush() {
    if (!batch) return
    if (!erp) {
      setFlash('Connect ERPNext in Settings before pushing.')
      return
    }
    await saveBatch({ ...batch, status: 'pushing' })
    const updated = await pushRows(erp, rows, setPushProgress)
    await updateRows(updated)
    setPushProgress(null)
    await saveBatch({ ...useAppStore.getState().batches.find((b) => b.id === batch.id)!, status: 'validating' })
    // step 4 immediately after push
    const validated = await validatePushed(erp, useAppStore.getState().rows)
    await updateRows(validated)
    await saveBatch({ ...useAppStore.getState().batches.find((b) => b.id === batch.id)!, status: 'done' })
    setFlash('Push + validation finished.')
  }

  async function runValidate() {
    if (!batch) return
    if (!erp) {
      setFlash('Connect ERPNext in Settings before validating.')
      return
    }
    setValidating(true)
    try {
      const validated = await validatePushed(erp, rows)
      await updateRows(validated)
      setFlash('Validation finished.')
    } finally {
      setValidating(false)
    }
  }

  if (!batch) {
    return (
      <div>
        <Muted>Batch not found.</Muted>
        <Link href="/secondary">← Pick an Ecubix batch</Link>
      </div>
    )
  }

  if (activeBatchId !== batchId) {
    return (
      <div className="flex justify-center py-15">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  const monthLabel = new Date(batch.month + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <div className="relative">
      <PageHead
        title="Secondary · check & fix"
        subtitle={
          <>
            <span className="mono block text-xs">{batch.label}</span>
            <span className="mt-2 flex gap-2">
              <span className="rounded-full border border-accent bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-text">
                {batch.department}
              </span>
              {batch.hq && (
                <span className="rounded-full border border-accent bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-text">
                  {batch.hq}
                </span>
              )}
              <span className="rounded-full border border-accent bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-text">
                {monthLabel}
              </span>
            </span>
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => router.push('/secondary')}>↩ Ecubix</Button>
            <Button disabled={validating} onClick={() => void runValidate()}>
              {validating ? 'Validating…' : 'Validate'}
            </Button>
            <Button variant="primary" disabled={pushProgress !== null} onClick={() => void runPush()}>
              {pushProgress ? `Pushing ${pushProgress.done}/${pushProgress.total}…` : 'Push to ERPNext'}
            </Button>
          </div>
        }
      />

      {flash && (
        <Card className="mb-3.5 p-2.5 px-3.5 text-[12.5px]">
          {flash}{' '}
          <Button size="sm" className="ml-2" onClick={() => setFlash(null)}>
            dismiss
          </Button>
        </Card>
      )}

      {/* KPI STRIP — Ecubix vs ERP, at a glance */}
      <div className="mb-2.5 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
        <StatTile label="Total rows" value={kpis.counts.total} sub={`${monthLabel} · ${batch.hq || batch.department}`} />
        <StatTile
          label="Synced"
          value={kpis.counts.synced}
          valueClassName="text-status-synced"
          sub="validated in ERP"
        />
        <StatTile
          label="Pending push"
          value={kpis.counts.new + kpis.counts.matched}
          sub={`${kpis.counts.new} new · ${kpis.counts.matched} matched`}
        />
        <StatTile
          label="Errors"
          value={kpis.counts.error}
          valueClassName={kpis.counts.error > 0 ? 'text-status-error' : 'text-text-faint'}
          sub="need fixing"
        />
        <StatTile
          label="Conflicts"
          value={kpis.counts.conflict}
          valueClassName={kpis.counts.conflict > 0 ? 'text-status-conflict' : 'text-text-faint'}
          sub="Ecubix vs ERP"
        />
        <StatTile
          label="Master issues"
          value={kpis.masterDataPending ? '…' : kpis.customersUnmapped + kpis.itemsUnmapped}
          valueClassName={
            !kpis.masterDataPending && kpis.customersUnmapped + kpis.itemsUnmapped > 0
              ? 'text-status-matched'
              : 'text-text-faint'
          }
          sub={kpis.masterDataPending ? 'loading…' : `${kpis.customersUnmapped} customers · ${kpis.itemsUnmapped} items`}
        />
        <StatTile
          label="Customers"
          value={kpis.customersTotal}
          sub={kpis.masterDataPending ? 'loading…' : `${kpis.customersMapped} mapped · ${kpis.customersUnmapped} unmapped`}
          subClassName={!kpis.masterDataPending && kpis.customersUnmapped > 0 ? 'text-status-error' : 'text-status-synced'}
        />
        <StatTile
          label="Value matched"
          value={`${kpis.matchedPct}%`}
          sub={`${fmtCurrency(kpis.matchedEqualValue)} synced & equal`}
          subClassName="text-status-synced"
        />
      </div>

      {/* VALUE RECONCILIATION — Ecubix vs ERPNext, qty + value */}
      <SectionLabel className="mb-2 block">Value reconciliation · ECUBIX vs ERPNext</SectionLabel>
      <div className="mb-5.5 grid grid-cols-4 gap-2.5">
        <StatTile
          label="Secondary qty"
          value={fmt(kpis.ecubixSalesQty)}
          sub={`ERP ${fmt(kpis.erpSalesQty)} · diff ${fmt(Math.abs(kpis.ecubixSalesQty - kpis.erpSalesQty))}`}
          subClassName={kpis.ecubixSalesQty !== kpis.erpSalesQty ? 'text-status-error' : 'text-status-synced'}
        />
        <StatTile
          label="Secondary value"
          value={fmtCurrency(kpis.ecubixSalesValue)}
          sub={`ERP ${fmtCurrency(kpis.erpSalesValue)} · diff ${fmtCurrency(Math.abs(kpis.ecubixSalesValue - kpis.erpSalesValue))}`}
          subClassName={kpis.ecubixSalesValue !== kpis.erpSalesValue ? 'text-status-error' : 'text-status-synced'}
        />
        <StatTile
          label="Closing qty"
          value={fmt(kpis.ecubixClosingQty)}
          sub={`ERP ${fmt(kpis.erpClosingQty)} · diff ${fmt(Math.abs(kpis.ecubixClosingQty - kpis.erpClosingQty))}`}
          subClassName={kpis.ecubixClosingQty !== kpis.erpClosingQty ? 'text-status-error' : 'text-status-synced'}
        />
        <StatTile
          label="Closing value"
          value={fmtCurrency(kpis.ecubixClosingValue)}
          sub={`ERP ${fmtCurrency(kpis.erpClosingValue)} · diff ${fmtCurrency(Math.abs(kpis.ecubixClosingValue - kpis.erpClosingValue))}`}
          subClassName={kpis.ecubixClosingValue !== kpis.erpClosingValue ? 'text-status-error' : 'text-status-synced'}
        />
      </div>

      {/* MASTER DATA — fixed Customer (exact, by EBS code) + Item (fuzzy, by product name) */}
      <SectionLabel className="mb-2 block">Master data</SectionLabel>
      <div className="grid grid-cols-2 gap-3.5 mb-5.5">
        <Card>
          <div className="flex items-center justify-between p-3 px-3.5">
            <span className="font-semibold">Customer</span>
            <span className="text-[12.5px]">
              {customerMatchesPending ? (
                <Muted>…</Muted>
              ) : (
                (() => {
                  const matched = customerRows.length - customerUnresolvedCount
                  return customerRows.length === 0 ? (
                    <Muted>0 distinct</Muted>
                  ) : (
                    <>
                      {customerUnresolvedCount > 0 && (
                        <span className="text-status-error">{customerUnresolvedCount} unresolved</span>
                      )}
                      {customerUnresolvedCount > 0 && matched > 0 && <Faint> · </Faint>}
                      {matched > 0 && <span className="text-status-synced">{matched} Matched</span>}
                    </>
                  )
                })()
              )}
            </span>
          </div>
          <div className="table-scroll max-h-70 overflow-y-auto">
            <table className="table-data min-w-0">
              <colgroup>
                <col className="w-[16%]" />
                <col className="w-[10%]" />
                <col className="w-[30%]" />
                <col className="w-[10%]" />
                <col className="w-[16%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead>
                <tr>
                  <th colSpan={2} className="text-center">ECUBIX</th>
                  <th colSpan={3} className="border-l border-l-border-strong text-center">ERP</th>
                  <th rowSpan={2} className="border-l border-l-border-strong">Matched</th>
                </tr>
                <tr>
                  <th>Stockist</th>
                  <th>EBS</th>
                  <th className="border-l border-l-border-strong">Customer</th>
                  <th>EBS</th>
                  <th>Role Profile</th>
                </tr>
              </thead>
              <tbody>
                {customerMatchesPending && (
                  <tr>
                    <td colSpan={6} className="py-7 text-center text-text-muted">
                      <span className="inline-flex items-center gap-2">
                        <Spinner className="h-3.5 w-3.5" />
                        Loading ERP matches…
                      </span>
                    </td>
                  </tr>
                )}
                {!customerMatchesPending && customerRows.map((c) => {
                  const m = customerMatches.get(c.ebsCode)
                  const pending = pendingCustomerOverrides.get(c.ebsCode)
                  const profiles = m?.erpValue ? (customerProfiles.get(m.erpValue) ?? []) : []
                  const erpEbsValues = m?.erpValue ? (customerEbsValues.get(m.erpValue) ?? []) : []
                  const isMatched = customerMatchStatus.get(c.ebsCode) ?? false
                  return (
                    <tr key={c.ebsCode}>
                      <td className="max-w-45 !h-auto py-1.5 text-[12.5px] whitespace-normal break-words !overflow-visible">
                        {c.customerName}
                      </td>
                      <td className="mono text-[12.5px]">{c.ebsCode}</td>
                      <td className="border-l border-l-border-strong">
                        <SearchableSelect
                          className="!w-full !px-1.5 !py-0.5"
                          value={pending ?? m?.erpValue ?? ''}
                          placeholder="Pick ERP customer…"
                          options={customerOptions.map((o) => ({ value: o, label: o }))}
                          onValueChange={(val) => {
                            if (val && val !== m?.erpValue) {
                              setPendingCustomerOverrides((prev) => new Map(prev).set(c.ebsCode, val))
                            }
                          }}
                        />
                      </td>
                      <td>
                        {erpEbsValues.length > 0 ? (
                          <OutlineChipButton
                            onClick={() => setEbsCodesDialog({ customerName: m!.erpValue!, values: erpEbsValues })}
                          >
                            {erpEbsValues.length === 1 ? erpEbsValues[0] : `${erpEbsValues.length} EBS codes`}
                          </OutlineChipButton>
                        ) : (
                          <Faint className="text-[12.5px]">—</Faint>
                        )}
                      </td>
                      <td>
                        {profiles.length > 0 ? (
                          <OutlineChipButton
                            onClick={() => setRoleProfileDialog({ customerName: m!.erpValue!, profiles })}
                          >
                            {profiles.length} role profile{profiles.length === 1 ? '' : 's'}
                          </OutlineChipButton>
                        ) : (
                          <Faint className="text-[12.5px]">—</Faint>
                        )}
                      </td>
                      <td className="border-l border-l-border-strong text-xs">
                        {pending != null && pending !== m?.erpValue ? (
                          <span className="flex flex-wrap items-center gap-1.5 text-status-conflict">
                            Override
                            <button
                              type="button"
                              disabled={confirmingCustomer === c.ebsCode}
                              className="rounded border border-status-conflict px-1.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap hover:bg-status-conflict-bg disabled:opacity-50"
                              onClick={() => void confirmCustomerMatch(c.ebsCode, pending)}
                            >
                              {confirmingCustomer === c.ebsCode ? 'Confirming…' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              disabled={confirmingCustomer === c.ebsCode}
                              className="rounded border border-status-error px-1.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap text-status-error hover:bg-status-error-bg disabled:opacity-50"
                              onClick={() =>
                                setPendingCustomerOverrides((prev) => {
                                  const next = new Map(prev)
                                  next.delete(c.ebsCode)
                                  return next
                                })
                              }
                            >
                              Cancel
                            </button>
                          </span>
                        ) : isMatched ? (
                          <span className="text-status-synced">✓ Matched</span>
                        ) : m?.erpValue ? (
                          <OutlineChipButton
                            className="!border-status-error !text-status-error"
                            onClick={() => setRoleProfileDialog({ customerName: m.erpValue!, profiles })}
                          >
                            Role profile mismatch
                          </OutlineChipButton>
                        ) : (
                          <span className="text-status-error">No match — pick above</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {!customerMatchesPending && customerRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-7 text-center text-text-muted">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between p-3 px-3.5">
            <span className="font-semibold">Item</span>
            <span className="text-[12.5px]">
              {itemMatchesPending ? (
                <Muted>…</Muted>
              ) : (
                (() => {
                  const unresolved = itemRows.filter((name) => !itemMatches.get(name)?.erpValue).length
                  const matched = itemRows.length - unresolved
                  return itemRows.length === 0 ? (
                    <Muted>0 distinct</Muted>
                  ) : (
                    <>
                      {unresolved > 0 && <span className="text-status-error">{unresolved} unresolved</span>}
                      {unresolved > 0 && matched > 0 && <Faint> · </Faint>}
                      {matched > 0 && <span className="text-status-synced">{matched} Matched</span>}
                    </>
                  )
                })()
              )}
            </span>
          </div>
          <div className="table-scroll max-h-70 overflow-y-auto">
            <table className="table-data min-w-0">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[32%]" />
                <col className="w-[20%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead>
                <tr>
                  <th className="text-center">ECUBIX</th>
                  <th colSpan={2} className="border-l border-l-border-strong text-center">ERP</th>
                  <th rowSpan={2} className="border-l border-l-border-strong">Matched</th>
                </tr>
                <tr>
                  <th>Product</th>
                  <th className="border-l border-l-border-strong">Item</th>
                  <th>Department</th>
                </tr>
              </thead>
              <tbody>
                {itemMatchesPending && (
                  <tr>
                    <td colSpan={4} className="py-7 text-center text-text-muted">
                      <span className="inline-flex items-center gap-2">
                        <Spinner className="h-3.5 w-3.5" />
                        Loading ERP matches…
                      </span>
                    </td>
                  </tr>
                )}
                {!itemMatchesPending && itemRows.map((name) => {
                  const m = itemMatches.get(name)
                  const pending = pendingItemOverrides.get(name)
                  const departments = m?.erpValue ? (itemDepartments.get(m.erpValue) ?? []) : []
                  return (
                    <tr key={name}>
                      <td className="text-[12.5px]">{name}</td>
                      <td className="border-l border-l-border-strong">
                        <SearchableSelect
                          className="!w-full !px-1.5 !py-0.5"
                          value={pending ?? m?.erpValue ?? m?.suggestion ?? ''}
                          placeholder="Pick ERP item…"
                          options={itemOptions.map((o) => ({ value: o, label: o }))}
                          onValueChange={(val) => {
                            if (val && val !== m?.erpValue) {
                              setPendingItemOverrides((prev) => new Map(prev).set(name, val))
                            }
                          }}
                        />
                      </td>
                      <td>
                        {departments.length > 0 ? (
                          <OutlineChipButton
                            onClick={() => setItemDepartmentsDialog({ itemName: m!.erpValue!, departments })}
                          >
                            {departments.length} Department{departments.length === 1 ? '' : 's'}
                          </OutlineChipButton>
                        ) : (
                          <Faint className="text-[12.5px]">—</Faint>
                        )}
                      </td>
                      <td className="border-l border-l-border-strong text-xs">
                        {pending != null && pending !== m?.erpValue ? (
                          <span className="flex flex-wrap items-center gap-1.5 text-status-conflict">
                            Override
                            <button
                              type="button"
                              disabled={confirmingItem === name}
                              className="rounded border border-status-conflict px-1.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap hover:bg-status-conflict-bg disabled:opacity-50"
                              onClick={() => void confirmItemMatch(name, pending)}
                            >
                              {confirmingItem === name ? 'Confirming…' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              disabled={confirmingItem === name}
                              className="rounded border border-status-error px-1.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap text-status-error hover:bg-status-error-bg disabled:opacity-50"
                              onClick={() =>
                                setPendingItemOverrides((prev) => {
                                  const next = new Map(prev)
                                  next.delete(name)
                                  return next
                                })
                              }
                            >
                              Cancel
                            </button>
                          </span>
                        ) : m?.erpValue ? (
                          <span className="text-status-synced">✓ Matched</span>
                        ) : m?.suggestion ? (
                          <span className="flex flex-wrap items-center gap-1.5 text-status-conflict">
                            {Math.round((m.score ?? 0) * 100)}% suggestion
                            <button
                              type="button"
                              disabled={confirmingItem === name}
                              className="rounded border border-status-conflict px-1.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap hover:bg-status-conflict-bg disabled:opacity-50"
                              onClick={() => void confirmItemMatch(name, m.suggestion!)}
                            >
                              {confirmingItem === name ? 'Confirming…' : 'Confirm'}
                            </button>
                          </span>
                        ) : (
                          <span className="text-status-error">No match — pick above</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {!itemMatchesPending && itemRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-7 text-center text-text-muted">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* ACTUAL DATA */}
      <SectionLabel className="mb-2 block">Actual data · Transactions</SectionLabel>
      {erpFetchError && (
        <p className="mb-2 text-[12.5px] text-status-error">Could not load ERP comparison data: {erpFetchError}</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {FILTERS.map((f) => {
          const count = f.key === 'all' ? rows.length : rows.filter((r) => r.state === f.key).length
          return (
            <OutlineChipButton key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label} {count > 0 && <Faint>{count}</Faint>}
            </OutlineChipButton>
          )
        })}
        <span className="ml-auto flex items-center gap-1.5">
          <OutlineChipButton active={viewMode === 'flat'} onClick={() => setViewMode('flat')}>
            Flat
          </OutlineChipButton>
          <OutlineChipButton
            active={viewMode === 'stockist'}
            onClick={() => {
              setViewMode('stockist')
              setSelected(new Set())
            }}
          >
            By Stockist
          </OutlineChipButton>
        </span>
      </div>
      {selected.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 py-2">
          <Muted className="text-[12.5px]">{selected.size} selected</Muted>
          <Button size="sm" onClick={() => void bulkSkip()}>Skip</Button>
          <Button size="sm" onClick={() => void bulkUnskip()}>Un-skip</Button>
          <Button size="sm" onClick={() => void bulkMarkSynced()}>Mark synced</Button>
          <Button size="sm" onClick={() => void bulkUseEcubix()}>Use Ecubix</Button>
          <Button
            size="sm"
            variant="primary"
            disabled={bulkPushing || !erp}
            onClick={() => void bulkPush()}
          >
            {bulkPushing ? `Pushing ${pushProgress ? `${pushProgress.done}/${pushProgress.total}` : '…'}` : 'Push selected'}
          </Button>
          <Button size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
      <Card>
        <div ref={tableScrollRef} className="table-scroll max-h-[70vh] overflow-y-auto [&_.table-data]:min-w-0">
          <table className="table-data">
            <thead>
              {groupedVisible ? (
                <>
                  <tr>
                    <th className="w-7.5" rowSpan={2} />
                    <th rowSpan={2}>Stockist / Item</th>
                    {numericHeaderMap.map((h) => (
                      <th
                        key={h.field}
                        colSpan={2}
                        className={cn('border-l border-border text-center', h.field === 'closing_balance' && 'border-r')}
                      >
                        {h.ecubixHeader || h.field}
                      </th>
                    ))}
                    <th rowSpan={2}>Rows</th>
                    <th rowSpan={2}>Status</th>
                    {prefs.issueHints && <th rowSpan={2}>Issues</th>}
                  </tr>
                  <tr>
                    {numericHeaderMap.map((h) => (
                      <Fragment key={h.field}>
                        <th className="border-l border-border text-[10px] font-normal text-text-faint">ECUBIX</th>
                        <th className={cn('text-[10px] font-normal text-text-faint', h.field === 'closing_balance' && 'border-r border-border')}>
                          ERP
                        </th>
                      </Fragment>
                    ))}
                  </tr>
                </>
              ) : (
                <>
                  <tr>
                    <th className="w-7.5" rowSpan={2}>
                      <Checkbox
                        checked={visible.length > 0 && visible.every((r) => selected.has(r.id))}
                        onCheckedChange={(checked) =>
                          setSelected(checked ? new Set(visible.map((r) => r.id)) : new Set())
                        }
                      />
                    </th>
                    {displayHeaderMap.map((h) => {
                      const isNumeric = h.type === 'int' || h.type === 'currency'
                      return isNumeric ? (
                        <th
                          key={h.field}
                          colSpan={2}
                          className={cn('border-l border-border text-center', h.field === 'closing_balance' && 'border-r')}
                        >
                          {h.ecubixHeader || h.field}
                        </th>
                      ) : (
                        <th key={h.field} rowSpan={2}>
                          {h.ecubixHeader || h.field}
                        </th>
                      )
                    })}
                    <th rowSpan={2}>Status</th>
                    {prefs.issueHints && <th rowSpan={2}>Issues</th>}
                  </tr>
                  <tr>
                    {displayHeaderMap.map((h) => {
                      const isNumeric = h.type === 'int' || h.type === 'currency'
                      return isNumeric ? (
                        <Fragment key={h.field}>
                          <th className="border-l border-border text-[10px] font-normal text-text-faint">ECUBIX</th>
                          <th
                            className={cn(
                              'text-[10px] font-normal text-text-faint',
                              h.field === 'closing_balance' && 'border-r border-border',
                            )}
                          >
                            ERP
                          </th>
                        </Fragment>
                      ) : null
                    })}
                  </tr>
                </>
              )}
            </thead>
            <tbody>
              {groupedVisible
                ? groupedVisible.flatMap(([groupName, g]) => {
                    const expanded = expandedGroups.has(groupName)
                    const groupTr = (
                      <tr key={groupName} className="clickable" onClick={() => toggleGroup(groupName)}>
                        <td className="text-text-faint">
                          <span className="inline-block w-3.5 text-center">{expanded ? '▾' : '▸'}</span>
                        </td>
                        <td className="text-[12.5px]">
                          {g.ebsCode ? (
                            <>
                              <Faint>{g.ebsCode}</Faint> — {groupName}
                            </>
                          ) : (
                            groupName
                          )}
                        </td>
                        {numericHeaderMap.map((h) => (
                          <Fragment key={h.field}>
                            <td className="border-l border-border text-[12.5px]">{fmt(g.sums[h.field] ?? null)}</td>
                            <td
                              className={cn(
                                'text-[12.5px] text-text-muted',
                                h.field === 'closing_balance' && 'border-r border-border',
                              )}
                            >
                              {fmt(g.erpSums[h.field] ?? null)}
                            </td>
                          </Fragment>
                        ))}
                        <td className="text-[12.5px] text-text-faint">{g.count}</td>
                        <td>
                          <span className="flex flex-wrap gap-1">
                            {(Object.entries(g.states) as [RowState, number][]).map(([state, n]) => (
                              <span key={state} className="inline-flex items-center gap-1">
                                <StatusChip state={state} />
                                <Faint className="text-[11px]">×{n}</Faint>
                              </span>
                            ))}
                          </span>
                        </td>
                        {prefs.issueHints && (
                          <td className="text-xs text-status-error">
                            {g.issueCount > 0 ? `${g.issueCount} issue(s)` : ''}
                          </td>
                        )}
                      </tr>
                    )
                    if (!expanded) return [groupTr]
                    // One row per Ecubix row, sorted by item name for readability
                    // — no merging: two Ecubix rows for the same item (e.g. two
                    // separate ERP transactions) should each show their own
                    // values and their own paired match/conflict state.
                    const sortedRows = [...g.rows].sort((a, b) => (a.itemName || '').localeCompare(b.itemName || ''))
                    const detailRows = sortedRows.map((r) => (
                      <tr
                        key={r.id}
                        className={cn('clickable', detailRowId === r.id && 'row-selected')}
                        onClick={(e) => {
                          e.stopPropagation()
                          setDetailRowId(r.id === detailRowId ? null : r.id)
                        }}
                      >
                        <td />
                        <td className="text-[12.5px] text-text-faint" style={{ paddingLeft: 20 }}>
                          {r.itemName || '—'}
                        </td>
                        {numericHeaderMap.map((h) => {
                          const v = r.raw[h.field]
                          return (
                            <Fragment key={h.field}>
                              <td className="border-l border-border text-[12.5px]">
                                {typeof v === 'number' ? fmt(v) : '—'}
                              </td>
                              <td
                                className={cn(
                                  'text-[12.5px] text-text-muted',
                                  h.field === 'closing_balance' && 'border-r border-border',
                                )}
                              >
                                {fmtCell(erpValueFor(r, h.field))}
                              </td>
                            </Fragment>
                          )
                        })}
                        <td className="text-[12.5px] text-text-faint" />
                        <td>
                          <StatusChip state={r.state} />
                        </td>
                        {prefs.issueHints && (
                          <td className="max-w-70 text-xs">
                            {r.issues.length > 0 ? (
                              <OutlineChipButton
                                className="!border-status-error !text-status-error"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDetailRowId(r.id)
                                }}
                              >
                                {issueLabel(r.issues[0].code)}
                                {r.issues.length > 1 && <Faint>+{r.issues.length - 1}</Faint>}
                              </OutlineChipButton>
                            ) : r.diff.length > 0 ? (
                              <span className="text-status-conflict">{r.diff.length} field(s) differ</span>
                            ) : null}
                          </td>
                        )}
                      </tr>
                    ))
                    return [groupTr, ...detailRows]
                  })
                : (() => {
                    const virtualItems = rowVirtualizer.getVirtualItems()
                    const numericInDisplay = displayHeaderMap.filter((h) => h.type === 'int' || h.type === 'currency').length
                    const colSpan = displayHeaderMap.length + numericInDisplay + 2 + (prefs.issueHints ? 1 : 0)
                    const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
                    const paddingBottom =
                      virtualItems.length > 0
                        ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
                        : 0
                    return (
                      <>
                        {paddingTop > 0 && (
                          <tr>
                            <td colSpan={colSpan} style={{ height: paddingTop, padding: 0, border: 'none' }} />
                          </tr>
                        )}
                        {virtualItems.map((vi) => {
                          const r = visible[vi.index]
                          return (
                            <tr
                              key={r.id}
                              data-index={vi.index}
                              ref={rowVirtualizer.measureElement}
                              className={cn('clickable', detailRowId === r.id && 'row-selected')}
                              onClick={() => setDetailRowId(r.id === detailRowId ? null : r.id)}
                            >
                              <td onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  checked={selected.has(r.id)}
                                  onCheckedChange={(checked) => {
                                    const next = new Set(selected)
                                    if (checked) next.add(r.id)
                                    else next.delete(r.id)
                                    setSelected(next)
                                  }}
                                />
                              </td>
                              {displayHeaderMap.map((h) => {
                                const v = r.raw[h.field]
                                const isNumeric = h.type === 'int' || h.type === 'currency'
                                if (!isNumeric) {
                                  return (
                                    <td key={h.field} className="text-[12.5px]">
                                      {h.field === 'customerName' && r.ebsCode && (
                                        <>
                                          <Faint>{r.ebsCode}</Faint>{' — '}
                                        </>
                                      )}
                                      {typeof v === 'number' ? fmt(v) : (v ?? '—')}
                                    </td>
                                  )
                                }
                                return (
                                  <Fragment key={h.field}>
                                    <td className="border-l border-border text-[12.5px]">
                                      {typeof v === 'number' ? fmt(v) : (v ?? '—')}
                                    </td>
                                    <td
                                      className={cn(
                                        'text-[12.5px] text-text-muted',
                                        h.field === 'closing_balance' && 'border-r border-border',
                                      )}
                                    >
                                      {fmtCell(erpValueFor(r, h.field))}
                                    </td>
                                  </Fragment>
                                )
                              })}
                              <td><StatusChip state={r.state} /></td>
                              {prefs.issueHints && (
                                <td className="max-w-70 text-xs">
                                  {r.issues.length > 0 ? (
                                    <OutlineChipButton
                                      className="!border-status-error !text-status-error"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setDetailRowId(r.id)
                                      }}
                                    >
                                      {issueLabel(r.issues[0].code)}
                                      {r.issues.length > 1 && <Faint>+{r.issues.length - 1}</Faint>}
                                    </OutlineChipButton>
                                  ) : r.diff.length > 0 ? (
                                    <span className="text-status-conflict">{r.diff.length} field(s) differ</span>
                                  ) : null}
                                </td>
                              )}
                            </tr>
                          )
                        })}
                        {paddingBottom > 0 && (
                          <tr>
                            <td colSpan={colSpan} style={{ height: paddingBottom, padding: 0, border: 'none' }} />
                          </tr>
                        )}
                      </>
                    )
                  })()}
              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={
                      groupedVisible
                        ? numericHeaderMap.length * 2 + 4 + (prefs.issueHints ? 1 : 0)
                        : displayHeaderMap.length +
                          displayHeaderMap.filter((h) => h.type === 'int' || h.type === 'currency').length +
                          2 +
                          (prefs.issueHints ? 1 : 0)
                    }
                    className="py-7 text-center text-text-muted"
                  >
                    No rows in this filter
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {detailRow && (
        <RowDetailPanel
          row={detailRow}
          onClose={() => setDetailRowId(null)}
          onMapCustomer={() => setMapDialog({ ebsCode: detailRow.ebsCode, customerName: detailRow.customerName })}
          onUpdate={(r) => void updateRows([r])}
        />
      )}

      {mapDialog && (
        <MapCustomerDialog
          ebsCode={mapDialog.ebsCode}
          customerName={mapDialog.customerName}
          onClose={() => setMapDialog(null)}
        />
      )}

      {roleProfileDialog && (
        <RoleProfileDialog
          customerName={roleProfileDialog.customerName}
          profiles={roleProfileDialog.profiles}
          onClose={() => setRoleProfileDialog(null)}
        />
      )}

      {ebsCodesDialog && (
        <EbsCodesDialog
          customerName={ebsCodesDialog.customerName}
          values={ebsCodesDialog.values}
          onClose={() => setEbsCodesDialog(null)}
        />
      )}

      {itemDepartmentsDialog && (
        <ItemDepartmentsDialog
          itemName={itemDepartmentsDialog.itemName}
          departments={itemDepartmentsDialog.departments}
          onClose={() => setItemDepartmentsDialog(null)}
        />
      )}
    </div>
  )
}
