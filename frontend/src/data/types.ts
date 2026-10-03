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

// 巡线计划的条件定位：管段编号/阀门井编号/片区检索，敷设方式多选，周期按起止区间，结果可排序。
export type PatrolQuery = {
  管段编号?: string
  阀门井编号?: string
  所属片区?: string
  敷设方式?: string[]
  周期开始?: string
  周期结束?: string
  排序?: '周期开始-asc' | '周期开始-desc'
}

// 每一栏条件单独的命中情况：最终没命中时，用它讲清楚卡在哪一栏。
export type PatrolFilterBlocker = {
  field: string
  expected: string
  matched: number
}

export type PatrolListResult = {
  items: EntryRow[]
  total: number
  blockers: PatrolFilterBlocker[]
  message: string
}

export type ScheduleResult = {
  ok: boolean
  message: string
  created: EntryRow[]
  weekTag: string
  skippedUnapproved: number
  skippedAbandoned: number
}

export type PatrolCompleteInput = {
  normal: boolean
  issueText?: string
  inspector?: string
}
