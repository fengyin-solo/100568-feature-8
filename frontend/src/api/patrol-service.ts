import { moduleMeta, runAction as genericRunAction } from '@/api/local-service'
import {
  findShift,
  listRows,
  listShifts,
  saveRows,
  saveShift,
} from '@/data/local-store'
import type {
  ActionResult,
  ColumnMiss,
  EntryRow,
  PatrolCompleteInput,
  PatrolGroup,
  PatrolPlanResult,
  PatrolQuery,
  Role,
  ShiftSchedule,
} from '@/data/types'

// 二次管网巡线领域服务：巡线计划（二次管网页）与巡检单（站点巡检页）
// 都从同一份 secondarynet 数据取数，任何业务判断都不放到页面组件里。

const SECONDARY_KEY = 'secondarynet'
const PATROL_ORDER_KEY = 'stationpatrol'
const LEADER: Role = '巡线班长'

// 当前登录角色由页面顶部切换，默认巡线班长方便值班操作；核定/排班/代表班组完成巡线只认班长。
let currentRole: Role = LEADER

export function currentRoleName(): Role {
  return currentRole
}

export function setCurrentRole(role: Role): void {
  currentRole = role
}

export function todayString(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(base: string, days: number): string {
  const date = new Date(`${base}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// 按 ISO-8601 周序生成「年-W周序」键，巡线班长每周只能排一次班。
export function currentWeekKey(): string {
  const now = new Date()
  const thursday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  thursday.setUTCDate(thursday.getUTCDate() + 4 - ((thursday.getUTCDay() + 6) % 7))
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))
  const weekNo = 1 + Math.round((thursday.getTime() - yearStart.getTime()) / 7 / 86400000 - ((yearStart.getUTCDay() + 6) % 7) / 7)
  return `${thursday.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

function cycleDays(row: EntryRow): number {
  return Number(row['巡线周期'])
}

// 条件定位：各栏先独立判定，命中结果取交集；零命中时逐栏报「被挡掉多少条」。
export function queryPatrolPlans(query: PatrolQuery): PatrolPlanResult {
  const segment = query.segmentKeyword.trim()
  const valve = query.valveKeyword.trim()
  const area = query.areaKeyword.trim()
  const laying = query.laying
  const from = query.cycleFrom.trim()
  const to = query.cycleTo.trim()

  // 起止区间必须成对出现，只给一端的不予受理。
  if ((from === '') !== (to === '')) {
    const missing = from === '' ? '起始周期' : '截止周期'
    return {
      ok: false,
      message: `巡线周期须按起止区间成对填写，缺少${missing}的区间不予受理，请补齐后再查询。`,
      groups: [],
      items: [],
      total: 0,
      misses: [],
    }
  }
  if (from !== '' && to !== '' && Number(from) > Number(to)) {
    return {
      ok: false,
      message: `巡线周期区间不成立：起始 ${from} 天大于截止 ${to} 天，请调整起止顺序。`,
      groups: [],
      items: [],
      total: 0,
      misses: [],
    }
  }

  const rows = listRows(SECONDARY_KEY)
  const matchSegment = (row: EntryRow) => segment === '' || String(row['管段编号'] ?? '').includes(segment)
  const matchValve = (row: EntryRow) => valve === '' || String(row['阀门井编号'] ?? '').includes(valve)
  const matchArea = (row: EntryRow) => area === '' || String(row['所属片区'] ?? '').includes(area)
  const matchLaying = (row: EntryRow) => laying.length === 0 || laying.includes(String(row['敷设方式'] ?? ''))
  const matchCycle = (row: EntryRow) => {
    if (from === '' && to === '') {
      return true
    }
    const days = cycleDays(row)
    return days >= Number(from) && days <= Number(to)
  }

  const matched = rows.filter(
    (row) =>
      matchSegment(row) &&
      matchValve(row) &&
      matchArea(row) &&
      matchLaying(row) &&
      matchCycle(row),
  )

  const sorted = [...matched].sort((a, b) => {
    const diff = cycleDays(a) - cycleDays(b)
    if (diff !== 0) {
      return query.sortAsc ? diff : -diff
    }
    const code = String(a['管段编号']).localeCompare(String(b['管段编号']))
    return query.sortAsc ? code : -code
  })

  // 巡线按阀门井编号分片：同一阀门井的管段聚到一片，片序沿用排序后首次出现的顺序。
  const groups: PatrolGroup[] = []
  for (const row of sorted) {
    const valveNo = String(row['阀门井编号'] ?? '未分片')
    let group = groups.find((item) => item.valveNo === valveNo)
    if (!group) {
      group = { valveNo, items: [] }
      groups.push(group)
    }
    group.items.push(row)
  }

  // 没命中时讲清卡在哪一栏：对每个生效条件单独统计被挡数量，挡得越多越是症结。
  let misses: ColumnMiss[] = []
  if (matched.length === 0) {
    const conditions: { column: string; test: (row: EntryRow) => boolean; sample: (row: EntryRow) => string }[] = []
    if (segment !== '') {
      conditions.push({ column: '管段编号', test: matchSegment, sample: (row) => String(row['管段编号']) })
    }
    if (valve !== '') {
      conditions.push({ column: '阀门井编号', test: matchValve, sample: (row) => String(row['阀门井编号']) })
    }
    if (area !== '') {
      conditions.push({ column: '所属片区', test: matchArea, sample: (row) => String(row['所属片区']) })
    }
    if (laying.length > 0) {
      conditions.push({ column: '敷设方式', test: matchLaying, sample: (row) => String(row['敷设方式']) })
    }
    if (from !== '' || to !== '') {
      conditions.push({ column: '巡线周期', test: matchCycle, sample: (row) => `${cycleDays(row)}天` })
    }
    misses = conditions
      .map<ColumnMiss>((condition) => {
        const blockedRows = rows.filter((row) => !condition.test(row))
        return {
          column: condition.column,
          blocked: blockedRows.length,
          sample: blockedRows.length > 0 ? condition.sample(blockedRows[0]) : '—',
        }
      })
      .sort((a, b) => b.blocked - a.blocked)
  }

  return { ok: true, message: '', groups, items: sorted, total: sorted.length, misses }
}

// 巡线计划与巡检单共用一份数据：巡检单页直接按阀门井片组织同一份 secondarynet。
export function patrolOrdersByValve(): PatrolGroup[] {
  const result = queryPatrolPlans({
    segmentKeyword: '',
    valveKeyword: '',
    areaKeyword: '',
    laying: [],
    cycleFrom: '',
    cycleTo: '',
    sortAsc: true,
  })
  return result.groups
}

// 投运日期与巡线周期由巡线班长核定；核定后再倒序改动一律挡回。
export function approvePatrolPlan(
  id: number,
  payload: { commissionDate: string; cycleDays: string },
): ActionResult {
  if (currentRole !== LEADER) {
    return { ok: false, message: '只有巡线班长能核定投运日期与巡线周期，当前角色无权核定。' }
  }
  const rows = listRows(SECONDARY_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的二次管网管段` }
  }
  const target = rows[index]
  if (String(target['核定状态']) === '已核定') {
    return { ok: false, message: `管段 ${target['管段编号']} 已完成核定，倒序改动挡回；确需调整请另行走变更流程。` }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.commissionDate)) {
    return { ok: false, message: '投运日期缺失或格式不对（应为 YYYY-MM-DD），本次核定不予受理。' }
  }
  const days = Number(payload.cycleDays)
  if (!Number.isInteger(days) || days <= 0) {
    return { ok: false, message: '巡线周期缺失或不是正整数（天），本次核定不予受理。' }
  }
  const next: EntryRow = {
    ...target,
    投运日期: payload.commissionDate,
    巡线周期: days,
    核定状态: '已核定',
  }
  const updated = [...rows]
  updated[index] = next
  saveRows(SECONDARY_KEY, updated)
  return { ok: true, message: `管段 ${next['管段编号']} 已由巡线班长核定：投运日期 ${payload.commissionDate}，巡线周期 ${days} 天。` }
}

// 完成巡线：已完成的重复提交按第一次认；发现问题则回写站点巡检的待整改清单。
export function completePatrol(input: PatrolCompleteInput): ActionResult {
  if (input.role !== LEADER) {
    return { ok: false, message: '只有巡线班长能代表班组提交巡线完成，当前角色无权提交。' }
  }
  const patrolMan = input.patrolMan.trim()
  if (patrolMan === '') {
    return { ok: false, message: '巡线人不能为空，巡线完成不予受理。' }
  }
  const rows = listRows(SECONDARY_KEY)
  const index = rows.findIndex((row) => Number(row.id) === input.id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${input.id} 的二次管网管段` }
  }
  const target = rows[index]
  const segmentNo = String(target['管段编号'])
  const valveNo = String(target['阀门井编号'])

  if (String(target.status) === '已废弃') {
    return { ok: false, message: `管段 ${segmentNo} 已报废，不再安排巡线，完成动作挡回。` }
  }
  // 幂等：第一次提交落账后，再来的提交一律按第一次认，也不重复回写待整改清单。
  if (target['巡线完成时间']) {
    return {
      ok: true,
      message: `管段 ${segmentNo} 的巡线完成已按第一次提交认（${target['巡线完成时间']} 由 ${target['巡线人']} 提交），本次为重复提交，不再重复回写待整改清单。`,
    }
  }

  const finishedAt = todayString()
  const issues = Math.max(0, Math.floor(Number(input.foundIssues) || 0))
  const next: EntryRow = {
    ...target,
    status: '运行正常',
    管段状态: '运行正常',
    巡线完成时间: finishedAt,
    巡线人: patrolMan,
    发现问题数: issues,
    巡线备注: input.remark.trim(),
    pending: true,
    abnormal: issues > 0,
  }
  const updated = [...rows]
  updated[index] = next
  saveRows(SECONDARY_KEY, updated)

  if (issues > 0) {
    writeBackRectification(next, issues, patrolMan, finishedAt)
  }
  return {
    ok: true,
    message:
      issues > 0
        ? `管段 ${segmentNo} 巡线完成，发现 ${issues} 个问题，已回写站点巡检待整改清单（阀门井分片 ${valveNo}）。`
        : `管段 ${segmentNo} 巡线完成，未发现问题，状态置为运行正常。`,
  }
}

function writeBackRectification(row: EntryRow, issues: number, patrolMan: string, finishedAt: string): void {
  const orders = listRows(PATROL_ORDER_KEY)
  const nextId = orders.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1
  const digits = String(row['管段编号']).replace(/\D/g, '')
  const record: EntryRow = {
    id: nextId,
    status: '待整改',
    pending: true,
    abnormal: true,
    巡检编号: `PATR-${digits || nextId}`,
    巡检站点: `${row['阀门井编号']} 阀门井分片`,
    巡检路线: `二次管网 ${row['管段编号']}`,
    巡检人: `巡线班 ${patrolMan}`,
    巡检日期: finishedAt,
    发现问题数: issues,
    整改期限: addDays(finishedAt, 7),
    来源: '二次管网巡线',
    关联管段: row['管段编号'],
    巡检状态: '待整改',
  }
  saveRows(PATROL_ORDER_KEY, [...orders, record])
}

// 站点巡检的待整改清单：巡线回写与人工巡检发现的问题都在这里。
export function rectificationList(): EntryRow[] {
  return listRows(PATROL_ORDER_KEY).filter((row) => String(row.status) === '待整改')
}

export function weeklyShifts(): ShiftSchedule[] {
  return listShifts()
}

// 巡线班长每周排一次班：同一周重复排班按第一次认。
export function scheduleWeeklyShift(payload: {
  weekKey: string
  valveShard: string
  patrolMan: string
}): ActionResult {
  if (currentRole !== LEADER) {
    return { ok: false, message: '排班是巡线班长的职责，当前角色不能排周班。' }
  }
  if (!/^\d{4}-W\d{2}$/.test(payload.weekKey)) {
    return { ok: false, message: '周次格式不对（应为 2026-W40 这样的年-周序），排班不予受理。' }
  }
  if (payload.valveShard.trim() === '' || payload.patrolMan.trim() === '') {
    return { ok: false, message: '阀门井分片与巡线人都要填写，缺项的排班不予受理。' }
  }
  const existed = findShift(payload.weekKey)
  if (existed) {
    return {
      ok: false,
      message: `${payload.weekKey} 的班已在 ${existed.createdAt.slice(0, 10)} 由 ${existed.leader} 排过（分片 ${existed.valveShard}，巡线人 ${existed.patrolMan}），重复排班按第一次认。`,
    }
  }
  const schedule: ShiftSchedule = {
    weekKey: payload.weekKey,
    valveShard: payload.valveShard.trim(),
    leader: LEADER,
    patrolMan: payload.patrolMan.trim(),
    createdAt: new Date().toISOString(),
  }
  saveShift(schedule)
  return { ok: true, message: `${payload.weekKey} 周班已排定：阀门井分片 ${schedule.valveShard}，巡线人 ${schedule.patrolMan}。` }
}

// 倒序改动挡回：状态只能沿登记的状态序向前流转，回退一律拒绝。
export function forwardOnlyAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const row = rows.find((item) => Number(item.id) === id)
  if (row) {
    const target = meta.actionTargets[action]
    if (target) {
      const currentIndex = meta.statuses.indexOf(String(row.status))
      const targetIndex = meta.statuses.indexOf(target)
      if (currentIndex >= 0 && targetIndex >= 0 && targetIndex < currentIndex) {
        return {
          ok: false,
          message: `${meta.entity}当前为「${row.status}」，动作「${action}」要回到「${target}」，倒序改动挡回。`,
        }
      }
    }
  }
  return genericRunAction(key, id, action)
}
