<template>
  <section class="page" data-module="secondarynet">
    <header class="page-head">
      <div>
        <h2>二次管网巡线计划</h2>
        <p class="page-desc">
          条件定位管段：管段编号、所属片区、阀门井编号可检索，巡线周期按起止区间取并可排序，敷设方式多选，条件叠加取交集；巡线按阀门井编号分片，投运日期与巡线周期由巡线班长核定。
        </p>
      </div>
      <div class="page-actions">
        <label class="role-switch">
          <span>当前岗位</span>
          <select :value="role" @change="changeRole(($event.target as HTMLSelectElement).value as Role)">
            <option value="巡线班长">巡线班长</option>
            <option value="巡线员">巡线员</option>
          </select>
        </label>
        <button class="btn" type="button" @click="exportRows">导出巡线计划</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <!-- 巡线班长每周排一次班：同周重复排按第一次认 -->
    <section class="panel">
      <h3 class="panel-title">每周排班（巡线班长）</h3>
      <form class="panel-row" @submit.prevent="saveShift">
        <label class="filter-item">
          <span>周次（ISO 年-周序）</span>
          <input v-model="shiftForm.weekKey" placeholder="2026-W40" />
        </label>
        <label class="filter-item">
          <span>阀门井分片</span>
          <input v-model="shiftForm.valveShard" placeholder="如 VW-01、VW-02" />
        </label>
        <label class="filter-item">
          <span>巡线人</span>
          <input v-model="shiftForm.patrolMan" placeholder="本周该片区巡线人" />
        </label>
        <button class="btn primary" type="submit">排定本周班</button>
      </form>
      <table v-if="shifts.length" class="data-table shift-table">
        <thead>
          <tr><th>周次</th><th>阀门井分片</th><th>巡线人</th><th>排班人</th><th>排班时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in shifts" :key="item.weekKey">
            <td>{{ item.weekKey }}</td>
            <td>{{ item.valveShard }}</td>
            <td>{{ item.patrolMan }}</td>
            <td>{{ item.leader }}</td>
            <td>{{ item.createdAt.slice(0, 10) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="warn-text">本岗位每周排一次班，排定后同一周再排将按第一次认。</p>
    </section>

    <!-- 条件定位：交集检索 -->
    <form class="filter-bar patrol-filter" @submit.prevent="reload">
      <label class="filter-item">
        <span>管段编号</span>
        <input v-model="query.segmentKeyword" placeholder="如 SECO-10" />
      </label>
      <label class="filter-item">
        <span>阀门井编号</span>
        <input v-model="query.valveKeyword" placeholder="如 VW-01" />
      </label>
      <label class="filter-item">
        <span>所属片区</span>
        <input v-model="query.areaKeyword" placeholder="如 城东" />
      </label>
      <div class="filter-item">
        <span>敷设方式（多选取并集）</span>
        <div class="check-group">
          <label v-for="option in layingOptions" :key="option">
            <input
              type="checkbox"
              :value="option"
              :checked="query.laying.includes(option)"
              @change="toggleLaying(option)"
            />
            {{ option }}
          </label>
        </div>
      </div>
      <div class="filter-item">
        <span>巡线周期区间（天，起止成对）</span>
        <div class="range-box">
          <input v-model="query.cycleFrom" type="number" min="1" placeholder="起" />
          <span>～</span>
          <input v-model="query.cycleTo" type="number" min="1" placeholder="止" />
        </div>
      </div>
      <label class="filter-item">
        <span>周期排序</span>
        <select :value="query.sortAsc ? 'asc' : 'desc'" @change="changeSort(($event.target as HTMLSelectElement).value)">
          <option value="asc">周期升序</option>
          <option value="desc">周期倒序</option>
        </select>
      </label>
      <button class="btn primary" type="submit">定位查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 没命中讲清卡在哪一栏 -->
    <section v-if="searched && result && result.ok && result.total === 0" class="miss-panel">
      <strong>当前条件没有命中任何管段。</strong>
      <span>逐栏对照后，下面各栏各自挡掉了对应数量（条件之间为交集，挡得越多越是症结）：</span>
      <ul>
        <li v-for="miss in result.misses" :key="miss.column">
          <span class="miss-column">「{{ miss.column }}」</span>
          挡掉 {{ miss.blocked }} 条（现有值示例：{{ miss.sample }}）
        </li>
      </ul>
      <p v-if="!result.misses.length" class="warn-text">未填写任何条件却无数据，可能是管段台账尚未登记。</p>
    </section>
    <section v-else-if="result && !result.ok" class="miss-panel">
      <strong>查询不予受理：</strong>{{ result.message }}
    </section>

    <!-- 巡线按阀门井编号分片 -->
    <section v-for="group in groups" :key="group.valveNo" class="shard-block">
      <h3 class="shard-title">
        阀门井分片 {{ group.valveNo }}
        <span class="warn-text">（{{ group.items.length }} 段）</span>
      </h3>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>核定</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in group.items" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ formatCell(row, column) }}</td>
            <td>{{ row.status }}</td>
            <td>
              <span v-if="String(row['核定状态']) === '已核定'" class="badge ok" :title="`上次巡线：${row['巡线完成时间'] ?? '—'}`">已核定</span>
              <button v-else-if="role === '巡线班长'" class="link" type="button" @click="openApprove(row)">待核定 · 班长核定</button>
              <span v-else class="badge lock">待核定</span>
            </td>
            <td class="row-actions">
              <button class="link" type="button" @click="openComplete(row)">完成巡线</button>
              <button class="link" type="button" @click="runRowAction('安排检修', row)">安排检修</button>
              <button class="link" type="button" @click="runRowAction('报废管段', row)">报废管段</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <p v-if="searched && result?.ok && result.total === 0" class="empty-state">无命中结果，请按上方逐栏提示放宽条件。</p>

    <footer class="page-foot">
      <span>命中 {{ result?.total ?? 0 }} 条 · 共 {{ groups.length }} 个阀门井分片 · 数据与「站点巡检 / 巡检单」同源</span>
      <span v-if="message" :class="messageOk ? 'success-text' : 'error-text'">{{ message }}</span>
    </footer>

    <ApprovePlanModal :row="approveTarget" @close="approveTarget = null" @done="onActionDone" />
    <CompletePatrolModal :row="completeTarget" @close="completeTarget = null" @done="onActionDone" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  currentRoleName,
  currentWeekKey,
  forwardOnlyAction,
  queryPatrolPlans,
  scheduleWeeklyShift,
  setCurrentRole,
  weeklyShifts,
} from '@/api/patrol-service'
import { LAYING_OPTIONS } from '@/data/types'
import type { ActionResult, EntryRow, PatrolPlanResult, PatrolQuery, Role, ShiftSchedule } from '@/data/types'

import ApprovePlanModal from './ApprovePlanModal.vue'
import CompletePatrolModal from './CompletePatrolModal.vue'

const meta = moduleMeta('secondarynet')
const columns = ['管段编号', '所属片区', '公称管径', '敷设方式', '阀门井编号', '巡线周期', '投运日期', '巡线完成时间']
const layingOptions = [...LAYING_OPTIONS]

const role = ref<Role>(currentRoleName())
const searched = ref(false)
const result = ref<PatrolPlanResult | null>(null)
const message = ref('')
const messageOk = ref(false)

const query = ref<PatrolQuery>({
  segmentKeyword: '',
  valveKeyword: '',
  areaKeyword: '',
  laying: [],
  cycleFrom: '',
  cycleTo: '',
  sortAsc: true,
})

const shiftForm = ref({ weekKey: currentWeekKey(), valveShard: '', patrolMan: '' })
const shifts = ref<ShiftSchedule[]>([])
const approveTarget = ref<EntryRow | null>(null)
const completeTarget = ref<EntryRow | null>(null)

const groups = computed(() => result.value?.groups ?? [])

const stats = ref([
  { label: '阀门井分片数', value: 0 },
  { label: '待巡线管段', value: 0 },
  { label: '运行正常管段', value: 0 },
  { label: '待检修管段', value: 0 },
])

function changeRole(next: Role) {
  role.value = next
  setCurrentRole(next)
}

function toggleLaying(option: string) {
  const picked = new Set(query.value.laying)
  if (picked.has(option)) {
    picked.delete(option)
  } else {
    picked.add(option)
  }
  query.value.laying = [...picked]
}

function changeSort(value: string) {
  query.value.sortAsc = value === 'asc'
  reload()
}

function resetFilters() {
  query.value = {
    segmentKeyword: '',
    valveKeyword: '',
    areaKeyword: '',
    laying: [],
    cycleFrom: '',
    cycleTo: '',
    sortAsc: true,
  }
  reload()
}

function reload() {
  message.value = ''
  result.value = queryPatrolPlans(query.value)
  searched.value = true
  if (result.value.ok) {
    refreshStats()
  }
}

function refreshStats() {
  const all = result.value?.items ?? []
  stats.value = [
    { label: '阀门井分片数', value: groups.value.length },
    { label: '待巡线管段', value: all.filter((row) => row.status === '待巡线').length },
    { label: '运行正常管段', value: all.filter((row) => row.status === '运行正常').length },
    { label: '待检修管段', value: all.filter((row) => row.status === '待检修').length },
  ]
}

function formatCell(row: EntryRow, column: string): string {
  if (column === '巡线周期') {
    return row[column] === undefined || row[column] === '' ? '—' : `${row[column]} 天`
  }
  if (column === '巡线完成时间') {
    return row[column] ? String(row[column]) : '—'
  }
  return row[column] === undefined || row[column] === '' ? '—' : String(row[column])
}

function exportRows() {
  downloadEntries(meta.key)
}

function openApprove(row: EntryRow) {
  approveTarget.value = row
}

function openComplete(row: EntryRow) {
  completeTarget.value = row
}

function runRowAction(action: string, row: EntryRow) {
  onActionDone(forwardOnlyAction(meta.key, Number(row.id), action))
}

function saveShift() {
  onActionDone(scheduleWeeklyShift(shiftForm.value))
  shifts.value = weeklyShifts()
}

function onActionDone(outcome: ActionResult) {
  message.value = outcome.message
  messageOk.value = outcome.ok
  approveTarget.value = null
  completeTarget.value = null
  shifts.value = weeklyShifts()
  reload()
}

onMounted(() => {
  shifts.value = weeklyShifts()
  reload()
})
</script>
