<template>
  <div class="detail-container" v-if="store.currentVideo">
    <header class="header">
      <el-button circle @click="$router.back()">←</el-button>
      <h2 class="title">{{ store.currentVideo.name }}</h2>
    </header>

    <main class="main-content" v-loading="store.loading">
      <div class="info-section">
        <div class="cover-box">
          <el-image :src="store.currentVideo.pic" fit="cover" class="cover">
            <template #error><div class="image-slot">暂无封面</div></template>
          </el-image>
        </div>

        <div class="text-info">
          <h1 class="movie-title">{{ store.currentVideo.name }} <span class="year">{{ store.currentVideo.year }}</span></h1>
          
          <div class="meta-list">
            <p><span class="label">类型：</span>{{ store.currentVideo.typeName }}</p>
            <p><span class="label">地区：</span>{{ store.currentVideo.area }}</p>
            <p><span class="label">导演：</span>{{ store.currentVideo.director || '暂无' }}</p>
            <p class="actor-line"><span class="label">主演：</span>{{ store.currentVideo.actor || '暂无' }}</p>
            <p><span class="label">备注：</span><span class="highlight">{{ store.currentVideo.remarks }}</span></p>
          </div>

          <el-button 
            :type="isFav ? 'warning' : 'default'" 
            style="margin-top: 20px;"
            @click="handleToggleFavorite"
          >
            <el-icon style="margin-right: 4px;"><StarFilled v-if="isFav" /><Star v-else /></el-icon>
            {{ isFav ? '已收藏' : '收藏影片' }}
          </el-button>

          <div class="intro-box">
            <h3>剧情简介</h3>
            <div class="intro-text" v-html="cleanHtml(store.currentVideo.content)"></div>
          </div>
        </div>
      </div>

      <div class="play-section">
        <div class="section-header">
          <h3 class="section-title">在线播放</h3>
          <el-button type="primary" plain @click="handleBatchDownload">
            <el-icon><Download /></el-icon> 选集下载
          </el-button>
        </div>
        
        <div class="play-lines" v-if="store.episodes.length > 0">
          <div class="line-switch" v-if="playFroms.length > 1">
            <span class="label">线路：</span>
            <el-radio-group v-model="currentFrom" size="small" @change="handleFromChange">
              <el-radio-button v-for="f in playFroms" :key="f" :value="f" />
            </el-radio-group>
          </div>

          <div class="episodes-grid">
            <div 
              v-for="(ep, idx) in displayEpisodes" 
              :key="idx" 
              class="ep-btn" 
              :class="{ 'is-last-watched': lastWatchedEpUrl === ep.url }"
              @click="handlePlay(ep)"
            >
              {{ ep.name }}
              <span v-if="lastWatchedEpUrl === ep.url" class="tag">上次看到</span>
            </div>
          </div>
        </div>
        <el-empty v-else description="暂无播放源" :image-size="60" />
      </div>
    </main>

    <DownloadSelectDialog 
      v-model="downloadDialogVisible" 
      :episodes="downloadEps" 
      @confirm="handleStartDownload" 
    />
  </div>

  <div v-else class="empty-container">
    <el-result icon="warning" title="数据丢失" sub-title="如果您刷新了页面，请重新从首页进入">
      <template #extra>
        <el-button type="primary" @click="$router.push('/')">返回首页</el-button>
      </template>
    </el-result>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useTvboxStore } from '@/stores/tvbox'
import { Star, StarFilled, Download } from '@element-plus/icons-vue'
import DownloadSelectDialog from '@/components/DownloadSelectDialog.vue'
import { ElMessage } from 'element-plus'
import type { Episode } from '@/types/tvbox'

const store = useTvboxStore()
const router = useRouter()
const currentFrom = ref('')

const downloadDialogVisible = ref(false)
const downloadEps = ref<Episode[]>([])

const isFav = computed(() => store.currentVideo ? store.isFavorite(store.currentVideo.id) : false)

const playFroms = computed(() => {
  const list = new Set<string>()
  store.episodes.forEach(ep => { if (ep.from) list.add(ep.from) })
  return Array.from(list)
})

const displayEpisodes = computed(() => {
  if (!currentFrom.value) return store.episodes
  return store.episodes.filter(ep => ep.from === currentFrom.value)
})

const lastWatchedEpUrl = computed(() => {
  if (!store.currentVideo) return ''
  const historyItem = store.historyList.find(h => h.video.id === store.currentVideo?.id)
  return historyItem ? historyItem.episodeUrl : ''
})

onMounted(() => {
  if (store.episodes.length > 0) {
    const m3u8From = store.episodes.find(ep => ep.url.includes('.m3u8'))?.from
    if (m3u8From) currentFrom.value = m3u8From
    else if (playFroms.value.length > 0) currentFrom.value = playFroms.value[0]
  }
})

function handleFromChange() {}

function cleanHtml(html: string) {
  if (!html) return '暂无简介'
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').substring(0, 300) + '...'
}

function handleToggleFavorite() {
  if (!store.currentVideo) return
  store.toggleFavorite(store.currentVideo)
  ElMessage.success(isFav.value ? '已加入收藏' : '已取消收藏')
}

function handlePlay(ep: Episode) {
  if (!store.currentVideo) return
  // 核心修复：从独立字典中精准获取这集的进度
  const resumeTime = store.getEpisodeProgress(store.currentVideo.id, ep.url)
  store.setPlayEpisode(ep, resumeTime)
  router.push('/player')
}

function handleBatchDownload() {
  if (!store.currentVideo || displayEpisodes.value.length === 0) return
  const validEps = displayEpisodes.value.filter(ep => ep.url.includes('.m3u8'))
  if (validEps.length === 0) return ElMessage.warning('当前线路不支持下载')
  downloadEps.value = validEps
  downloadDialogVisible.value = true
}

function handleStartDownload(selected: Episode[]) {
  if (store.currentVideo && selected.length > 0) {
    store.addToDownloadQueue(store.currentVideo, selected)
    ElMessage.success(`已将 ${selected.length} 集加入下载队列`)
  }
}
</script>

<style scoped>
/* 保持之前的样式不变 */
.detail-container { height: 100vh; background-color: #fff; color: #333; display: flex; flex-direction: column; }
.empty-container { height: 100vh; display: flex; justify-content: center; align-items: center; background: #f8f9fa; }
.header { height: 60px; background-color: #fff; border-bottom: 1px solid #eee; display: flex; align-items: center; padding: 0 20px; }
.header .title { margin-left: 16px; font-size: 18px; font-weight: bold; }
.main-content { flex: 1; overflow-y: auto; padding: 30px 10%; background-color: #f8f9fa; }

.info-section { display: flex; gap: 30px; background-color: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); margin-bottom: 30px; }
.cover-box { width: 240px; flex-shrink: 0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.cover { width: 100%; aspect-ratio: 3/4; }
.image-slot { display: flex; justify-content: center; align-items: center; width: 100%; height: 100%; background: #eee; color: #999; }

.text-info { flex: 1; }
.movie-title { font-size: 28px; margin: 0 0 20px 0; color: #333; }
.year { font-size: 16px; color: #999; font-weight: normal; margin-left: 10px; }
.meta-list p { margin: 8px 0; font-size: 14px; color: #555; }
.label { color: #888; }
.highlight { color: #ff6b00; font-weight: bold; }
.actor-line { line-height: 1.5; }

.intro-box { margin-top: 20px; }
.intro-box h3 { font-size: 16px; border-left: 4px solid #ff6b00; padding-left: 10px; margin-bottom: 10px; }
.intro-text { font-size: 14px; color: #666; line-height: 1.6; }

.play-section { background-color: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.section-title { font-size: 18px; border-left: 4px solid #ff6b00; padding-left: 10px; margin: 0; }
.line-switch { display: flex; align-items: center; margin-bottom: 20px; gap: 10px; }
.line-switch .label { color: #888; font-size: 14px; }

.episodes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 10px; }
.ep-btn { position: relative; background-color: #f0f2f5; color: #333; border: 1px solid #e4e7ed; padding: 10px 0; text-align: center; border-radius: 4px; font-size: 14px; cursor: pointer; transition: all 0.2s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ep-btn:hover { background-color: #ff6b00; color: #fff; border-color: #ff6b00; }
.ep-btn.is-last-watched { border-color: #ff6b00; color: #ff6b00; }
.tag { position: absolute; top: -1px; right: -1px; background-color: #ff6b00; color: #fff; font-size: 10px; padding: 2px 4px; border-bottom-left-radius: 4px; transform: scale(0.85); transform-origin: top right; }
</style>