/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// —— 二次管网巡线领域：巡线计划与站点巡检单共用下面这些结构 ——

// 敷设方式为受控枚举，筛选项与多选框都取这一份。
export const LAYING_OPTIONS = ['直埋', '管沟', '架空'] as const
export type LayingOption = (typeof LAYING_OPTIONS)[number]

// 只有巡线班长能核定投运日期/巡线周期、排周班、代表班组提交巡线完成。
export type Role = '巡线班长' | '巡线员'

// 巡线计划条件定位：管段编号/阀门井编号为包含检索，敷设方式多选取并集，
// 巡线周期按「天」的起止闭区间过滤；多个条件之间取交集。
export type PatrolQuery = {
  segmentKeyword: string
  valveKeyword: string
  areaKeyword: string
  laying: string[]
  cycleFrom: string
  cycleTo: string
  sortAsc: boolean
}

// 没命中时逐栏给出「被该栏挡掉多少条」，值班员一眼能看出卡在哪一栏。
export type ColumnMiss = {
  column: string
  blocked: number
  sample: string
}

export type PatrolGroup = {
  valveNo: string
  items: EntryRow[]
}

export type PatrolPlanResult = {
  ok: boolean
  message: string
  groups: PatrolGroup[]
  items: EntryRow[]
  total: number
  misses: ColumnMiss[]
}

// 巡线班长每周排一次班：同一周重复排班按第一次认。
export type ShiftSchedule = {
  weekKey: string
  valveShard: string
  leader: string
  patrolMan: string
  createdAt: string
}

export type PatrolCompleteInput = {
  id: number
  patrolMan: string
  foundIssues: number
  remark: string
  role: Role
}
