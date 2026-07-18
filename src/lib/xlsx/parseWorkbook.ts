import * as XLSX from 'xlsx'
import type { HeaderMapEntry, MigrationRow } from '../../types'

export interface ParseResult {
  rows: MigrationRow[]
  headerRowIndex: number
  missingHeaders: string[] // configured headers not found → batch-level config error
  /** Batch metadata read from sheet columns (Ecubix PriSecStockist layout). */
  meta: {
    states: string[] // unique State values (dept tokens)
    months: string[] // unique parsed months (yyyy-mm)
    hqs: string[] // unique HQ values
    skippedSubtotals: number
  }
}

/** Subtotal/footer rows: "EBS626 Total", "Kurnool Total", "Grand Total". */
export function isSubtotalRow(raw: Record<string, string | number | null>): boolean {
  const cells = [raw['state'], raw['ebsCode'], raw['hq'], raw['customerName']]
  // Assumes one file covers a single month, so an empty/unmatched "Month"
  // column (which some sheet layouts omit entirely) can't be used as a
  // footer signal — only the "...Total" text pattern identifies footers.
  return cells.some((c) => typeof c === 'string' && /(^|\s)(grand\s+)?total$/i.test(c.trim()))
}

const MONTHS_ABBR: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

/** "Jun-26" / "June 2026" → "2026-06" (falls back to the raw string on failure). */
export function parseMonthCell(v: unknown): string | null {
  const m = String(v ?? '').trim().toLowerCase().match(/^([a-z]{3,9})[\s-]?(\d{2}|\d{4})$/)
  if (!m) return null
  const mm = MONTHS_ABBR[m[1].slice(0, 3)]
  if (!mm) return null
  return `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${mm}`
}

function normHeader(h: unknown): string {
  return String(h ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function coerce(value: unknown, type: HeaderMapEntry['type']): string | number | null {
  if (value === null || value === undefined || value === '') return null
  switch (type) {
    case 'int': {
      const n = parseInt(String(value).replace(/,/g, ''), 10)
      return Number.isNaN(n) ? null : n
    }
    case 'currency': {
      const n = parseFloat(String(value).replace(/,/g, ''))
      return Number.isNaN(n) ? null : Math.round(n * 100) / 100
    }
    case 'date': {
      if (value instanceof Date) return value.toISOString().slice(0, 10)
      const d = new Date(String(value))
      return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10)
    }
    default:
      return String(value).trim()
  }
}

/**
 * Build one MigrationRow from an already-coerced `raw` record (keyed by
 * HeaderMapField). Shared by the grid-based xlsx parser below and the
 * ecubix-Firestore row builder (src/features/secondary/ecubixBatch.ts) — the
 * two differ only in how `raw`/`hq`/`date` are produced, not in the
 * MigrationRow shape itself.
 */
export function buildMigrationRowFromRaw(
  raw: Record<string, string | number | null>,
  rowIndex: number,
  opts: { hq: string; date: string },
): MigrationRow {
  const num = (f: string) => (typeof raw[f] === 'number' ? (raw[f] as number) : null)
  return {
    id: `row-${rowIndex}`,
    rowIndex,
    raw,
    ebsCode: String(raw['ebsCode'] ?? '').trim(),
    customerName: String(raw['customerName'] ?? '').trim(),
    // Ecubix pads product names with trailing dots/spaces
    itemName: String(raw['itemName'] ?? '').trim().replace(/[.\s]+$/, ''),
    hq: opts.hq,
    resolved: {
      distributor: null,
      item: null,
      date: opts.date,
      roleProfile: null,
      department: null,
      erpHq: null,
    },
    values: {
      opening_qty: num('opening_qty'),
      primary_sales: num('primary_sales'),
      rate: num('rate'),
      sales_qty: num('sales_qty'),
      sales_value: num('sales_value'),
      closing_qty: num('closing_qty'),
      closing_balance: num('closing_balance'),
    },
    state: 'new',
    issues: [],
    diff: [],
    erpDocName: null,
    resolution: null,
    push: { attempts: 0, lastError: null, lastAt: null },
    validate: { ok: null, mismatches: [], at: null },
  }
}

/**
 * Parse an Ecubix xlsx export into MigrationRows using the config-driven
 * header map. The header row is auto-detected: first row where at least half
 * of the configured headers match (Ecubix exports often have title rows).
 */
export function parseWorkbook(
  buffer: ArrayBuffer,
  headerMap: HeaderMapEntry[],
  defaultDate: string, // yyyy-mm-dd fallback when dateSource = filename
): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const grid: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  // Rows without a configured sheet header aren't set up yet — exclude them
  // from header-row detection and column lookup.
  const mappedHeaderMap = headerMap.filter((h) => h.sheetHeader.trim())
  const wanted = mappedHeaderMap.map((h) => normHeader(h.sheetHeader))

  let headerRowIndex = -1
  let colIndex = new Map<string, number>() // field → column
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const cells = (grid[r] ?? []).map(normHeader)
    const found = new Map<string, number>()
    mappedHeaderMap.forEach((entry, i) => {
      const c = cells.indexOf(wanted[i])
      if (c !== -1) found.set(entry.field, c)
    })
    if (found.size >= Math.ceil(mappedHeaderMap.length / 2)) {
      headerRowIndex = r
      colIndex = found
      break
    }
  }

  if (headerRowIndex === -1) {
    return {
      rows: [],
      headerRowIndex: -1,
      missingHeaders: mappedHeaderMap.map((h) => h.sheetHeader),
      meta: { states: [], months: [], hqs: [], skippedSubtotals: 0 },
    }
  }

  const missingHeaders = mappedHeaderMap
    .filter((h) => h.required && !colIndex.has(h.field))
    .map((h) => h.sheetHeader)

  const rows: MigrationRow[] = []
  const states = new Set<string>()
  const months = new Set<string>()
  const hqs = new Set<string>()
  let skippedSubtotals = 0

  for (let r = headerRowIndex + 1; r < grid.length; r++) {
    const line = grid[r]
    if (!line || line.every((c) => c === null || c === '')) continue

    const raw: Record<string, string | number | null> = {}
    for (const entry of mappedHeaderMap) {
      const c = colIndex.get(entry.field)
      raw[entry.field] = c === undefined ? null : coerce(line[c], entry.type)
    }

    if (isSubtotalRow(raw)) {
      skippedSubtotals++
      continue
    }

    const month = parseMonthCell(raw['month'])
    const state = String(raw['state'] ?? '').trim()
    const hq = String(raw['hq'] ?? '').trim()
    if (state) states.add(state)
    if (month) months.add(month)
    if (hq) hqs.add(hq)

    rows.push(buildMigrationRowFromRaw(raw, r + 1, { hq, date: month ? `${month}-01` : defaultDate }))
  }

  return {
    rows,
    headerRowIndex,
    missingHeaders,
    meta: { states: [...states], months: [...months], hqs: [...hqs], skippedSubtotals },
  }
}
