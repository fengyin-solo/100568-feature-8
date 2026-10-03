<template>
  <section class="page" data-module="patrolplan">
    <header class="page-head">
      <div>
        <h2>巡线计划</h2>
        <p class="page-desc">
          二次管网巡线按阀门井编号分片排班。投运日期与巡线周期由巡线班长核定；巡线计划与站点巡检的巡检单取同一份数据。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openSchedule">本周排班</button>
        <button class="btn" type="button" @click="exportRows">导出巡线计划清单</button>
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
      <span class="legend-item">当前排班周：{{ weekTag }}</span>
    </p>

    <form class="filter-bar filter-panel" @submit.prevent="reload">
      <label class="filter-item">
        <span>管段编号</span>
        <input v-model="query.管段编号" placeholder="按管段编号检索，如 SECO-100" />
      </label>
      <label class="filter-item">
        <span>阀门井编号</span>
        <input v-model="query.阀门井编号" placeholder="按阀门井编号检索，如 FMJ-0" />
      </label>
      <label class="filter-item">
        <span>所属片区</span>
        <input v-model="query.所属片区" placeholder="按所属片区检索" />
      </label>
      <fieldset class="filter-item multi-select">
        <legend>敷设方式（多选）</legend>
        <label v-for="method in layingMethods" :key="method" class="check-item">
          <input v-model="selectedMethods" type="checkbox" :value="method" />
          {{ method }}
        </label>
      </fieldset>
      <label class="filter-item">
        <span>周期开始（起）</span>
        <input v-model="query.周期开始" type="date" />
      </label>
      <label class="filter-item">
        <span>周期结束（止）</span>
        <input v-model="query.周期结束" type="date" />
      </label>
      <label class="filter-item">
        <span>按周期排序</span>
        <select v-model="query.排序">
          <option value="">不排序</option>
          <option value="周期开始-asc">周期开始正序</option>
          <option value="周期开始-desc">周期开始倒序</option>
        </select>
      </label>
      <button class="btn" type="submit">条件定位</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="result.total === 0 && blockers.length > 0" class="diagnose-panel">
      <p class="diagnose-title">没有命中任何巡线计划</p>
      <ul class="diagnose-list">
        <li
          v-for="blocker in blockers"
          :key="blocker.field"
          :class="blocker.matched === 0 ? 'blocked-col' : 'ok-col'"
        >
          「{{ blocker.field }}」取 {{ blocker.expected }}：单独命中
          <strong>{{ blocker.matched }}</strong> 条
          <span v-if="blocker.matched === 0">——卡在这一栏</span>
        </li>
      </ul>
      <p class="diagnose-msg">{{ result.message }}</p>
    </div>
    <p v-else-if="result.message" class="diagnose-msg">{{ result.message }}</p>

    <div v-if="scheduleOpen" class="schedule-panel">
      <h3>本周排班（巡线班长每周一次）</h3>
      <div class="filter-bar">
        <label class="filter-item">
          <span>排班周区间·开始</span>
          <input v-model="scheduleForm.start" type="date" />
        </label>
        <label class="filter-item">
          <span>排班周区间·结束</span>
          <input v-model="scheduleForm.end" type="date" />
        </label>
        <label class="filter-item">
          <span>巡线人</span>
          <input v-model="scheduleForm.inspector" placeholder="默认 巡线一班" />
        </label>
        <button class="btn primary" type="button" @click="submitSchedule">按已核定管段生成巡线单</button>
        <button class="btn ghost" type="button" @click="scheduleOpen = false">收起</button>
      </div>
      <p class="panel-hint">
        起止区间必须成对、且同属一个自然周，跨周或缺一边不予受理；同一阀门井同一周已排过班的整批挡回。
      </p>
    </div>

    <div v-for="group in groups" :key="group.well" class="well-block">
      <h3 class="well-title">阀门井 {{ group.well }}（{{ group.items.length }} 张巡线单）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in group.items" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-if="String(row.status) === '待巡线'"
                class="link"
                type="button"
                @click="startRow(row)"
              >
                开始巡线
              </button>
              <button
                v-if="String(row.status) !== '已完成'"
                class="link"
                type="button"
                @click="openComplete(row)"
              >
                完成巡线
              </button>
              <span v-else class="muted-text">结果已按第一次提交锁定</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!groups.length && blockers.length === 0" class="empty-state">本周还没有巡线计划，请由巡线班长排班</p>

    <div v-if="completeTarget" class="modal-mask" @click.self="completeTarget = null">
      <div class="modal-card">
        <h3>完成巡线：{{ textOf(completeTarget, '计划编号') }}</h3>
        <p class="panel-hint">重复提交按第一次认；提交后结果锁定。发现问题会回写到站点巡检待整改清单。</p>
        <label class="modal-row">
          <input v-model="completeForm.normal" type="radio" :value="true" name="patrol-result" />
          巡线正常，未见异常
        </label>
        <label class="modal-row">
          <input v-model="completeForm.normal" type="radio" :value="false" name="patrol-result" />
          发现问题（回写站点巡检待整改清单）
        </label>
        <label v-if="!completeForm.normal" class="filter-item">
          <span>问题描述</span>
          <textarea v-model="completeForm.issueText" rows="3" placeholder="如：井盖周边路面沉降"></textarea>
        </label>
        <label class="filter-item">
          <span>巡线人</span>
          <input v-model="completeForm.inspector" :placeholder="textOf(completeTarget, '巡线人')" />
        </label>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="submitComplete">提交完成</button>
          <button class="btn ghost" type="button" @click="completeTarget = null">取消</button>
        </div>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ result.total }} 条巡线计划，按 {{ groups.length }} 个阀门井分片</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  LAYING_METHODS,
  PATROL_APPROVER,
  completePatrolPlan,
  currentWeekTag,
  downloadEntries,
  groupPatrolPlansByWell,
  listPatrolPlans,
  moduleMeta,
  runAction,
  scheduleWeekPatrol,
} from '@/api/local-service'
import type { EntryRow, PatrolListResult, PatrolQuery } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('patrolplan')
const session = useSessionStore()
const layingMethods = LAYING_METHODS
const columns = [
  '计划编号',
  '管段编号',
  '所属片区',
  '敷设方式',
  '周期开始',
  '周期结束',
  '投运日期',
  '核定信息',
  '排班周',
  '巡线人',
  '巡线结果',
]
const statuses = ['待巡线', '巡线中', '已完成']

const allRows = ref<EntryRow[]>([])
const result = ref<PatrolListResult>({ items: [], total: 0, blockers: [], message: '' })
const errorMessage = ref('')
const successMessage = ref('')
const weekTag = ref('')
const selectedMethods = ref<string[]>([])
const query = reactive<ViewQuery>({
  管段编号: '',
  阀门井编号: '',
  所属片区: '',
  敷设方式: [],
  周期开始: '',
  周期结束: '',
  排序: '',
})

type ViewQuery = Omit<PatrolQuery, '排序'> & { 排序: NonNullable<PatrolQuery['排序']> | '' }

const scheduleOpen = ref(false)
const scheduleForm = reactive({ start: '', end: '', inspector: '' })
const completeTarget = ref<EntryRow | null>(null)
const completeForm = reactive({ normal: true, issueText: '', inspector: '' })

const blockers = computed(() => result.value.blockers)
const groups = computed(() => groupPatrolPlansByWell(result.value.items))
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: allRows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '已排计划单', value: allRows.value.length },
  {
    label: '待/在巡计划单',
    value: allRows.value.filter((row) => ['待巡线', '巡线中'].includes(String(row.status))).length,
  },
  { label: '已完成计划单', value: allRows.value.filter((row) => String(row.status) === '已完成').length },
])

function textOf(row: EntryRow, field: string): string {
  return String(row[field] ?? '')
}

function resetFilters() {
  query.管段编号 = ''
  query.阀门井编号 = ''
  query.所属片区 = ''
  query.周期开始 = ''
  query.周期结束 = ''
  query.排序 = ''
  selectedMethods.value = []
  reload()
}

function openSchedule() {
  scheduleOpen.value = true
  errorMessage.value = ''
}

function submitSchedule() {
  errorMessage.value = ''
  successMessage.value = ''
  const payload = scheduleWeekPatrol(
    scheduleForm.start,
    scheduleForm.end,
    scheduleForm.inspector,
    PATROL_APPROVER,
  )
  if (!payload.ok) {
    errorMessage.value = payload.message
    return
  }
  successMessage.value = payload.message
  scheduleOpen.value = false
  reload()
}

function startRow(row: EntryRow) {
  errorMessage.value = ''
  const actionResult = runAction(meta.key, Number(row.id), '开始巡线')
  if (!actionResult.ok) {
    errorMessage.value = actionResult.message
    return
  }
  successMessage.value = actionResult.message
  reload()
}

function openComplete(row: EntryRow) {
  completeTarget.value = row
  completeForm.normal = true
  completeForm.issueText = ''
  completeForm.inspector = textOf(row, '巡线人')
  errorMessage.value = ''
}

function submitComplete() {
  if (!completeTarget.value) {
    return
  }
  if (!completeForm.normal && completeForm.issueText.trim() === '') {
    errorMessage.value = '发现问题时必须填写问题描述，才好回写待整改清单。'
    return
  }
  const actionResult = completePatrolPlan(
    Number(completeTarget.value.id),
    { normal: completeForm.normal, issueText: completeForm.issueText, inspector: completeForm.inspector },
    session.operator,
  )
  if (!actionResult.ok) {
    errorMessage.value = actionResult.message
    return
  }
  successMessage.value = actionResult.message
  completeTarget.value = null
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  query.敷设方式 = [...selectedMethods.value]
  const payload = listPatrolPlans({
    ...query,
    排序: query.排序 === '' ? undefined : query.排序,
  })
  result.value = payload
  const full = listPatrolPlans({})
  allRows.value = full.items
  weekTag.value = currentWeekTag()
}

onMounted(reload)
</script>
