import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  PatrolCompleteInput,
  PatrolFilterBlocker,
  PatrolListResult,
  PatrolQuery,
  ScheduleResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 二次管网敷设方式的固定选项，条件区做多选用。
export const LAYING_METHODS = ['直埋敷设', '管沟敷设', '架空敷设', '套管敷设']

// 投运日期与巡线周期只认巡线班长的核定。
export const PATROL_APPROVER = '巡线班长'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function rowText(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

function keywordHit(rows: EntryRow[], field: string, keyword: string): EntryRow[] {
  const key = keyword.trim()
  if (!key) {
    return rows
  }
  return rows.filter((row) => rowText(row, field).includes(key))
}

function dayIndex(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return NaN
  }
  const [year, month, day] = value.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

// 巡线周期按起止区间取：计划周期与查询区间有重叠就算落在区间内；只填一边按开放区间处理。
function periodHit(row: EntryRow, start: string, end: string): boolean {
  const rowStart = dayIndex(rowText(row, '周期开始'))
  const rowEnd = dayIndex(rowText(row, '周期结束'))
  if (Number.isNaN(rowStart) || Number.isNaN(rowEnd)) {
    return false
  }
  if (!Number.isNaN(dayIndex(start)) && rowEnd < dayIndex(start)) {
    return false
  }
  if (!Number.isNaN(dayIndex(end)) && rowStart > dayIndex(end)) {
    return false
  }
  return true
}

// 条件定位：各栏条件叠加取交集；每一栏单独统计命中数，最终为空时据此讲清卡在哪一栏。
export function listPatrolPlans(query: PatrolQuery = {}): PatrolListResult {
  const source = listRows('patrolplan')
  const blockers: PatrolFilterBlocker[] = []
  let rows = source

  const pipeKeyword = query.管段编号 ?? ''
  if (pipeKeyword.trim()) {
    rows = keywordHit(rows, '管段编号', pipeKeyword)
    blockers.push({ field: '管段编号', expected: pipeKeyword.trim(), matched: rows.length })
  }
  const wellKeyword = query.阀门井编号 ?? ''
  if (wellKeyword.trim()) {
    rows = keywordHit(rows, '阀门井编号', wellKeyword)
    blockers.push({ field: '阀门井编号', expected: wellKeyword.trim(), matched: rows.length })
  }
  const areaKeyword = query.所属片区 ?? ''
  if (areaKeyword.trim()) {
    rows = keywordHit(rows, '所属片区', areaKeyword)
    blockers.push({ field: '所属片区', expected: areaKeyword.trim(), matched: rows.length })
  }
  const methods = (query.敷设方式 ?? []).filter((item) => item.trim() !== '')
  if (methods.length > 0) {
    rows = rows.filter((row) =>
      methods.some((method) => rowText(row, '敷设方式').split('/').includes(method)),
    )
    blockers.push({ field: '敷设方式', expected: methods.join('、'), matched: rows.length })
  }
  const start = query.周期开始 ?? ''
  const end = query.周期结束 ?? ''
  if (start || end) {
    const expected = start && end ? `${start} 至 ${end}` : start ? `${start} 起` : `截至 ${end}`
    rows = rows.filter((row) => periodHit(row, start, end))
    blockers.push({ field: '巡线周期', expected, matched: rows.length })
  }

  const sorted = [...rows]
  if (query.排序 === '周期开始-asc' || query.排序 === '周期开始-desc') {
    const direction = query.排序 === '周期开始-asc' ? 1 : -1
    sorted.sort((a, b) => {
      const aDay = dayIndex(rowText(a, '周期开始'))
      const bDay = dayIndex(rowText(b, '周期开始'))
      const aValue = Number.isNaN(aDay) ? Number.POSITIVE_INFINITY : aDay
      const bValue = Number.isNaN(bDay) ? Number.POSITIVE_INFINITY : bDay
      return (aValue - bValue) * direction
    })
  }

  let message = ''
  if (sorted.length === 0 && blockers.length > 0) {
    const dead = blockers.filter((item) => item.matched === 0)
    if (dead.length > 0) {
      message = `没有命中：卡在${dead.map((item) => `「${item.field}」(${item.expected})`).join('、')}这一栏，这一栏单独就查不到计划，先放宽这一栏。`
    } else {
      message = '每一栏单独都有命中，但条件叠加取交集后为空：请逐项减少条件，定位是哪两栏互相冲突。'
    }
  }
  return { items: sorted, total: sorted.length, blockers, message }
}

// 按阀门井编号分片展示巡线计划。
export function groupPatrolPlansByWell(rows: EntryRow[]): { well: string; items: EntryRow[] }[] {
  const map = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const well = rowText(row, '阀门井编号')
    const bucket = map.get(well)
    if (bucket) {
      bucket.push(row)
    } else {
      map.set(well, [row])
    }
  }
  return [...map.entries()]
    .map(([well, items]) => ({ well, items }))
    .sort((a, b) => a.well.localeCompare(b.well, 'zh-Hans-CN'))
}

type WeekInfo = { year: number; week: number; tag: string; monday: string; sunday: string }

// ISO-8601 周：周一到周日，用来判断计划区间是不是落在同一个自然周。
function isoWeekInfo(dateText: string): WeekInfo | null {
  const date = new Date(`${dateText}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  const day = (date.getUTCDay() + 6) % 7
  const thursday = new Date(date)
  thursday.setUTCDate(date.getUTCDate() - day + 3)
  const year = thursday.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(year, 0, 4))
  firstThursday.setUTCDate(4 - ((firstThursday.getUTCDay() + 6) % 7))
  const week =
    1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000))
  const pad = (value: number) => String(value).padStart(2, '0')
  const monday = new Date(date)
  monday.setUTCDate(date.getUTCDate() - day)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  return { year, week, tag: `${year}-W${pad(week)}`, monday: fmt(monday), sunday: fmt(sunday) }
}

export function currentWeekTag(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-W${pad(isoWeekInfo(date.toISOString().slice(0, 10))?.week ?? 0)}`
}

// 巡线班长每周排一次班：同一阀门井同一周已有计划的整批挡回。
// 起止区间必须成对给出，且只能落在同一个自然周，跨周或缺一边都不予受理。
export function scheduleWeekPatrol(
  start: string,
  end: string,
  inspector: string,
  approver: string,
): ScheduleResult {
  const empty: ScheduleResult = {
    ok: false,
    message: '',
    created: [],
    weekTag: '',
    skippedUnapproved: 0,
    skippedAbandoned: 0,
  }
  if (!start || !end) {
    return { ...empty, message: '起止区间缺失不予受理：周期开始与周期结束必须成对填写。' }
  }
  const startInfo = isoWeekInfo(start)
  const endInfo = isoWeekInfo(end)
  if (!startInfo || !endInfo) {
    return { ...empty, message: '起止区间不是有效日期，无法受理排班。' }
  }
  if (dayIndex(end) < dayIndex(start)) {
    return { ...empty, message: '周期结束早于周期开始，不予受理。' }
  }
  if (startInfo.tag !== endInfo.tag) {
    return { ...empty, message: `起止区间跨周（${startInfo.tag} 至 ${endInfo.tag}），一周只能排一个班次，请拆开。` }
  }
  if (approver.trim() !== PATROL_APPROVER) {
    return { ...empty, message: `投运日期与巡线周期须由${PATROL_APPROVER}核定，当前操作人不具备排班权限。` }
  }

  const segments = listRows('secondarynet')
  const plans = listRows('patrolplan')
  const eligible = segments.filter((row) => rowText(row, '核定状态') === '已核定')
  const skippedUnapproved = segments.filter(
    (row) => rowText(row, '核定状态') !== '已核定' && rowText(row, 'status') !== '已废弃',
  ).length
  const skippedAbandoned = segments.filter((row) => rowText(row, 'status') === '已废弃').length

  const byWell = new Map<string, EntryRow[]>()
  for (const segment of eligible) {
    const well = rowText(segment, '阀门井编号')
    const bucket = byWell.get(well)
    if (bucket) {
      bucket.push(segment)
    } else {
      byWell.set(well, [segment])
    }
  }

  const occupied = new Set(
    plans
      .filter((row) => rowText(row, '排班周') === startInfo.tag)
      .map((row) => rowText(row, '阀门井编号')),
  )
  const blocked = [...occupied].filter((well) => byWell.has(well))
  if (blocked.length > 0) {
    return {
      ...empty,
      weekTag: startInfo.tag,
      message: `${startInfo.tag}（${startInfo.monday} 至 ${startInfo.sunday}）这些阀门井已排过班：${blocked.join('、')}。巡线班长每周只排一次班，重复排班已挡回。`,
    }
  }
  if (byWell.size === 0) {
    return {
      ...empty,
      weekTag: startInfo.tag,
      skippedUnapproved,
      skippedAbandoned,
      message:
        skippedUnapproved > 0
          ? `没有可排管段：还有 ${skippedUnapproved} 个非废弃管段的投运日期与巡线周期未经${PATROL_APPROVER}核定，先在二次管网页完成核定。`
          : '没有可排管段：没有任何已核定管段可供排班。',
    }
  }

  let nextId = plans.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  const created: EntryRow[] = []
  const leader = inspector.trim() || '巡线一班'
  for (const [well, items] of [...byWell.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], 'zh-Hans-CN'),
  )) {
    nextId += 1
    const sorted = [...items].sort((a, b) =>
      rowText(a, '管段编号').localeCompare(rowText(b, '管段编号'), 'zh-Hans-CN'),
    )
    const methods = [...new Set(sorted.map((row) => rowText(row, '敷设方式')))].join('/')
    const areas = [...new Set(sorted.map((row) => rowText(row, '所属片区')))].join('/')
    const commissionDates = sorted
      .map((row) => rowText(row, '投运日期'))
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .sort()
    created.push({
      id: nextId,
      status: '待巡线',
      pending: true,
      abnormal: false,
      计划编号: `PAT-${startInfo.year}${String(startInfo.week).padStart(2, '0')}-${String(created.length + 1).padStart(2, '0')}`,
      阀门井编号: well,
      管段编号: sorted.map((row) => rowText(row, '管段编号')).join('/'),
      所属片区: areas,
      敷设方式: methods,
      周期开始: start,
      周期结束: end,
      投运日期: commissionDates[0] ?? '',
      核定信息: `${approver.trim()}已核定`,
      排班周: startInfo.tag,
      巡线人: leader,
      巡线结果: '',
    })
  }

  saveRows('patrolplan', [...plans, ...created])
  return {
    ok: true,
    created,
    weekTag: startInfo.tag,
    skippedUnapproved,
    skippedAbandoned,
    message:
      `已为 ${startInfo.tag}（${startInfo.monday} 至 ${startInfo.sunday}）按阀门井排出 ${created.length} 张巡线单。` +
      (skippedUnapproved > 0 ? `另有 ${skippedUnapproved} 个管段未经核定未排入。` : '') +
      (skippedAbandoned > 0 ? `已废弃管段 ${skippedAbandoned} 个不排班。` : ''),
  }
}

// 班长核定二次管网管段的投运日期与巡线周期；核定后即锁定，倒序改动挡回。
export function approveSegment(id: number, approver: string, start: string, end: string): ActionResult {
  const rows = listRows('secondarynet')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的二次管网管段` }
  }
  if (approver.trim() !== PATROL_APPROVER) {
    return { ok: false, message: `只有${PATROL_APPROVER}能核定投运日期与巡线周期` }
  }
  if (!start || !end) {
    return { ok: false, message: '起止区间缺失不予受理：巡线周期的开始与结束必须成对填写。' }
  }
  if (dayIndex(end) < dayIndex(start)) {
    return { ok: false, message: '巡线周期结束早于开始，不予受理。' }
  }
  if (rowText(rows[index], '核定状态') === '已核定') {
    return { ok: false, message: `管段 ${rowText(rows[index], '管段编号')} 的投运日期与巡线周期已经核定，倒序改动已挡回。` }
  }
  const next = [...rows]
  next[index] = {
    ...rows[index],
    投运日期: start,
    巡线周期: `${start} 至 ${end}`,
    核定状态: '已核定',
    核定人: approver.trim(),
  }
  saveRows('secondarynet', next)
  return { ok: true, message: `管段 ${rowText(rows[index], '管段编号')} 的投运日期与巡线周期已由${approver.trim()}核定。` }
}

// 提交巡线完成：重复提交按第一次认，后续一律挡回；发现问题回写站点巡检的待整改清单。
export function completePatrolPlan(
  id: number,
  input: PatrolCompleteInput,
  operator: string,
): ActionResult {
  const rows = listRows('patrolplan')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的巡线计划单` }
  }
  const plan = rows[index]
  if (rowText(plan, 'status') === '已完成') {
    return { ok: false, message: `巡线单 ${rowText(plan, '计划编号')} 已完成，重复提交按第一次认，本次不覆盖既有结果。` }
  }

  const inspector = input.inspector?.trim() || operator.trim() || rowText(plan, '巡线人')
  const updated: EntryRow = {
    ...plan,
    status: '已完成',
    pending: false,
    abnormal: !input.normal,
    巡线人: inspector,
    巡线结果: input.normal ? '未见异常' : `发现问题：${input.issueText?.trim() || '管段异常，需整改'}`,
  }

  if (!input.normal) {
    const patrolRecords = listRows('stationpatrol')
    const recordId = patrolRecords.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
    const today = new Date().toISOString().slice(0, 10)
    const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const writeback: EntryRow = {
      id: recordId,
      status: '待整改',
      pending: true,
      abnormal: true,
      巡检编号: `ZG-${rowText(plan, '计划编号')}`,
      巡检站点: rowText(plan, '阀门井编号'),
      巡检路线: `二次管网巡线：${rowText(plan, '管段编号')}`,
      巡检人: inspector,
      巡检日期: today,
      发现问题数: 1,
      整改期限: deadline,
      巡检状态: '待整改',
    }
    saveRows('stationpatrol', [...patrolRecords, writeback])
  }

  const next = [...rows]
  next[index] = updated
  saveRows('patrolplan', next)
  return input.normal
    ? { ok: true, message: `巡线单 ${rowText(plan, '计划编号')} 已完成，未见异常。` }
    : { ok: true, message: `巡线单 ${rowText(plan, '计划编号')} 已完成，问题已回写到站点巡检待整改清单。` }
}

// 倒序改动挡回：状态只能沿状态机向前走，往回改一律不予受理。
function isBackward(meta: ModuleMeta, current: string, target: string): boolean {
  const currentIndex = meta.statuses.indexOf(current)
  const targetIndex = meta.statuses.indexOf(target)
  if (currentIndex < 0 || targetIndex < 0) {
    return false
  }
  return targetIndex < currentIndex
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (isBackward(meta, current, target)) {
    return { ok: false, message: `${meta.entity}当前为「${current}」，改回「${target}」属于倒序改动，已挡回。` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
