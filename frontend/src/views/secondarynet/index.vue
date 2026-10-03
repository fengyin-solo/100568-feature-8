<template>
  <section class="page" data-module="secondarynet">
    <header class="page-head">
      <div>
        <h2>二次管网管理</h2>
        <p class="page-desc">
          维护二次管网管段台账。管段编号、阀门井编号可检索，敷设方式多选，条件叠加取交集；投运日期与巡线周期由巡线班长核定后才能排入巡线计划。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记二次管网管段</button>
        <button class="btn" type="button" @click="exportRows">导出二次管网清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar filter-panel" @submit.prevent="reload">
      <label class="filter-item">
        <span>管段编号</span>
        <input v-model="filters.管段编号" placeholder="按管段编号检索" />
      </label>
      <label class="filter-item">
        <span>阀门井编号</span>
        <input v-model="filters.阀门井编号" placeholder="按阀门井编号检索" />
      </label>
      <label class="filter-item">
        <span>所属片区</span>
        <input v-model="filters.所属片区" placeholder="按所属片区检索" />
      </label>
      <fieldset class="filter-item multi-select">
        <legend>敷设方式（多选）</legend>
        <label v-for="method in layingMethods" :key="method" class="check-item">
          <input v-model="selectedMethods" type="checkbox" :value="method" />
          {{ method }}
        </label>
      </fieldset>
      <button class="btn" type="submit">条件定位</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="rows.length === 0 && hasCondition" class="diagnose-panel">
      <p class="diagnose-title">没有命中任何管段</p>
      <ul class="diagnose-list">
        <li v-if="filters.管段编号" :class="hitCount('管段编号') === 0 ? 'blocked-col' : 'ok-col'">
          「管段编号」含 {{ filters.管段编号 }}：单独命中 <strong>{{ hitCount('管段编号') }}</strong> 条
        </li>
        <li v-if="filters.阀门井编号" :class="hitCount('阀门井编号') === 0 ? 'blocked-col' : 'ok-col'">
          「阀门井编号」含 {{ filters.阀门井编号 }}：单独命中 <strong>{{ hitCount('阀门井编号') }}</strong> 条
        </li>
        <li v-if="filters.所属片区" :class="hitCount('所属片区') === 0 ? 'blocked-col' : 'ok-col'">
          「所属片区」含 {{ filters.所属片区 }}：单独命中 <strong>{{ hitCount('所属片区') }}</strong> 条
        </li>
        <li v-if="selectedMethods.length" :class="hitCount('敷设方式') === 0 ? 'blocked-col' : 'ok-col'">
          「敷设方式」取 {{ selectedMethods.join('、') }}：单独命中 <strong>{{ hitCount('敷设方式') }}</strong> 条
        </li>
      </ul>
      <p class="diagnose-msg">条件叠加取交集后为空；请按上面的单栏命中数放宽卡在 0 的那一栏。</p>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runRowAction(action, row)"
            >
              {{ action }}
            </button>
            <button
              v-if="textOf(row, '核定状态') !== '已核定'"
              class="link approve-link"
              type="button"
              @click="openApprove(row)"
            >
              班长核定
            </button>
            <span v-else class="muted-text">已核定锁定</span>
          </td>
        </tr>
        <tr v-if="!rows.length && !hasCondition">
          <td :colspan="columns.length + 2" class="empty-state">暂无二次管网数据，可先登记二次管网管段</td>
        </tr>
      </tbody>
    </table>

    <div v-if="approveTarget" class="modal-mask" @click.self="approveTarget = null">
      <div class="modal-card">
        <h3>巡线班长核定：{{ textOf(approveTarget, '管段编号') }}</h3>
        <p class="panel-hint">核定投运日期与巡线周期，起止区间必须成对；核定后锁定，倒序改动会被挡回。</p>
        <label class="filter-item">
          <span>投运日期 / 巡线周期开始</span>
          <input v-model="approveForm.start" type="date" />
        </label>
        <label class="filter-item">
          <span>巡线周期结束</span>
          <input v-model="approveForm.end" type="date" />
        </label>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="submitApprove">提交核定</button>
          <button class="btn ghost" type="button" @click="approveTarget = null">取消</button>
        </div>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条二次管网记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  LAYING_METHODS,
  PATROL_APPROVER,
  approveSegment,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('secondarynet')
const columns = [
  '管段编号',
  '所属片区',
  '公称管径',
  '敷设方式',
  '阀门井编号',
  '巡线周期',
  '投运日期',
  '核定状态',
  '核定人',
  '管段状态',
]
const actions = ['完成巡线', '安排检修', '报废管段']
const statuses = ['待巡线', '运行正常', '待检修', '已废弃']
const layingMethods = LAYING_METHODS

const rows = ref<EntryRow[]>([])
const allData = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const selectedMethods = ref<string[]>([])
const filters = reactive<Record<string, string>>({
  管段编号: '',
  阀门井编号: '',
  所属片区: '',
})
const approveTarget = ref<EntryRow | null>(null)
const approveForm = reactive({ start: '', end: '' })

const hasCondition = computed(
  () =>
    filters.管段编号.trim() !== '' ||
    filters.阀门井编号.trim() !== '' ||
    filters.所属片区.trim() !== '' ||
    selectedMethods.value.length > 0,
)
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: allData.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  {
    label: '运行正常管段',
    value: allData.value.filter((row) => String(row.status) === '运行正常').length,
  },
  {
    label: '待检修管段',
    value: allData.value.filter((row) => String(row.status) === '待检修').length,
  },
  {
    label: '待巡线管段',
    value: allData.value.filter((row) => String(row.status) === '待巡线').length,
  },
])

function textOf(row: EntryRow, field: string): string {
  return String(row[field] ?? '')
}

// 每一栏单独命中数：交集为空时讲清卡在哪一栏。
function hitCount(field: string): number {
  if (field === '敷设方式') {
    return allData.value.filter((row) =>
      selectedMethods.value.includes(textOf(row, '敷设方式')),
    ).length
  }
  const keyword = filters[field].trim()
  if (!keyword) {
    return allData.value.length
  }
  return allData.value.filter((row) => textOf(row, field).includes(keyword)).length
}

function applyConditions(source: EntryRow[]): EntryRow[] {
  return source.filter((row) => {
    const pipeHit = !filters.管段编号.trim() || textOf(row, '管段编号').includes(filters.管段编号.trim())
    const wellHit = !filters.阀门井编号.trim() || textOf(row, '阀门井编号').includes(filters.阀门井编号.trim())
    const areaHit = !filters.所属片区.trim() || textOf(row, '所属片区').includes(filters.所属片区.trim())
    const methodHit =
      selectedMethods.value.length === 0 || selectedMethods.value.includes(textOf(row, '敷设方式'))
    return pipeHit && wellHit && areaHit && methodHit
  })
}

function resetFilters() {
  filters.管段编号 = ''
  filters.阀门井编号 = ''
  filters.所属片区 = ''
  selectedMethods.value = []
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '二次管网管段登记入口尚未接入审批流'
}

function runRowAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function openApprove(row: EntryRow) {
  approveTarget.value = row
  approveForm.start = textOf(row, '投运日期')
  approveForm.end = ''
  errorMessage.value = ''
}

function submitApprove() {
  if (!approveTarget.value) {
    return
  }
  const result = approveSegment(
    Number(approveTarget.value.id),
    PATROL_APPROVER,
    approveForm.start,
    approveForm.end,
  )
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  approveTarget.value = null
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    allData.value = listEntries(meta.key).items
    const matched = applyConditions(allData.value)
    rows.value = matched
    total.value = matched.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '二次管网列表读取失败'
  }
}

onMounted(reload)
</script>
