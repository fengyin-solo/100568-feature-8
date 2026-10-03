<template>
  <div v-if="row" class="modal-mask" @click.self="$emit('close')">
    <form class="modal" @submit.prevent="submit">
      <h3>巡线班长核定</h3>
      <p class="modal-sub">
        管段 {{ row['管段编号'] }} · 阀门井 {{ row['阀门井编号'] }}。
        投运日期与巡线周期由巡线班长核定，核定后倒序改动挡回。
      </p>
      <label>
        投运日期
        <input v-model="commissionDate" type="date" />
      </label>
      <label>
        巡线周期（天）
        <input v-model="cycleDays" type="number" min="1" step="1" placeholder="如 7、14、30" />
      </label>
      <div class="modal-actions">
        <button class="btn ghost" type="button" @click="$emit('close')">取消</button>
        <button class="btn primary" type="submit">核定生效</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import { approvePatrolPlan } from '@/api/patrol-service'
import type { ActionResult, EntryRow } from '@/data/types'

const props = defineProps<{ row: EntryRow | null }>()
const emit = defineEmits<{
  (event: 'close'): void
  (event: 'done', result: ActionResult): void
}>()

const commissionDate = ref('')
const cycleDays = ref('')

watch(
  () => props.row,
  (row) => {
    commissionDate.value = row && typeof row['投运日期'] === 'string' ? String(row['投运日期']) : ''
    cycleDays.value = row && row['巡线周期'] ? String(row['巡线周期']) : ''
  },
)

function submit() {
  if (!props.row) {
    return
  }
  emit('done', approvePatrolPlan(Number(props.row.id), {
    commissionDate: commissionDate.value,
    cycleDays: cycleDays.value,
  }))
}
</script>
