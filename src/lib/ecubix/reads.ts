// One-shot reads of the `ecubix/secondary` rollup tree (see
// scripts/import-ecubix-secondary.mjs for the write side / schema doc).
// Matches the rest of the app's convention (persistence.ts): plain
// getDoc/getDocs, no onSnapshot.

import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { db } from '../firebase'

export const SUMMARY_KEY = '#__SUMMARY__#'

export interface EcubixMetrics {
  rowCount: number
  openingQty: number
  secondaryQty: number
  secondaryVal: number
  closingQty: number
  closingVal: number
}

export interface SecondaryOverview {
  months: string[]
  monthMetrics: Record<string, EcubixMetrics>
}

export interface MonthDepartments {
  departments: string[]
  departmentMetrics: Record<string, EcubixMetrics>
}

export interface DepartmentHqs {
  hqs: string[]
  hqMetrics: Record<string, EcubixMetrics>
}

export interface HqSummary {
  stockists: string[]
  stockistMetrics: Record<string, EcubixMetrics>
  products: string[]
  productMetrics: Record<string, EcubixMetrics>
}

const EMPTY_OVERVIEW: SecondaryOverview = { months: [], monthMetrics: {} }
const EMPTY_MONTH: MonthDepartments = { departments: [], departmentMetrics: {} }
const EMPTY_DEPARTMENT: DepartmentHqs = { hqs: [], hqMetrics: {} }
const EMPTY_HQ: HqSummary = { stockists: [], stockistMetrics: {}, products: [], productMetrics: {} }

export async function getSecondaryOverview(): Promise<SecondaryOverview> {
  const snap = await getDoc(doc(db, 'ecubix', 'secondary'))
  return (snap.data()?.[SUMMARY_KEY] as SecondaryOverview | undefined) ?? EMPTY_OVERVIEW
}

export async function getMonthDepartments(month: string): Promise<MonthDepartments> {
  const snap = await getDoc(doc(db, 'ecubix', 'secondary', month, SUMMARY_KEY))
  return (snap.data() as MonthDepartments | undefined) ?? EMPTY_MONTH
}

export async function getDepartmentHqs(month: string, department: string): Promise<DepartmentHqs> {
  const snap = await getDoc(doc(db, 'ecubix', 'secondary', month, department))
  return (snap.data()?.[SUMMARY_KEY] as DepartmentHqs | undefined) ?? EMPTY_DEPARTMENT
}

export async function getHqSummary(month: string, department: string, hqCollection: string): Promise<HqSummary> {
  const snap = await getDoc(doc(db, 'ecubix', 'secondary', month, department, hqCollection, SUMMARY_KEY))
  return (snap.data() as HqSummary | undefined) ?? EMPTY_HQ
}

/** Raw sheet rows for one HQ collection (excludes the `#__SUMMARY__#` doc) — used only to build a batch, never by the browse UI. */
export async function getHqRawRows(
  month: string,
  department: string,
  hqCollection: string,
): Promise<Record<string, string | number | null>[]> {
  const snap = await getDocs(collection(db, 'ecubix', 'secondary', month, department, hqCollection))
  return snap.docs.filter((d) => d.id !== SUMMARY_KEY).map((d) => d.data() as Record<string, string | number | null>)
}
