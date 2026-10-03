<template>
  <section class="page" data-module="stationpatrol">
    <header class="page-head">
      <div>
        <h2>站点巡检管理</h2>
        <p class="page-desc">
          站点巡检记录、二次管网巡检单与待整改清单。巡检单与「巡线计划」取同一份数据；巡线发现的问题回写到待整改清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡检记录</button>
        <button class="btn" type="button" @click="exportRows">导出站点巡检清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <nav class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-item"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </nav>

    <div v-if="activeTab === 'records'">
      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

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
                v-for="action in actionsFor(row)"
                :key="action"
                class="link"
                type="button"
                @click="runRowAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无站点巡检数据，可先登记巡检记录</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot"><span>共 {{ total }} 条站点巡检记录</span></footer>
    </div>

    <div v-else-if="activeTab === 'orders'">
      <p class="shared-hint">
        下面的巡检单与「巡线计划」是同一份数据：计划在巡线计划页排，这里只读呈现，排班与完成请到
        <RouterLink class="inline-link" to="/patrolplan">巡线计划</RouterLink>
        办理。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in orderColumns" :key="column">{{ column }}</th>
            <th>当前状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in orders" :key="String(row.id)">
            <td v-for="column in orderColumns" :key="column">{{ row[column] || '—' }}</td>
            <td>{{ row.status }}</td>
          </tr>
          <tr v-if="!orders.length">
            <td :colspan="orderColumns.length + 1" class="empty-state">暂无巡检单</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot"><span>共 {{ orders.length }} 张巡检单（数据源：巡线计划）</span></footer>
    </div>

    <div v-else>
      <p class="shared-hint">
        待整改清单来自站点巡检登记和二次管网巡线回写：巡线完成时勾选「发现问题」即生成一条待整改记录，编号以 ZG- 开头。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>整改操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rectifyRows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="runRowAction('确认整改', row)">确认整改</button>
            </td>
          </tr>
          <tr v-if="!rectifyRows.length">
            <td :colspan="columns.length + 2" class="empty-state">待整改清单为空</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot"><span>共 {{ rectifyRows.length }} 条待整改</span></footer>
    </div>

    <footer class="page-foot">
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('stationpatrol')
const columns = ['巡检编号', '巡检站点', '巡检路线', '巡检人', '巡检日期', '发现问题数', '整改期限', '巡检状态']
const orderColumns = [
  '计划编号',
  '阀门井编号',
  '管段编号',
  '周期开始',
  '周期结束',
  '巡线人',
  '巡线结果',
]
const tabs = [
  { key: 'records', label: '站点巡检' },
  { key: 'orders', label: '巡检单（巡线计划）' },
  { key: 'rectify', label: '待整改清单' },
]

const rows = ref<EntryRow[]>([])
const orders = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const activeTab = ref('records')
const filters = ref<Record<string, string>>({})
const filterFields = ['巡检编号', '巡检站点', '巡检路线']

const statuses = ['待巡检', '巡检中', '待整改', '已整改', '已上报']
const allRows = computed(() => listEntries(meta.key).items)
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: allRows.value.filter((row) => String(row.status) === status).length,
  })),
)
const rectifyRows = computed(() =>
  allRows.value.filter((row) => String(row.status) === '待整改'),
)
const stats = computed(() => [
  {
    label: '待巡检站点',
    value: allRows.value.filter((row) => String(row.status) === '待巡检').length,
  },
  { label: '待整改问题', value: rectifyRows.value.length },
  {
    label: '本月巡检次数',
    value: allRows.value.filter((row) => {
      const date = String(row.巡检日期 ?? '')
      return date.startsWith(new Date().toISOString().slice(0, 7))
    }).length,
  },
])

// 兼容既有巡线做法：不同状态下只给出能向前走的动作，倒序的不放出来。
function actionsFor(row: EntryRow): string[] {
  const status = String(row.status)
  if (status === '待巡检') {
    return ['提交巡检', '上报问题']
  }
  if (status === '巡检中') {
    return ['上报问题', '确认整改']
  }
  if (status === '待整改') {
    return ['确认整改']
  }
  return []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡检记录登记入口尚未接入审批流'
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

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    orders.value = listEntries('patrolplan').items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '站点巡检列表读取失败'
  }
}

onMounted(reload)
</script>
