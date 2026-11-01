<template>
  <el-dialog 
    :model-value="modelValue" 
    @update:model-value="emit('update:modelValue', $event)" 
    title="选择要下载的剧集" 
    width="500px"
  >
    <div class="select-header">
      <el-checkbox v-model="selectAll" @change="handleSelectAll">全选</el-checkbox>
      <span class="selected-count">已选 {{ selectedEps.length }} 集</span>
    </div>
    <div class="ep-list">
      <el-checkbox-group v-model="selectedEps">
        <el-checkbox v-for="ep in episodes" :key="ep.url" :value="ep">
          {{ ep.name }}
        </el-checkbox>
      </el-checkbox-group>
      <el-empty v-if="episodes.length === 0" description="当前线路无可下载资源" :image-size="60" />
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :disabled="selectedEps.length === 0" @click="handleConfirm">
        开始下载
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Episode } from '@/types/tvbox'

const props = defineProps<{
  modelValue: boolean
  episodes: Episode[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'confirm', selected: Episode[]): void
}>()

const selectedEps = ref<Episode[]>([])
const selectAll = ref(false)

// 弹窗打开时，如果只有一集，默认选中；如果有多集，清空选中
watch(() => props.modelValue, (val) => {
  if (val) {
    if (props.episodes.length === 1) {
      selectedEps.value = [...props.episodes]
      selectAll.value = true
    } else {
      selectedEps.value = []
      selectAll.value = false
    }
  }
})

function handleSelectAll(val: any) {
  if (val) {
    selectedEps.value = [...props.episodes]
  } else {
    selectedEps.value = []
  }
}

function handleConfirm() {
  emit('confirm', selectedEps.value)
  emit('update:modelValue', false)
}
</script>

<style scoped>
.select-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
  margin-bottom: 15px;
}
.selected-count {
  font-size: 13px;
  color: #888;
}
.ep-list {
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>