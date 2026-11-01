<template>
  <el-drawer v-model="visible" title="设置中心" size="400px" destroy-on-close>
    <el-tabs v-model="activeTab">
      <!-- 基础设置：源切换 -->
      <el-tab-pane label="基础设置" name="general">
        <div class="settings-section">
          <h4>切换当前视频源</h4>
          <el-select 
            v-model="currentSiteKey" 
            placeholder="请选择视频源" 
            style="width: 100%; margin-bottom: 20px;"
            @change="handleSiteChange"
          >
            <el-option v-for="s in store.savedSites" :key="s.key" :label="s.name" :value="s.key" />
          </el-select>

          <el-divider />
          
          <div class="setting-item">
            <div class="setting-info">
              <h4>自动去除 M3U8 视频广告</h4>
              <p>基于帧率指纹分析，自动识别并剔除视频流中的广告切片</p>
            </div>
            <el-switch v-model="store.enableAdFilter" @change="(val: any) => store.setAdFilter(val as boolean)" />
          </div>
        </div>
      </el-tab-pane>

      <!-- 源管理 -->
      <el-tab-pane label="源管理" name="sites">
        <div class="settings-section">
          <el-input
            v-model="rawJson"
            type="textarea"
            :rows="4"
            placeholder="输入单行接口 URL，或粘贴 JSON 配置"
          />
          <div class="actions">
            <el-button type="primary" :loading="loading" @click="handleImport">添加源</el-button>
            <el-upload action="#" :auto-upload="false" :show-file-list="false" accept=".json" @change="handleFile">
              <el-button>上传文件</el-button>
            </el-upload>
          </div>
          <el-alert v-if="error" :title="error" type="error" show-icon style="margin-top: 10px;" />

          <div class="list-wrap">
            <el-table :data="store.savedSites" border size="small">
              <el-table-column prop="name" label="名称" width="100" show-overflow-tooltip />
              <el-table-column prop="api" label="接口" show-overflow-tooltip />
              <el-table-column label="操作" width="60" align="center">
                <template #default="{ row }">
                  <el-button type="danger" link @click="store.removeSite(row.key)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <!-- 解析管理 -->
      <el-tab-pane label="解析接口" name="parses">
        <div class="settings-section">
          <div class="parse-list">
            <el-radio-group v-model="store.currentParseUrl" @change="store.setCurrentParse">
              <div v-for="(p, idx) in store.parses" :key="idx" class="parse-item">
                <el-radio :value="p.url" border style="flex: 1; overflow: hidden;">
                  <span style="font-weight: bold;">{{ p.name }}</span>
                </el-radio>
                <el-button type="danger" link @click="store.removeParse(idx)">删除</el-button>
              </div>
            </el-radio-group>
          </div>

          <div class="add-parse-form">
            <h4>添加解析接口</h4>
            <el-input v-model="newParseName" placeholder="名称" style="margin-bottom: 10px;" />
            <el-input v-model="newParseUrl" placeholder="地址 (例如: https://.../?url=)" style="margin-bottom: 10px;" />
            <el-button type="primary" @click="handleAddParse">添加</el-button>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useTvboxStore } from '@/stores/tvbox'
import { ElMessage, type UploadFile } from 'element-plus'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', val: boolean): void }>()

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const store = useTvboxStore()
const activeTab = ref('general')

const currentSiteKey = computed({
  get: () => store.currentSite?.key || '',
  set: () => {}
})

const rawJson = ref('')
const loading = ref(false)
const error = ref('')

const newParseName = ref('')
const newParseUrl = ref('')

function handleSiteChange(key: string) {
  const site = store.savedSites.find(s => s.key === key)
  if (site) {
    store.selectSite(site)
    ElMessage.success(`已切换至: ${site.name}`)
  }
}

function handleFile(file: UploadFile) {
  if (!file.raw) return
  const reader = new FileReader()
  reader.onload = (e) => { rawJson.value = String(e.target?.result ?? '') }
  reader.readAsText(file.raw, 'utf-8')
}

async function handleImport() {
  if (!rawJson.value.trim()) return ElMessage.warning('请输入内容')
  loading.value = true
  error.value = ''
  try {
    await store.importConfig(rawJson.value)
    rawJson.value = ''
    ElMessage.success('添加成功')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '解析失败'
  } finally {
    loading.value = false
  }
}

function handleAddParse() {
  if (!newParseUrl.value.trim()) return ElMessage.warning('请填写解析地址')
  store.addParse(newParseName.value.trim(), newParseUrl.value.trim())
  newParseName.value = ''
  newParseUrl.value = ''
  ElMessage.success('解析添加成功')
}
</script>

<style scoped>
.settings-section { padding: 10px 0; }
.actions { margin-top: 10px; display: flex; gap: 10px; }
.list-wrap { margin-top: 20px; }
.parse-item { display: flex; align-items: center; margin-bottom: 10px; width: 100%; }
.add-parse-form { margin-top: 20px; padding-top: 20px; border-top: 1px dashed #eee; }
.add-parse-form h4 { margin-bottom: 10px; font-size: 14px; }
.setting-item { display: flex; justify-content: space-between; align-items: center; padding: 15px; background: #f8f9fa; border-radius: 8px; }
.setting-info h4 { margin: 0 0 5px 0; font-size: 15px; color: #333; }
.setting-info p { margin: 0; font-size: 12px; color: #888; }
</style>