'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../../data/appStore'
import { statusSummary, statusTone } from '../dashboard/DashboardPage'
import {
  getDepartmentHqs,
  getHqSummary,
  getMonthDepartments,
  getSecondaryOverview,
  type DepartmentHqs,
  type EcubixMetrics,
  type HqSummary,
  type MonthDepartments,
  type SecondaryOverview,
} from '../../lib/ecubix/reads'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Chip } from '../../ui/Chip'
import { ChipCarousel, type CarouselBadge } from '../../ui/ChipCarousel'
import { DialogClose, DialogPopup, DialogRoot, DialogTitle } from '../../ui/Dialog'
import { Select } from '../../ui/Select'
import { StatTile } from '../../ui/StatTile'
import { Muted, PageHead } from '../../ui/Text'
import type { BatchCounts } from '../../types'
import { Spinner } from '../../ui/Spinner'
import { cn } from '../../ui/cn'
import { ecubixBatchId, openOrCreateEcubixBatch } from './ecubixBatch'
import { erpClientFrom } from './erpActions'
import {
  computeReconciliation,
  reconciliationKey,
  sumReconciliation,
  type LeafReconciliation,
  type ReconciliationLeafKey,
} from './reconciliation'

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-text-faint">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-text-faint">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  )
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function fmt(n: number): string {
  return n.toLocaleString('en-IN')
}

function fmtCurrency(n: number): string {
  return `₹${fmt(n)}`
}

function monthLabel(monthKey: string): string {
  const d = new Date(`${monthKey.slice(0, 4)}-${monthKey.slice(4, 6)}-01`)
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

const EMPTY_METRICS: EcubixMetrics = {
  rowCount: 0,
  openingQty: 0,
  secondaryQty: 0,
  secondaryVal: 0,
  closingQty: 0,
  closingVal: 0,
}

function sumMetrics(all: EcubixMetrics[]): EcubixMetrics {
  const out = { ...EMPTY_METRICS }
  for (const m of all) {
    out.rowCount += m.rowCount
    out.openingQty += m.openingQty
    out.secondaryQty += m.secondaryQty
    out.secondaryVal += m.secondaryVal
    out.closingQty += m.closingQty
    out.closingVal += m.closingVal
  }
  return out
}

const deptKey = (month: string, department: string) => `${month}|${department}`
const hqKey = (month: string, department: string, hq: string) => `${month}|${department}|${hq}`

// Plain data only — no closures over refs (toggleDepartment/openHq touch the
// `requested` ref via `once()`), since building those in a useMemo (a
// render-phase computation) trips the "no ref access during render" rule.
// Click handling reads these fields directly in JSX instead.
interface TreeRow {
  key: string
  depth: 0 | 1 | 2
  kind: 'month' | 'department' | 'hq'
  month: string
  department?: string
  hq?: string
  label: string
  metrics: EcubixMetrics
  customers: number | null
  items: number | null
  expandable: boolean
  expanded?: boolean
}

export function EcubixBrowser() {
  const router = useRouter()
  const { batches, credentials, secondaryConfig, masterMap, regexMap } = useAppStore(
    useShallow((s) => ({
      batches: s.batches,
      credentials: s.credentials,
      secondaryConfig: s.secondaryConfig,
      masterMap: s.masterMap,
      regexMap: s.regexMap,
    })),
  )

  const [overview, setOverview] = useState<SecondaryOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [monthData, setMonthData] = useState<Map<string, MonthDepartments>>(new Map())
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set())
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set())
  const [deptData, setDeptData] = useState<Map<string, DepartmentHqs>>(new Map())
  const [hqSummaries, setHqSummaries] = useState<Map<string, HqSummary>>(new Map())
  const [busyHq, setBusyHq] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requested = useRef<Set<string>>(new Set())
  const autoExpanded = useRef<Set<string>>(new Set())

  // Sheet-vs-ERP reconciliation — computed on demand (see checkReconciliation)
  // since it means fetching every raw ecubix row + an ERP snapshot for
  // whatever's in scope, unlike the cheap Firestore rollups above.
  const [reconciliation, setReconciliation] = useState<Map<string, LeafReconciliation>>(new Map())
  const [reconciling, setReconciling] = useState(false)
  const reconcileRequested = useRef<Set<string>>(new Set())
  const [expandedValueCard, setExpandedValueCard] = useState<'secondary' | 'closing' | null>(null)

  // Per-month view — exactly one month is always in scope, picked from the
  // dropdown below (no "All months"). Department/HQ stay independent facets
  // for the KPI cards, scoped to whichever month is currently selected.
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null)
  const [selectedHq, setSelectedHq] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getSecondaryOverview()
      .then((o) => {
        if (cancelled) return
        setOverview(o)
        // Default to the most recent month (YYYYMM sorts chronologically as a string).
        setSelectedMonth((prev) => prev ?? [...o.months].sort().at(-1) ?? null)
      })
      .catch((e) => !cancelled && setError(errMsg(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  function once(key: string, fn: () => void) {
    if (requested.current.has(key)) return
    requested.current.add(key)
    fn()
  }

  function loadMonthDepartments(month: string) {
    once(`month:${month}`, () => {
      getMonthDepartments(month)
        .then((data) => setMonthData((prev) => new Map(prev).set(month, data)))
        .catch((e) => setError(errMsg(e)))
    })
  }

  function loadDepartmentHqs(month: string, department: string) {
    const key = deptKey(month, department)
    once(`dept:${key}`, () => {
      getDepartmentHqs(month, department)
        .then((data) => {
          setDeptData((prev) => new Map(prev).set(key, data))
          for (const hq of data.hqs) {
            const hk = hqKey(month, department, hq)
            once(`hq:${hk}`, () => {
              getHqSummary(month, department, hq)
                .then((s) => setHqSummaries((prev) => new Map(prev).set(hk, s)))
                .catch((e) => setError(errMsg(e)))
            })
          }
        })
        .catch((e) => setError(errMsg(e)))
    })
  }

  function toggleDepartment(month: string, department: string) {
    const key = deptKey(month, department)
    setExpandedDepts((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    loadDepartmentHqs(month, department)
  }

  /** Collapses/expands the whole department/HQ tree under a month — data underneath keeps loading in the background either way. */
  function toggleMonth(month: string) {
    setCollapsedMonths((prev) => {
      const next = new Set(prev)
      if (next.has(month)) next.delete(month)
      else next.add(month)
      return next
    })
  }

  /** Force-refetch this month's rollups from Firestore, bypassing the once() cache. */
  function refreshMonth(month: string) {
    const prefix = (k: string) => k === `month:${month}` || k.startsWith(`dept:${month}|`) || k.startsWith(`hq:${month}|`)
    for (const key of [...requested.current]) if (prefix(key)) requested.current.delete(key)
    setMonthData((prev) => {
      const next = new Map(prev)
      next.delete(month)
      return next
    })
    setDeptData((prev) => {
      const next = new Map(prev)
      for (const key of next.keys()) if (key.startsWith(`${month}|`)) next.delete(key)
      return next
    })
    setHqSummaries((prev) => {
      const next = new Map(prev)
      for (const key of next.keys()) if (key.startsWith(`${month}|`)) next.delete(key)
      return next
    })
    autoExpanded.current.delete(month)
    loadMonthDepartments(month)
  }

  // "Expand all under that month" — as soon as the selected month's
  // department list loads, load + expand every one of its departments (and
  // in turn every HQ under them) automatically, once per month selection.
  useEffect(() => {
    if (!selectedMonth) return
    loadMonthDepartments(selectedMonth)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadMonthDepartments is a stable closure over state already captured above
  }, [selectedMonth])

  useEffect(() => {
    if (!selectedMonth) return
    const mData = monthData.get(selectedMonth)
    if (!mData || autoExpanded.current.has(selectedMonth)) return
    autoExpanded.current.add(selectedMonth)
    setExpandedDepts((prev) => {
      const next = new Set(prev)
      for (const department of mData.departments) next.add(deptKey(selectedMonth, department))
      return next
    })
    for (const department of mData.departments) loadDepartmentHqs(selectedMonth, department)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadDepartmentHqs is a stable closure over state already captured above
  }, [selectedMonth, monthData])

  /** Union of stockist/product codes across every HQ under a department — null until every HQ's summary has loaded. */
  function departmentSets(month: string, department: string, hqs: string[]) {
    const stockists = new Set<string>()
    const products = new Set<string>()
    for (const hq of hqs) {
      const s = hqSummaries.get(hqKey(month, department, hq))
      if (!s) return null
      s.stockists.forEach((x) => stockists.add(x))
      s.products.forEach((x) => products.add(x))
    }
    return { stockists, products }
  }

  async function openHq(month: string, department: string, hq: string) {
    const hk = hqKey(month, department, hq)
    setBusyHq(hk)
    setError(null)
    try {
      const batchId = await openOrCreateEcubixBatch(month, department, hq)
      router.push(`/secondary/${batchId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyHq(null)
    }
  }

  const rows = useMemo<TreeRow[]>(() => {
    if (!selectedMonth) return []
    const mData = monthData.get(selectedMonth)
    if (!mData) return []
    const out: TreeRow[] = []

    // Root row — the month itself, encapsulating every department/HQ below it
    // (all already auto-expanded by default). Collapsible like a department
    // row — only hides the rows below, doesn't stop their data from loading.
    const monthCollapsed = collapsedMonths.has(selectedMonth)
    const monthStockists = new Set<string>()
    const monthProducts = new Set<string>()
    let monthSetsComplete = true
    for (const department of mData.departments) {
      const dData = deptData.get(deptKey(selectedMonth, department))
      if (!dData) {
        monthSetsComplete = false
        continue
      }
      const sets = departmentSets(selectedMonth, department, dData.hqs)
      if (!sets) {
        monthSetsComplete = false
        continue
      }
      sets.stockists.forEach((x) => monthStockists.add(x))
      sets.products.forEach((x) => monthProducts.add(x))
    }
    out.push({
      key: `month:${selectedMonth}`,
      depth: 0,
      kind: 'month',
      month: selectedMonth,
      label: monthLabel(selectedMonth),
      metrics: sumMetrics(Object.values(mData.departmentMetrics)),
      customers: monthSetsComplete ? monthStockists.size : null,
      items: monthSetsComplete ? monthProducts.size : null,
      expandable: true,
      expanded: !monthCollapsed,
    })
    if (monthCollapsed) return out

    for (const department of mData.departments) {
      const dKey = deptKey(selectedMonth, department)
      const dExpanded = expandedDepts.has(dKey)
      const dData = deptData.get(dKey)
      const dSets = dData ? departmentSets(selectedMonth, department, dData.hqs) : null
      out.push({
        key: `dept:${dKey}`,
        depth: 1,
        kind: 'department',
        month: selectedMonth,
        department,
        label: department,
        metrics: mData.departmentMetrics[department] ?? EMPTY_METRICS,
        customers: dSets ? dSets.stockists.size : null,
        items: dSets ? dSets.products.size : null,
        expandable: true,
        expanded: dExpanded,
      })
      if (!dExpanded || !dData) continue

      for (const hq of dData.hqs) {
        const hk = hqKey(selectedMonth, department, hq)
        const summary = hqSummaries.get(hk)
        out.push({
          key: `hq:${hk}`,
          depth: 2,
          kind: 'hq',
          month: selectedMonth,
          department,
          hq,
          label: hq,
          metrics: dData.hqMetrics[hq] ?? EMPTY_METRICS,
          customers: summary ? summary.stockists.length : null,
          items: summary ? summary.products.length : null,
          expandable: false,
        })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- departmentSets is a pure function closing over hqSummaries, already listed
  }, [selectedMonth, monthData, expandedDepts, deptData, hqSummaries, collapsedMonths])

  /**
   * Flat (department, hq) leaves for the selected month — the KPI filter
   * treats Department/HQ as independent facets over this list, so any
   * combination (e.g. one department + "All HQs") is just a filter
   * predicate, not a walk down a fixed hierarchy.
   */
  const leaves = useMemo(() => {
    if (!selectedMonth) return []
    const mData = monthData.get(selectedMonth)
    if (!mData) return []
    const out: { month: string; department: string; hq: string; metrics: EcubixMetrics; stockists: string[]; products: string[] }[] = []
    for (const department of mData.departments) {
      const dData = deptData.get(deptKey(selectedMonth, department))
      if (!dData) continue
      for (const hq of dData.hqs) {
        const summary = hqSummaries.get(hqKey(selectedMonth, department, hq))
        out.push({
          month: selectedMonth,
          department,
          hq,
          metrics: dData.hqMetrics[hq] ?? EMPTY_METRICS,
          stockists: summary?.stockists ?? [],
          products: summary?.products ?? [],
        })
      }
    }
    return out
  }, [selectedMonth, monthData, deptData, hqSummaries])

  // Option lists for the Department/HQ chip rows — scoped to the selected month.
  const monthOptions = useMemo(
    () => [...(overview?.months ?? [])].sort().map((month) => ({ value: month, label: monthLabel(month) })),
    [overview],
  )
  const departmentOptions = useMemo(
    () => [...new Set(leaves.map((l) => l.department))].sort((a, b) => a.localeCompare(b)).map((d) => ({ value: d, label: d })),
    [leaves],
  )
  // Scoped to the selected department, so picking a department narrows the HQ
  // chips to only the ones under it (instead of always listing every HQ).
  const hqOptions = useMemo(
    () =>
      [...new Set(leaves.filter((l) => !selectedDepartment || l.department === selectedDepartment).map((l) => l.hq))]
        .sort((a, b) => a.localeCompare(b))
        .map((h) => ({ value: h, label: h })),
    [leaves, selectedDepartment],
  )
  const filtersActive = Boolean(selectedDepartment || selectedHq)

  /** Picking a department that doesn't contain the currently-selected HQ drops the HQ filter instead of leaving it stuck filtering to nothing. */
  function selectDepartment(department: string | null) {
    setSelectedDepartment(department)
    if (selectedHq && !leaves.some((l) => l.hq === selectedHq && (!department || l.department === department))) {
      setSelectedHq(null)
    }
  }

  const filteredLeaves = useMemo(
    () =>
      leaves.filter(
        (l) => (!selectedDepartment || l.department === selectedDepartment) && (!selectedHq || l.hq === selectedHq),
      ),
    [leaves, selectedDepartment, selectedHq],
  )

  // KPI cards reflect the current Month/Department/HQ chip selection — any
  // independent combination of the three facets, not just top-down narrowing.
  const kpi = useMemo(() => {
    const metrics = sumMetrics(filteredLeaves.map((l) => l.metrics))
    const stockists = new Set<string>()
    const products = new Set<string>()
    for (const l of filteredLeaves) {
      l.stockists.forEach((x) => stockists.add(x))
      l.products.forEach((x) => products.add(x))
    }
    return { metrics, sets: { stockists, products } }
  }, [filteredLeaves])

  // Real counts for the summary card header — scoped to the current
  // Department/HQ filter (not the whole month), just what's honestly
  // knowable from ecubix + which HQs have actually been checked against ERP.
  const summaryCounts = useMemo(() => {
    const reconciledCount = filteredLeaves.filter((l) => reconciliation.has(reconciliationKey(l))).length
    const departments = new Set(filteredLeaves.map((l) => l.department)).size
    return { departments, hqs: filteredLeaves.length, reconciled: reconciledCount }
  }, [filteredLeaves, reconciliation])

  const erp = useMemo(() => erpClientFrom(credentials), [credentials])

  const EMPTY_BATCH_COUNTS: BatchCounts = { total: 0, new: 0, matched: 0, error: 0, conflict: 0, synced: 0, skipped: 0 }

  /** Combined local batch-status for every HQ under a month (or a month+department), for the tree table's Status column. */
  function scopeStatus(month: string, department?: string): { counts: BatchCounts; opened: number; total: number } | null {
    const scopeLeaves = leaves.filter((l) => l.month === month && (!department || l.department === department))
    const openedBatches = scopeLeaves
      .map((l) => batches.find((b) => b.id === ecubixBatchId(l.month, l.department, l.hq)))
      .filter((b) => b !== undefined)
    if (openedBatches.length === 0) return null
    const counts = openedBatches.reduce<BatchCounts>(
      (acc, b) => ({
        total: acc.total + b.counts.total,
        new: acc.new + b.counts.new,
        matched: acc.matched + b.counts.matched,
        error: acc.error + b.counts.error,
        conflict: acc.conflict + b.counts.conflict,
        synced: acc.synced + b.counts.synced,
        skipped: acc.skipped + b.counts.skipped,
      }),
      EMPTY_BATCH_COUNTS,
    )
    return { counts, opened: openedBatches.length, total: scopeLeaves.length }
  }

  function issueCount(r: LeafReconciliation): number {
    return r.unmappedCustomers.size + r.unmappedItems.size + r.deptHqMismatchCustomers.size + r.conflicts
  }

  /** Fetches sheet-vs-ERP reconciliation for every leaf in `scope` not already cached (or previously failed). */
  async function checkReconciliation(scope: ReconciliationLeafKey[], erpClient: ReturnType<typeof erpClientFrom>) {
    if (!erpClient) return
    const pending = scope.filter((l) => {
      const key = reconciliationKey(l)
      if (reconcileRequested.current.has(key)) return false
      reconcileRequested.current.add(key)
      return true
    })
    if (pending.length === 0) return
    setReconciling(true)
    try {
      const { results, failed } = await computeReconciliation(pending, erpClient, secondaryConfig.headerMap, masterMap, regexMap)
      if (results.size > 0) setReconciliation((prev) => new Map([...prev, ...results]))
      if (failed.length > 0) {
        // Allow a retry for just the leaves that actually failed — a flaky HQ
        // shouldn't leave the whole batch permanently stuck as "requested".
        for (const { leaf } of failed) reconcileRequested.current.delete(reconciliationKey(leaf))
        setError(errMsg(failed[0].error))
      } else {
        setError(null)
      }
    } finally {
      setReconciling(false)
    }
  }

  // Auto-check — no manual trigger: whenever the Department/HQ filter (or the
  // underlying leaf list) changes scope, fetch reconciliation for whatever in
  // that scope isn't cached yet. checkReconciliation's own request-dedup ref
  // makes this a no-op once everything in scope has already been fetched.
  useEffect(() => {
    if (!erp || filteredLeaves.length === 0) return
    void checkReconciliation(filteredLeaves, erp)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checkReconciliation is a stable closure over state already captured above
  }, [filteredLeaves, erp])

  const filteredComputed = filteredLeaves.filter((l) => reconciliation.has(reconciliationKey(l)))
  const scopeReconciliation = sumReconciliation(filteredComputed.map((l) => reconciliation.get(reconciliationKey(l))!))
  const scopeIssues = issueCount(scopeReconciliation)
  const scopeAllChecked = filteredLeaves.length > 0 && filteredComputed.length === filteredLeaves.length
  const scopeSyncedPct =
    scopeReconciliation.sheetSalesValue > 0
      ? Math.round((scopeReconciliation.matchedEqualValue / scopeReconciliation.sheetSalesValue) * 100)
      : 0

  // Per-item chips get a red issue count / green ✓; the "All X" chip always
  // shows a neutral count (it isn't itself an issue state) that goes
  // translucent-white when the chip is the active/selected one.
  function badgeFor(leavesForItem: typeof leaves, neutral = false): CarouselBadge | undefined {
    if (leavesForItem.length === 0) return undefined
    const computed = leavesForItem.filter((l) => reconciliation.has(reconciliationKey(l)))
    if (computed.length !== leavesForItem.length) return undefined
    const agg = sumReconciliation(computed.map((l) => reconciliation.get(reconciliationKey(l))!))
    const n = issueCount(agg)
    if (neutral) return { text: String(n), tone: 'neutral' }
    return n > 0 ? { text: String(n), tone: 'issue' } : { text: '✓', tone: 'ok' }
  }

  const allDeptBadge = badgeFor(leaves, true)
  const departmentBadges = new Map(
    departmentOptions.map((d) => [d.value, badgeFor(leaves.filter((l) => l.department === d.value))]),
  )
  const hqBadges = new Map(hqOptions.map((h) => [h.value, badgeFor(leaves.filter((l) => l.hq === h.value))]))

  /** Department → HQ breakdown of sheet/ERP values, for the reconciliation drill-down — only leaves already checked. */
  function valueBreakdown(field: 'secondary' | 'closing') {
    const groups = new Map<string, { hq: string; sheet: number; erp: number }[]>()
    for (const l of filteredComputed) {
      const r = reconciliation.get(reconciliationKey(l))!
      const sheet = field === 'secondary' ? r.sheetSalesValue : r.sheetClosingValue
      const erpVal = field === 'secondary' ? r.erpSalesValue : r.erpClosingValue
      const rows = groups.get(l.department) ?? []
      rows.push({ hq: l.hq.replace(/^HQ-/i, ''), sheet, erp: erpVal })
      groups.set(l.department, rows)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }

  // Title reflects the active Department/HQ filter — a selected department
  // replaces the month (it's the more specific scope), while HQ just adds on.
  const summaryTitleParts = [
    selectedDepartment ?? (selectedMonth ? monthLabel(selectedMonth) : ''),
    ...(selectedHq ? [selectedHq.replace(/^HQ-/i, '')] : []),
  ].filter(Boolean)
  const summaryTitle = `${summaryTitleParts.join(' · ')} · folder summary`

  return (
    <div>
      <PageHead
        title="Secondary"
        subtitle="Ecubix sales data · check & fix workspace"
        actions={
          <Button size="sm" disabled={!selectedMonth} onClick={() => selectedMonth && refreshMonth(selectedMonth)}>
            <RefreshIcon /> Update from Ecubix
          </Button>
        }
      />

      {error && (
        <Card className="mb-3.5 p-2.5 px-3.5 text-[12.5px] text-status-error">
          {error}{' '}
          <button type="button" className="ml-2 underline" onClick={() => setError(null)}>
            dismiss
          </button>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-15">
          <Spinner className="h-6 w-6" />
        </div>
      ) : !overview || overview.months.length === 0 ? (
        <Card className="p-7 text-center">
          <Muted>No Ecubix secondary-sales data has been imported yet.</Muted>
        </Card>
      ) : (
        <>
          <div className="mb-5.5 w-33">
            <Select
              className="h-9 font-semibold"
              icon={<CalendarIcon />}
              value={selectedMonth ?? ''}
              onValueChange={(v) => setSelectedMonth(v || null)}
              options={monthOptions}
            />
          </div>

          <Card>
            <div className="table-scroll">
              <table className="table-data">
                <thead>
                  <tr>
                    <th>Month / Department / HQ</th>
                    <th>Rows</th>
                    <th>Customers</th>
                    <th>Items</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isHq = r.kind === 'hq'
                    const isMonth = r.kind === 'month'
                    const hk = isHq ? hqKey(r.month, r.department!, r.hq!) : null
                    const existingBatch = isHq
                      ? batches.find((b) => b.id === ecubixBatchId(r.month, r.department!, r.hq!))
                      : undefined
                    return (
                      <tr
                        key={r.key}
                        className="clickable"
                        onClick={() => {
                          if (r.kind === 'month') toggleMonth(r.month)
                          else if (r.kind === 'department') toggleDepartment(r.month, r.department!)
                          else void openHq(r.month, r.department!, r.hq!)
                        }}
                      >
                        <td style={{ paddingLeft: `${14 + r.depth * 20}px` }}>
                          <span className="inline-flex items-center">
                            {/* Always reserve the arrow's slot (even for non-expandable HQ rows) so depth-based
                                indentation reads consistently instead of HQ rows visually crowding their department. */}
                            <span className="mr-1.5 inline-block w-3 text-text-faint">
                              {r.expandable ? (r.expanded ? '▾' : '▸') : ''}
                            </span>
                            {isMonth && <FolderIcon />}
                            <span className={isMonth ? 'ml-1.5 font-semibold' : undefined}>{r.label}</span>
                          </span>
                        </td>
                        <td className="text-[12.5px]">{fmt(r.metrics.rowCount)}</td>
                        <td className="text-[12.5px]">{r.customers === null ? '—' : fmt(r.customers)}</td>
                        <td className="text-[12.5px]">{r.items === null ? '—' : fmt(r.items)}</td>
                        <td>
                          {isHq ? (
                            busyHq === hk ? (
                              <span className="inline-flex items-center gap-1.5 text-[12px] text-text-muted">
                                <Spinner className="h-3 w-3" /> Opening…
                              </span>
                            ) : existingBatch ? (
                              <Chip className={statusTone(existingBatch.counts)}>{statusSummary(existingBatch.counts)}</Chip>
                            ) : (
                              <Chip className="text-text-faint bg-border/40">Not opened</Chip>
                            )
                          ) : (
                            (() => {
                              const status = scopeStatus(r.month, r.kind === 'department' ? r.department : undefined)
                              if (!status) return null
                              return (
                                <span className="inline-flex flex-wrap items-center gap-1.5">
                                  <Chip className={statusTone(status.counts)}>{statusSummary(status.counts)}</Chip>
                                  {status.opened < status.total && (
                                    <span className="text-[11px] text-text-faint">
                                      {status.opened}/{status.total} opened
                                    </span>
                                  )}
                                </span>
                              )
                            })()
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mt-4.5 overflow-hidden">
            <div className="flex items-center gap-2.5 border-b border-border px-4.5 py-3">
              <FolderIcon />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">{summaryTitle}</div>
                <div className="mt-0.5 text-[11.5px] text-text-muted">
                  {summaryCounts.departments} Department{summaryCounts.departments === 1 ? '' : 's'} · {summaryCounts.hqs} HQ
                  {summaryCounts.hqs === 1 ? '' : 's'} · {summaryCounts.reconciled} Reconciled
                </div>
              </div>
              {scopeAllChecked ? (
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.04em]',
                    scopeIssues > 0 ? 'bg-status-error-bg text-status-error' : 'bg-status-synced-bg text-status-synced',
                  )}
                >
                  {scopeIssues > 0 ? `${scopeIssues} ISSUE${scopeIssues === 1 ? '' : 'S'}` : 'ALL CLEAR'}
                </span>
              ) : reconciling ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] text-text-muted">
                  <Spinner className="h-3 w-3" /> Checking vs ERPNext
                  {filteredComputed.length > 0 && ` (${filteredComputed.length}/${filteredLeaves.length})`}
                </span>
              ) : !erp ? (
                <span className="shrink-0 text-[11px] text-text-faint">Connect ERPNext to check</span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4.5 py-2.5">
              <span className="mr-0.5 shrink-0 text-[10px] font-bold tracking-[0.06em] text-text-faint">DEPARTMENT</span>
              <ChipCarousel
                items={departmentOptions.map((d) => ({ ...d, badge: departmentBadges.get(d.value) }))}
                value={selectedDepartment}
                onChange={selectDepartment}
                allLabel="All departments"
                allBadge={allDeptBadge}
              />
              <span className="mx-1 h-4.5 w-px shrink-0 bg-border" />
              <span className="mr-0.5 shrink-0 text-[10px] font-bold tracking-[0.06em] text-text-faint">HQ</span>
              <ChipCarousel
                items={hqOptions.map((h) => ({ ...h, badge: hqBadges.get(h.value) }))}
                value={selectedHq}
                onChange={setSelectedHq}
                allLabel="All HQs"
                allBadge={allDeptBadge}
              />
              {filtersActive && (
                <button
                  type="button"
                  className="ml-auto shrink-0 text-[12px] text-text-muted underline"
                  onClick={() => {
                    setSelectedDepartment(null)
                    setSelectedHq(null)
                  }}
                >
                  Reset filters
                </button>
              )}
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5 p-3.5">
              <StatTile label="Rows" value={kpi ? fmt(kpi.metrics.rowCount) : '—'} />
              <StatTile label="Customers" value={kpi?.sets ? fmt(kpi.sets.stockists.size) : '—'} />
              <StatTile
                label="Value synced"
                value={scopeAllChecked ? `${scopeSyncedPct}%` : '—'}
                valueClassName={scopeAllChecked && scopeSyncedPct < 100 ? 'text-status-conflict' : undefined}
              />
              <StatTile
                label="Unmapped cust"
                value={scopeAllChecked ? fmt(scopeReconciliation.unmappedCustomers.size) : '—'}
                valueClassName={scopeAllChecked && scopeReconciliation.unmappedCustomers.size > 0 ? 'text-status-error' : undefined}
              />
              <StatTile
                label="Unmapped items"
                value={scopeAllChecked ? fmt(scopeReconciliation.unmappedItems.size) : '—'}
                valueClassName={scopeAllChecked && scopeReconciliation.unmappedItems.size > 0 ? 'text-status-error' : undefined}
              />
              <StatTile
                label="Dept/HQ mismatch"
                value={scopeAllChecked ? fmt(scopeReconciliation.deptHqMismatchCustomers.size) : '—'}
                valueClassName={
                  scopeAllChecked && scopeReconciliation.deptHqMismatchCustomers.size > 0 ? 'text-status-matched' : undefined
                }
              />
              <StatTile
                label="Conflicts"
                value={scopeAllChecked ? fmt(scopeReconciliation.conflicts) : '—'}
                valueClassName={scopeAllChecked && scopeReconciliation.conflicts > 0 ? 'text-status-conflict' : undefined}
              />
            </div>

            {filteredComputed.length > 0 && (
              <>
                <div className="px-4.5 pt-1 pb-2 text-[10px] font-bold tracking-[0.06em] text-text-faint">
                  VALUE RECONCILIATION · ECUBIX vs ERPNEXT
                </div>
                <div className="grid grid-cols-1 gap-3 px-4.5 pb-4.5 sm:grid-cols-2">
                  {(
                    [
                      { key: 'secondary' as const, label: 'Secondary value', sheet: scopeReconciliation.sheetSalesValue, erp: scopeReconciliation.erpSalesValue },
                      { key: 'closing' as const, label: 'Closing value', sheet: scopeReconciliation.sheetClosingValue, erp: scopeReconciliation.erpClosingValue },
                    ]
                  ).map((v) => {
                    const diff = Math.abs(v.sheet - v.erp)
                    return (
                      <button
                        key={v.key}
                        type="button"
                        className="cursor-pointer rounded-lg border border-border p-3.5 text-left hover:border-border-strong"
                        onClick={() => setExpandedValueCard(v.key)}
                      >
                        <div className="text-[11px] font-bold tracking-[0.04em] text-text-muted">{v.label.toUpperCase()}</div>
                        <div className="mt-2 flex items-baseline gap-4">
                          <div>
                            <div className="text-[9.5px] font-bold tracking-[0.05em] text-text-faint">ECUBIX</div>
                            <div className="text-[17px] font-bold">{fmtCurrency(v.sheet)}</div>
                          </div>
                          <div className="text-[15px] text-border-strong">→</div>
                          <div>
                            <div className="text-[9.5px] font-bold tracking-[0.05em] text-text-faint">ERPNEXT</div>
                            <div className="text-[17px] font-bold">{fmtCurrency(v.erp)}</div>
                          </div>
                          <div className="ml-auto text-right">
                            <div className="text-[9.5px] font-bold tracking-[0.05em] text-text-faint">DIFF</div>
                            <span
                              className={cn(
                                'mt-0.5 inline-block rounded-md px-2 py-0.5 text-xs font-bold',
                                diff > 0 ? 'bg-status-error-bg text-status-error' : 'bg-status-synced-bg text-status-synced',
                              )}
                            >
                              {fmtCurrency(diff)}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 text-[11px] font-semibold text-text-muted">
                          Click to see department → HQ breakdown →
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </Card>
        </>
      )}

      {expandedValueCard && (
        <ValueBreakdownDialog
          field={expandedValueCard}
          monthLabelText={selectedMonth ? monthLabel(selectedMonth) : ''}
          total={
            expandedValueCard === 'secondary'
              ? { sheet: scopeReconciliation.sheetSalesValue, erp: scopeReconciliation.erpSalesValue }
              : { sheet: scopeReconciliation.sheetClosingValue, erp: scopeReconciliation.erpClosingValue }
          }
          groups={valueBreakdown(expandedValueCard)}
          onClose={() => setExpandedValueCard(null)}
        />
      )}
    </div>
  )
}

function DiffCell({ sheet, erp, size = 'sm' }: { sheet: number; erp: number; size?: 'sm' | 'lg' }) {
  const diff = Math.abs(sheet - erp)
  const matched = diff === 0
  return (
    <span
      className={cn(
        'inline-block rounded-md font-bold',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        matched ? 'bg-status-synced-bg text-status-synced' : 'bg-status-error-bg text-status-error',
      )}
    >
      {matched ? 'Matched' : fmtCurrency(diff)}
    </span>
  )
}

function ValueBreakdownDialog({
  field,
  monthLabelText,
  total,
  groups,
  onClose,
}: {
  field: 'secondary' | 'closing'
  monthLabelText: string
  total: { sheet: number; erp: number }
  groups: [string, { hq: string; sheet: number; erp: number }[]][]
  onClose: () => void
}) {
  const label = field === 'secondary' ? 'Secondary value' : 'Closing value'

  return (
    <DialogRoot open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="flex w-[640px] max-h-[76vh] flex-col p-0">
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <DialogTitle className="mb-0 text-[15px]">
              {label} · {monthLabelText}
            </DialogTitle>
            <div className="mt-0.5 text-xs text-text-muted">Ecubix vs ERPNext, broken down by department → HQ</div>
          </div>
          <DialogClose className="cursor-pointer text-xl leading-none text-text-faint">×</DialogClose>
        </div>

        <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] gap-2 border-b border-border px-5 py-2.5 text-[10px] font-bold tracking-[0.05em] text-text-faint">
          <div>DEPARTMENT / HQ</div>
          <div className="text-right">ECUBIX</div>
          <div className="text-right">ERPNEXT</div>
          <div className="text-right">DIFF</div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {groups.length === 0 && <div className="px-5 py-7 text-center text-[12.5px] text-text-muted">No checked HQs in scope</div>}
          {groups.map(([department, hqs]) => {
            const deptTotal = hqs.reduce(
              (acc, h) => ({ sheet: acc.sheet + h.sheet, erp: acc.erp + h.erp }),
              { sheet: 0, erp: 0 },
            )
            return (
              <div key={department}>
                <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] items-center gap-2 border-b border-border bg-bg py-2.5 pr-5 pl-4 text-[12.5px]">
                  <div className="truncate font-bold">{department}</div>
                  <div className="text-right font-mono tabular-nums">{fmtCurrency(deptTotal.sheet)}</div>
                  <div className="text-right font-mono tabular-nums">{fmtCurrency(deptTotal.erp)}</div>
                  <div className="text-right">
                    <DiffCell sheet={deptTotal.sheet} erp={deptTotal.erp} />
                  </div>
                </div>
                {hqs.map((h) => (
                  <div
                    key={h.hq}
                    className="grid grid-cols-[1.6fr_1fr_1fr_1fr] items-center gap-2 border-b border-border py-2.5 pr-5 pl-9 text-[12.5px]"
                  >
                    <div className="truncate">{h.hq}</div>
                    <div className="text-right font-mono tabular-nums">{fmtCurrency(h.sheet)}</div>
                    <div className="text-right font-mono tabular-nums">{fmtCurrency(h.erp)}</div>
                    <div className="text-right">
                      <DiffCell sheet={h.sheet} erp={h.erp} />
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] items-center gap-2 border-t border-border bg-bg px-5 py-3.5 text-[13px] font-bold">
          <div>Total</div>
          <div className="text-right font-mono tabular-nums">{fmtCurrency(total.sheet)}</div>
          <div className="text-right font-mono tabular-nums">{fmtCurrency(total.erp)}</div>
          <div className="text-right">
            <DiffCell sheet={total.sheet} erp={total.erp} size="lg" />
          </div>
        </div>
      </DialogPopup>
    </DialogRoot>
  )
}
