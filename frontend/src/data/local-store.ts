import { SEED_ROWS } from './seed'
import type { EntryRow, ShiftSchedule } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// v2：二次管网改为真实字段（数值型巡线周期、核定状态）并新增站点巡检「待整改」态。
const STORAGE_KEY = 'district-heating:entries:v2'
const SHIFT_STORAGE_KEY = 'district-heating:patrol-shift:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 巡线班长每周排一次班：按 ISO 周（年-周序）存一条，重复排同一周取不到新记录。
function readShifts(): ShiftSchedule[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(SHIFT_STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    return JSON.parse(raw) as ShiftSchedule[]
  } catch {
    return []
  }
}

export function listShifts(): ShiftSchedule[] {
  return readShifts().sort((a, b) => (a.weekKey < b.weekKey ? 1 : -1))
}

export function findShift(weekKey: string): ShiftSchedule | undefined {
  return readShifts().find((item) => item.weekKey === weekKey)
}

export function saveShift(schedule: ShiftSchedule): void {
  const next = readShifts().filter((item) => item.weekKey !== schedule.weekKey)
  next.push(schedule)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(SHIFT_STORAGE_KEY, JSON.stringify(next))
  }
}
