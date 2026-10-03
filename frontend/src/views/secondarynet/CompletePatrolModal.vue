<template>
  <div v-if="row" class="modal-mask" @click.self="$emit('close')">
    <form class="modal" @submit.prevent="submit">
      <h3>提交巡线完成</h3>
      <p class="modal-sub">
        管段 {{ row['管段编号'] }} · 阀门井 {{ row['阀门井编号'] }}（{{ row['所属片区'] }}）。
        重复提交按第一次认；发现问题会回写站点巡检的待整改清单。
      </p>
      <label>
        巡线人
        <input v-model="patrolMan" placeholder="实际巡线人姓名" />
      </label>
      <label>
        发现问题数
        <input v-model="foundIssues" type="number" min="0" step="1" placeholder="0 表示运行正常" />
      </label>
      <label>
        巡线备注
        <textarea v-model="remark" placeholder="井室、保温、泄漏等情况（可留空）"></textarea>
      </label>
      <div class="modal-actions">
        <button class="btn ghost" type="button" @click="$emit('close')">取消</button>
        <button class="btn primary" type="submit">确认完成</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import { completePatrol, currentRoleName } from '@/api/patrol-service'
import type { ActionResult } from '@/data/types'
import type { EntryRow } from '@/data/types'

const props = defineProps<{ row: EntryRow | null }>()
const emit = defineEmits<{
  (event: 'close'): void
  (event: 'done', result: ActionResult): void
}>()

const patrolMan = ref('')
const foundIssues = ref('0')
const remark = ref('')

watch(
  () => props.row,
  () => {
    patrolMan.value = ''
    foundIssues.value = '0'
    remark.value = ''
  },
)

function submit() {
  if (!props.row) {
    return
  }
  const result = completePatrol({
    id: Number(props.row.id),
    patrolMan: patrolMan.value,
    foundIssues: Number(foundIssues.value),
    remark: remark.value,
    role: currentRoleName(),
  })
  emit('done', result)
}
</script>
