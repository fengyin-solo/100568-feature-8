<template>
  <section class="page" data-module="stationpatrol">
    <header class="page-head">
      <div>
        <h2>站点巡检管理</h2>
        <p class="page-desc">
          巡检单与「二次管网巡线计划」取同一份数据，按阀门井编号分片；巡线发现的问题回写到待整改清单；站点巡检台账保留既有巡检做法。
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
      <button class="tab-btn" :class="{ active: tab === 'orders' }" type="button" @click="tab = 'orders'">
        巡检单（阀门井分片）
      </button>
      <button class="tab-btn" :class="{ active: tab === 'rect' }" type="button" @click="tab = 'rect'">
        待整改清单（{{ rectRows.length }}）
      </button>
      <button class="tab-btn" :class="{ active: tab === 'ledger' }" type="button" @click="tab = 'ledger'">
        站点巡检台账
      </button>
    </nav>

    <!-- 巡检单：与巡线计划同一份数据 -->
    <div v-if="tab === 'orders'">
      <p v-if="!orderGroups.length" class="empty-state">暂无可分片的巡线计划数据。</p>
      <section v-for="group in orderGroups" :key="group.valveNo" class="shard-block">
        <h3 class="shard-title">
          阀门井分片 {{ group.valveNo }}
          <span class="warn-text">（{{ group.items.length }} 段，与巡线计划同源）</span>
        </h3>
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="column in orderColumns" :key="column">{{ column }}</th>
              <th>当前状态</th>
              <th>可执行动作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in group.items" :key="String(row.id)">
              <td v-for="column in orderColumns" :key="column">{{ formatCell(row, column) }}</td>
              <td>{{ row.status }}</td>
              <td class="row-actions">
                <button class="link" type="button" @click="completeTarget = row">完成巡线</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- 待整改清单：巡线结果回写落地 -->
    <div v-else-if="tab === 'rect'">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in rectColumns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rectRows" :key="String(row.id)">
            <td v-for="column in rectColumns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="runLedgerAction('确认整改', row)">确认整改</button>
              <button class="link" type="button" @click="runLedgerAction('上报问题', row)">上报问题</button>
            </td>
          </tr>
          <tr v-if="!rectRows.length">
            <td :colspan="rectColumns.length + 2" class="empty-state">待整改清单为空：巡线发现问题后会自动回写到这里。</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 站点巡检台账：兼容既有巡线/巡检做法 -->
    <div v-else>
      <form class="filter-bar" @submit.prevent="reloadLedger">
        <label v-for="field in ledgerFilterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in ledgerColumns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in ledgerRows" :key="String(row.id)">
            <td v-for="column in ledgerColumns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in ledgerActions"
                :key="action"
                class="link"
                type="button"
                @click="runLedgerAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!ledgerRows.length">
            <td :colspan="ledgerColumns.length + 2" class="empty-state">暂无站点巡检数据，可先登记巡检记录</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ ledgerTotal }} 条站点巡检记录</span>
      </footer>
    </div>

    <footer class="page-foot">
      <span v-if="message" :class="messageOk ? 'success-text' : 'error-text'">{{ message }}</span>
    </footer>

    <CompletePatrolModal :row="completeTarget" @close="completeTarget = null" @done="onPatrolDone" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import { listRows } from '@/data/local-store'
import {
  currentRoleName,
  forwardOnlyAction,
  patrolOrdersByValve,
  rectificationList,
  setCurrentRole,
  todayString,
} from '@/api/patrol-service'
import type { ActionResult, EntryRow, Role } from '@/data/types'

import CompletePatrolModal from '@/views/secondarynet/CompletePatrolModal.vue'

const meta = moduleMeta('stationpatrol')
const orderColumns = ['管段编号', '所属片区', '公称管径', '敷设方式', '阀门井编号', '巡线周期', '投运日期', '巡线完成时间']
const rectColumns = ['巡检编号', '巡检站点', '巡检路线', '巡检人', '巡检日期', '发现问题数', '整改期限', '来源']
const ledgerColumns = ['巡检编号', '巡检站点', '巡检路线', '巡检人', '巡检日期', '发现问题数', '整改期限', '来源']
const ledgerActions = ['提交巡检', '确认整改', '上报问题']

const role = ref<Role>(currentRoleName())
const tab = ref<'orders' | 'rect' | 'ledger'>('orders')
const message = ref('')
const messageOk = ref(false)
const completeTarget = ref<EntryRow | null>(null)

const orderGroups = ref(patrolOrdersByValve())
const rectRows = ref(rectificationList())

const filters = ref<Record<string, string>>({})
const ledgerFilterFields = ['巡检编号', '巡检站点', '巡检人']
const ledgerRows = ref<EntryRow[]>([])
const ledgerTotal = ref(0)

const stats = computed(() => {
  const month = todayString().slice(0, 7)
  const monthly = listRows('secondarynet').filter((row) => String(row['巡线完成时间'] ?? '').startsWith(month)).length
  return [
    { label: '阀门井分片', value: orderGroups.value.length },
    { label: '待整改问题', value: rectRows.value.length },
    { label: '本月巡线次数', value: monthly },
    { label: '巡检记录总量', value: listRows(meta.key).length },
  ]
})

function changeRole(next: Role) {
  role.value = next
  setCurrentRole(next)
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

function resetFilters() {
  filters.value = {}
  reloadLedger()
}

function reloadLedger() {
  // 台账兼容既有巡检做法：人工巡检与巡线回写的记录都在，靠「来源」列区分。
  const payload = listEntries(meta.key, filters.value)
  ledgerRows.value = payload.items
  ledgerTotal.value = payload.total
}

function runLedgerAction(action: string, row: EntryRow) {
  onActionDone(forwardOnlyAction(meta.key, Number(row.id), action))
}

function exportRows() {
  downloadEntries(meta.key)
}

function onActionDone(outcome: ActionResult) {
  message.value = outcome.message
  messageOk.value = outcome.ok
  rectRows.value = rectificationList()
  orderGroups.value = patrolOrdersByValve()
  reloadLedger()
}

function onPatrolDone(outcome: ActionResult) {
  completeTarget.value = null
  onActionDone(outcome)
}

onMounted(() => {
  orderGroups.value = patrolOrdersByValve()
  rectRows.value = rectificationList()
  reloadLedger()
})
</script>
