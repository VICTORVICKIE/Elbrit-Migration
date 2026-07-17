'use client'

import { Fragment, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { buildMasterMap, useAppStore } from '../../data/appStore'
import { slugify } from '../../data/slug'
import { validateRow } from '../../engine/validateRow'
import { DriveClient } from '../../lib/drive/client'
import { bestFuzzyMatch, FUZZY_MATCH_THRESHOLD } from '../../lib/fuzzyMatch'
import { parseWorkbook } from '../../lib/xlsx/parseWorkbook'
import type { Batch, DriveFile } from '../../types'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { SearchableSelect } from '../../ui/Combobox'
import { Input } from '../../ui/Field'
import { OutlineChip } from '../../ui/Chip'
import { Spinner } from '../../ui/Spinner'
import { Faint, Muted } from '../../ui/Text'
import { erpClientFrom, fetchDepartmentsAndTerritories, fetchErpSnapshot } from './erpActions'

const MONTH_RE = /^\d{4}-\d{2}$/

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

/** "July 26" / "July 2026" → "2026-07"; 2-digit years assumed 2000s. */
function parseMonthLabel(label: string): string | null {
  const m = label.trim().match(/^([A-Za-z]+)\s+(\d{2,4})$/)
  if (!m) return null
  const monthIdx = MONTH_NAMES.indexOf(m[1].toLowerCase())
  if (monthIdx === -1) return null
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}`
}

/**
 * Batch tags (department/HQ/month) pre-filled from a Drive file's path, e.g.
 * "July 26 / Aura & Proxima / HQ-Chennai.xlsx" (folder nesting or literal
 * "/"-separated file name, either works — folderPath + name are joined and
 * re-split). Department/HQ segments are fuzzy-matched against the ERP
 * Department/Territory lists so the exact ERP spelling ends up selected.
 */
function tagsFromFilePath(
  file: DriveFile,
  erpLists: { departments: string[]; territories: string[] } | null,
): { dept: string; hq: string; month: string } | null {
  const withoutExt = file.name.replace(/\.[^./]+$/, '')
  const parts = [file.folderPath, withoutExt]
    .filter(Boolean)
    .join('/')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 3) return null
  const [monthPart, deptPart, hqPart] = parts.slice(-3)
  const month = parseMonthLabel(monthPart)
  if (!month || !erpLists) return null
  const deptMatch = bestFuzzyMatch(deptPart, erpLists.departments)
  const hqMatch = bestFuzzyMatch(hqPart, erpLists.territories)
  return {
    month,
    dept: deptMatch && deptMatch.score >= FUZZY_MATCH_THRESHOLD ? deptMatch.value : '',
    hq: hqMatch && hqMatch.score >= FUZZY_MATCH_THRESHOLD ? hqMatch.value : '',
  }
}

export function SheetPicker() {
  const router = useRouter()
  const { credentials, secondaryConfig, batches, masterMap, regexMap, saveBatch, putRows, openBatch, setErpSnapshot } =
    useAppStore(
      useShallow((s) => ({
        credentials: s.credentials,
        secondaryConfig: s.secondaryConfig,
        batches: s.batches,
        masterMap: s.masterMap,
        regexMap: s.regexMap,
        saveBatch: s.saveBatch,
        putRows: s.putRows,
        openBatch: s.openBatch,
        setErpSnapshot: s.setErpSnapshot,
      })),
    )

  const [files, setFiles] = useState<DriveFile[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [driveError, setDriveError] = useState<string | null>(null)
  const [batchErrors, setBatchErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  // batch-tag draft per file id, until it's turned into a real Batch
  const [draft, setDraft] = useState<Record<string, { dept: string; hq: string; month: string }>>({})
  const [erpLists, setErpLists] = useState<{ departments: string[]; territories: string[] } | null>(null)
  const [erpListsError, setErpListsError] = useState<string | null>(null)
  // driveFileId of the already-tagged row currently being re-tagged, if any
  const [editingFileId, setEditingFileId] = useState<string | null>(null)
  const [savingEditId, setSavingEditId] = useState<string | null>(null)

  const driveReady = Boolean(credentials.drive.clientId && credentials.drive.folderId)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!driveReady) {
        setFiles([])
        return
      }
      setLoading(true)
      setDriveError(null)
      try {
        const client = new DriveClient(credentials.drive.clientId)
        const list = await client.listFolder(credentials.drive.folderId)
        if (!cancelled) setFiles(list)
      } catch (e) {
        if (!cancelled) {
          setDriveError(e instanceof Error ? e.message : String(e))
          setFiles([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [driveReady, credentials.drive.clientId, credentials.drive.folderId])

  useEffect(() => {
    let cancelled = false
    const erp = erpClientFrom(credentials)
    if (!erp) {
      setErpLists(null)
      return
    }
    setErpListsError(null)
    fetchDepartmentsAndTerritories(erp)
      .then((r) => {
        if (!cancelled) setErpLists(r)
      })
      .catch((e) => {
        if (!cancelled) setErpListsError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [credentials.erpnext.baseUrl, credentials.erpnext.apiKey, credentials.erpnext.apiSecret])

  // Pre-fill the tag draft from the file's path/name when it follows the
  // "<month> / <department> / <HQ>.xlsx" convention. Never overwrites a
  // draft the user has already touched (manually or from a prior prefill).
  useEffect(() => {
    if (!files || files.length === 0) return
    setDraft((d) => {
      let changed = false
      const next = { ...d }
      for (const f of files) {
        if (batches.some((b) => b.driveFileId === f.id)) continue
        const existingDraft = d[f.id]
        if (existingDraft && (existingDraft.dept || existingDraft.hq || existingDraft.month)) continue
        const parsed = tagsFromFilePath(f, erpLists)
        if (!parsed) continue
        next[f.id] = parsed
        changed = true
      }
      return changed ? next : d
    })
  }, [files, erpLists, batches])

  function draftFor(fileId: string) {
    return draft[fileId] ?? { dept: '', hq: '', month: '' }
  }

  function setDraftField(fileId: string, patch: Partial<{ dept: string; hq: string; month: string }>) {
    setDraft((d) => ({ ...d, [fileId]: { ...draftFor(fileId), ...patch } }))
  }

  function setBatchError(fileId: string, message: string | null) {
    setBatchErrors((prev) => {
      const next = { ...prev }
      if (message) next[fileId] = message
      else delete next[fileId]
      return next
    })
  }

  async function startBatch(file: DriveFile) {
    const log = (...args: unknown[]) => console.log('[startBatch]', file.name, ...args)
    log('clicked')
    setBusy(file.id)
    setBatchError(file.id, null)
    try {
      const existing = batches.find((b) => b.driveFileId === file.id)

      // Reopening an already-tagged batch just loads its saved rows — no
      // re-download/re-parse/re-validate. Use "↻ Reconcile" on the
      // batch page if you need to re-pull from Drive.
      if (existing) {
        log('reopening existing batch', existing.id)
        await openBatch(existing.id)
        router.push(`/secondary/${existing.id}`)
        return
      }

      const sel = draftFor(file.id)
      const department = sel.dept
      const hq = sel.hq
      const month = sel.month
      log('batch tag', { department, hq, month })
      if (!department) {
        setBatchError(file.id, 'Select a department before opening this sheet.')
        return
      }
      if (!MONTH_RE.test(month)) {
        setBatchError(file.id, 'Enter the month as yyyy-mm (e.g. 2026-06) before opening this sheet.')
        return
      }

      const batchId = ['batch', slugify(department), hq ? slugify(hq) : null, month, file.id].filter(Boolean).join('-')
      log('batchId resolved', { batchId })

      log('downloading xlsx from Drive…')
      const client = new DriveClient(credentials.drive.clientId)
      const buffer = await client.downloadXlsx(file)
      log('download complete, bytes:', buffer.byteLength)

      log('parsing workbook…')
      const parsed = parseWorkbook(buffer, secondaryConfig.headerMap, `${month}-01`)
      log('parsed', { headerRowIndex: parsed.headerRowIndex, missingHeaders: parsed.missingHeaders, rowCount: parsed.rows.length })
      if (parsed.headerRowIndex === -1) {
        log('header row not found — stopping')
        setBatchError(
          file.id,
          `Could not find the header row in "${file.name}". Check Settings → Secondary config → header map.`,
        )
        return
      }
      if (parsed.missingHeaders.length > 0) {
        log('missing headers — stopping', parsed.missingHeaders)
        setBatchError(file.id, `Headers not found in sheet: ${parsed.missingHeaders.join(', ')}. Check Settings → Secondary config.`)
        return
      }
      let rows = parsed.rows

      // prefetch ERP snapshot when connected, then validate
      const erp = erpClientFrom(credentials)
      log('ERPNext client', erp ? 'connected — will validate against ERP' : 'not configured — skipping ERP validation')
      if (erp) {
        const masterMapCtx = buildMasterMap(masterMap)
        const confirmedDistributors = Object.fromEntries(masterMapCtx.get('distributor') ?? [])
        const ebsCodeErpFields = secondaryConfig.headerMap.find((h) => h.field === 'ebsCode')?.erpFields ?? []
        const ebsCodes = [...new Set(rows.map((r) => r.ebsCode).filter((c): c is string => Boolean(c)))]
        log('fetching ERP snapshot for EBS codes', ebsCodes)
        const snapshot = await fetchErpSnapshot(erp, ebsCodes, ebsCodeErpFields, confirmedDistributors, month)
        log('ERP snapshot fetched', { items: snapshot.items.size, existingDocs: snapshot.existing.size })
        setErpSnapshot(snapshot.items, snapshot.customers, snapshot.existing, snapshot.customerProfiles)
        const ctx = {
          masterMap: masterMapCtx,
          regexMap,
          erpItemsIndex: snapshot.items,
          erpCustomersIndex: snapshot.customers,
          erpExisting: snapshot.existing,
          customerProfiles: snapshot.customerProfiles,
          batchHq: hq,
          batchDepartment: department,
          hasErpSnapshot: true,
        }
        rows = rows.map((r) => validateRow(r, ctx))
        log('rows validated against ERP')
      }

      const batch: Batch = {
        id: batchId,
        datatype: 'secondary',
        driveFileId: file.id,
        fileName: file.name,
        fileModifiedTime: file.modifiedTime,
        department,
        hq,
        month,
        status: 'checking',
        counts: { total: 0, new: 0, matched: 0, error: 0, conflict: 0, synced: 0, skipped: 0 },
        createdBy: useAppStore.getState().uid,
        createdAt: new Date().toISOString(),
        lastRunAt: null,
      }
      log('saving batch to Firestore…', batch)
      await saveBatch(batch)
      log('batch saved, saving rows…', rows.length)
      await putRows(batchId, rows, true)
      log('rows saved, opening batch…')
      await openBatch(batchId)
      log('navigating to', `/secondary/${batchId}`)
      router.push(`/secondary/${batchId}`)
      log('done')
    } catch (e) {
      console.error('[startBatch]', file.name, 'failed', e)
      setBatchError(file.id, e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  function startEdit(existing: Batch) {
    setDraft((d) => ({ ...d, [existing.driveFileId]: { dept: existing.department, hq: existing.hq, month: existing.month } }))
    setBatchError(existing.driveFileId, null)
    setEditingFileId(existing.driveFileId)
  }

  async function saveEdit(existing: Batch) {
    const sel = draftFor(existing.driveFileId)
    if (!sel.dept) {
      setBatchError(existing.driveFileId, 'Select a department before saving.')
      return
    }
    if (!MONTH_RE.test(sel.month)) {
      setBatchError(existing.driveFileId, 'Enter the month as yyyy-mm (e.g. 2026-06) before saving.')
      return
    }
    setSavingEditId(existing.driveFileId)
    await saveBatch({ ...existing, department: sel.dept, hq: sel.hq, month: sel.month })
    setSavingEditId(null)
    setEditingFileId(null)
  }

  return (
    <div>
      <Card>
        <div className="p-3.5 font-semibold">Pick a sheet from the Drive migration folder</div>
        {!driveReady && (
          <Muted className="block px-4 pb-4 text-[12.5px]">
            Google Drive is not configured. Add the OAuth client ID and folder ID in Settings.
          </Muted>
        )}
        {driveReady && !erpLists && !erpListsError && (
          <Muted className="block px-4 pb-4 text-[12.5px]">
            Connect ERPNext in Settings to load Department/Territory options for tagging.
          </Muted>
        )}
        {erpListsError && (
          <p className="px-4 pb-4 text-[12.5px] text-status-error">
            Could not load Department/Territory from ERPNext: {erpListsError}
          </p>
        )}
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-15">
            <Spinner className="h-6 w-6" />
            <Muted className="text-[12.5px]">Loading spreadsheets from Drive…</Muted>
          </div>
        ) : (
        <div className="table-scroll">
          <table className="table-data">
            <thead>
              <tr>
                <th>File</th>
                <th>Batch</th>
                <th>Modified</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(files ?? []).map((f) => {
                const existing = batches.find((b) => b.driveFileId === f.id)
                const isEditing = Boolean(existing) && editingFileId === f.id
                const d = draftFor(f.id)
                const rowError = batchErrors[f.id]
                return (
                  <Fragment key={f.id}>
                    <tr>
                      <td className="mono text-[12.5px]">
                        {f.folderPath && <Faint>{f.folderPath}/</Faint>}
                        {f.name}
                      </td>
                      <td className="text-[12.5px]">
                        {existing && !isEditing ? (
                          <span className="inline-flex items-center gap-1.5">
                            <OutlineChip active>{existing.department}</OutlineChip>
                            {existing.hq && <OutlineChip active>{existing.hq}</OutlineChip>}
                            <OutlineChip active>{existing.month}</OutlineChip>
                            <button
                              type="button"
                              className="text-[12px] text-text-muted underline"
                              onClick={() => startEdit(existing)}
                            >
                              Edit
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex gap-1.5">
                            <SearchableSelect
                              className="w-40"
                              value={d.dept}
                              disabled={!erpLists}
                              placeholder="Department…"
                              onValueChange={(v) => setDraftField(f.id, { dept: v })}
                              options={(erpLists?.departments ?? []).map((name) => ({ value: name, label: name }))}
                            />
                            <SearchableSelect
                              className="w-35"
                              value={d.hq}
                              disabled={!erpLists}
                              placeholder="Territory (HQ)…"
                              onValueChange={(v) => setDraftField(f.id, { hq: v })}
                              options={(erpLists?.territories ?? []).map((name) => ({ value: name, label: name }))}
                            />
                            <Input
                              className="w-22 px-2 py-1"
                              placeholder="2026-06"
                              value={d.month}
                              onChange={(e) => setDraftField(f.id, { month: e.target.value })}
                            />
                            {isEditing && existing && (
                              <>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  disabled={savingEditId === existing.driveFileId}
                                  onClick={() => void saveEdit(existing)}
                                >
                                  {savingEditId === existing.driveFileId ? 'Saving…' : 'Save'}
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={savingEditId === existing.driveFileId}
                                  onClick={() => setEditingFileId(null)}
                                >
                                  Cancel
                                </Button>
                              </>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="text-[12.5px] text-text-muted">
                        {new Date(f.modifiedTime).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="text-right">
                        {existing ? (
                          <Button size="sm" disabled={isEditing || busy !== null} onClick={() => void startBatch(f)}>
                            {busy === f.id ? 'Opening…' : 'Reopen'}
                          </Button>
                        ) : (
                          <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => void startBatch(f)}>
                            {busy === f.id ? 'Opening…' : 'Open'}
                          </Button>
                        )}
                      </td>
                    </tr>
                    {rowError && (
                      <tr>
                        <td colSpan={4} className="pb-3">
                          <pre className="mono m-0 rounded-md border border-status-error bg-surface p-2.5 text-xs whitespace-pre-wrap break-words text-status-error">
                            {rowError}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {driveError && (
                <tr>
                  <td colSpan={4} className="py-7 text-center text-status-error">
                    Couldn&apos;t load the Drive folder
                  </td>
                </tr>
              )}
              {!driveError && files !== null && files.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-7 text-center text-text-muted">
                    No spreadsheets found in the migration folder
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
        {driveError && (
          <pre className="mono m-4 rounded-md border border-status-error bg-surface p-3 text-xs whitespace-pre-wrap break-words text-status-error">
            {driveError}
          </pre>
        )}
      </Card>
    </div>
  )
}
