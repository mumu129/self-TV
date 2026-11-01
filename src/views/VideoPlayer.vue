<template>
  <div class="player-page">
    <div class="top-bar">
      <div class="left-btn" @click="$router.push('/')">
        <el-icon><HomeFilled /></el-icon> 回到主界面
      </div>
      <div class="center-title">{{ store.currentVideo?.name }}</div>
      <div class="window-controls">
        <button class="ctrl-btn" @click="minimize">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 6h10" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
        <button class="ctrl-btn" @click="maximize">
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
        <button class="ctrl-btn close" @click="close">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
      </div>
    </div>

    <div class="main-content">
      <div class="video-area">
        <div v-if="playError" class="error-mask">
          <el-alert :title="playError" type="error" show-icon :closable="false" style="max-width: 600px;" />
          <el-button type="primary" style="margin-top: 20px;" @click="forceReload">重新加载</el-button>
        </div>
        <video 
          v-show="!playError"
          ref="videoRef" 
          controls 
          autoplay 
          class="video-player" 
          @error="onVideoError"
          @playing="playError = ''"
          @timeupdate="onTimeUpdate"
          @seeked="onSeeked"
        />
      </div>

      <div class="side-panel" :class="{ 'is-collapsed': isPanelCollapsed }">
        <div class="panel-toggle" @click="isPanelCollapsed = !isPanelCollapsed">
          <el-icon><ArrowRight v-if="isPanelCollapsed" /><ArrowLeft v-else /></el-icon>
        </div>

        <div class="panel-content" v-show="!isPanelCollapsed">
          <div class="video-info">
            <h2 class="title">{{ store.currentVideo?.name }}</h2>
            <div class="meta">
              <span class="score" v-if="store.currentVideo?.remarks">{{ store.currentVideo.remarks }}</span>
              <span class="type">{{ store.currentVideo?.typeName }}</span>
              <span class="area">{{ store.currentVideo?.area }}</span>
            </div>
            
            <div class="actions">
              <el-button type="danger" plain @click="handleToggleFavorite">
                <el-icon style="margin-right: 4px;"><StarFilled v-if="isFav" /><Star v-else /></el-icon>
                {{ isFav ? '取消收藏' : '收藏' }}
              </el-button>
              <el-button type="primary" plain @click="handleBatchDownload">
                <el-icon style="margin-right: 4px;"><Download /></el-icon> 选集下载
              </el-button>
            </div>
          </div>

          <div class="episodes-section">
            <div class="section-title">
              <span>选集</span>
              <el-select v-if="playFroms.length > 1" v-model="currentFrom" size="small" style="width: 90px;" @change="handleFromChange">
                <el-option v-for="f in playFroms" :key="f" :label="f" :value="f" />
              </el-select>
            </div>
            
            <el-scrollbar class="ep-scroll">
              <div class="ep-grid">
                <div
                  v-for="(ep, idx) in displayEpisodes"
                  :key="idx"
                  class="ep-btn"
                  :class="{ active: currentEpUrl === ep.url }"
                  @click="playEpisodeByObj(ep)"
                >
                  {{ ep.name }}
                </div>
              </div>
            </el-scrollbar>
          </div>
        </div>
      </div>
    </div>

    <DownloadSelectDialog 
      v-model="downloadDialogVisible" 
      :episodes="downloadEps" 
      @confirm="handleStartDownload" 
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { HomeFilled, ArrowRight, ArrowLeft, Star, StarFilled, Download } from '@element-plus/icons-vue'
import Hls from 'hls.js'
import { ElMessage } from 'element-plus'
import { useTvboxStore } from '@/stores/tvbox'
import { cleanM3u8Ads } from '@/utils/adCleaner'
import DownloadSelectDialog from '@/components/DownloadSelectDialog.vue'
import type { Episode } from '@/types/tvbox'

const store = useTvboxStore()
const videoRef = ref<HTMLVideoElement | null>(null)

const currentEpUrl = ref('')
const playError = ref('')
const isPanelCollapsed = ref(false)

const downloadDialogVisible = ref(false)
const downloadEps = ref<Episode[]>([])

let hls: Hls | null = null
let currentBlobUrl: string | null = null
let originalUrl = ''
let lastSaveTime = 0

const isFav = computed(() => store.currentVideo ? store.isFavorite(store.currentVideo.id) : false)
const playFroms = computed(() => Array.from(new Set(store.episodes.map(ep => ep.from).filter(Boolean))) as string[])
const currentFrom = ref('')

const displayEpisodes = computed(() => {
  if (!currentFrom.value) return store.episodes
  return store.episodes.filter(ep => ep.from === currentFrom.value)
})

const minimize = () => window.electronAPI.minimize()
const maximize = () => window.electronAPI.maximize()
const close = () => window.electronAPI.close()

function handleFromChange() {
  const firstEp = displayEpisodes.value[0]
  if (firstEp) playEpisodeByObj(firstEp)
}

function playEpisodeByObj(ep: Episode, resume: number = 0) {
  if (videoRef.value && store.currentVideo && store.currentPlayEpisode && !store.currentPlayEpisode.url.startsWith('file://')) {
    store.updateHistory(store.currentVideo, store.currentPlayEpisode, Math.floor(videoRef.value.currentTime))
  }
  currentEpUrl.value = ep.url
  originalUrl = ep.url
  playError.value = ''
  lastSaveTime = resume
  store.setPlayEpisode(ep, resume)
  if (store.currentVideo) {
    store.updateHistory(store.currentVideo, ep, resume)
  }
  initPlayer(resume)
}

function onTimeUpdate() {
  if (!videoRef.value || !store.currentVideo || !store.currentPlayEpisode) return
  const currentTime = Math.floor(videoRef.value.currentTime)
  if (store.currentPlayEpisode.url.startsWith('file://')) return
  if (currentTime > 0 && currentTime - lastSaveTime >= 5) {
    store.updateHistory(store.currentVideo, store.currentPlayEpisode, currentTime)
    lastSaveTime = currentTime
  }
}

function onSeeked() {
  if (!videoRef.value || !store.currentVideo || !store.currentPlayEpisode) return
  const currentTime = Math.floor(videoRef.value.currentTime)
  if (!store.currentPlayEpisode.url.startsWith('file://')) {
    store.updateHistory(store.currentVideo, store.currentPlayEpisode, currentTime)
    lastSaveTime = currentTime
  }
}

function handleToggleFavorite() {
  if (!store.currentVideo) return
  store.toggleFavorite(store.currentVideo)
  ElMessage.success(isFav.value ? '已加入收藏' : '已取消收藏')
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
    ElMessage.success(`已将 ${selected.length} 集加入下载队列，请前往“我的下载”查看进度`)
  }
}

async function initPlayer(resumeTime: number = 0) {
  if (!videoRef.value) return
  if (hls) { hls.destroy(); hls = null }
  if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null }

  let url = originalUrl.trim()
  const video = videoRef.value
  if (!url) return
  if (url.startsWith('//')) url = 'https:' + url

  if (url.startsWith('file://')) {
    video.src = url
    const seekFn = () => { if (resumeTime > 0) video.currentTime = resumeTime; video.play().catch(() => {}) }
    video.addEventListener('loadedmetadata', seekFn, { once: true })
    return
  }

  const isWebPage = !url.includes('.m3u8') && !url.includes('.mp4') && (url.startsWith('http'))
  if (isWebPage) {
    const parseUrl = store.currentParseUrl
    if (!parseUrl) { playError.value = '需配置解析接口'; return }
    let finalUrl = parseUrl.includes('url=') ? parseUrl : (parseUrl.includes('?') ? `${parseUrl}&url=` : `${parseUrl}?url=`)
    url = `${finalUrl}${encodeURIComponent(originalUrl)}`
  }

  let finalPlayUrl = url
  const requestedUrl = originalUrl 

  if (finalPlayUrl.includes('.m3u8') && store.enableAdFilter) {
    try {
      const prevError = playError.value
      playError.value = '正在智能清理视频广告...'
      const cleaned = await cleanM3u8Ads(finalPlayUrl)
      if (requestedUrl !== originalUrl) return
      const blob = new Blob([cleaned], { type: 'application/vnd.apple.mpegurl' })
      currentBlobUrl = URL.createObjectURL(blob)
      finalPlayUrl = currentBlobUrl
      playError.value = prevError 
    } catch (e) {
      if (requestedUrl === originalUrl) playError.value = ''
    }
  }

  const seekToResume = () => {
    if (resumeTime > 0 && videoRef.value) videoRef.value.currentTime = resumeTime
  }

  if (finalPlayUrl.includes('.m3u8') || finalPlayUrl.startsWith('blob:')) {
    if (Hls.isSupported()) {
      hls = new Hls({ xhrSetup: (xhr) => { xhr.withCredentials = false } })
      hls.loadSource(finalPlayUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {})
        video.addEventListener('loadedmetadata', seekToResume, { once: true })
        setTimeout(() => {
          if (resumeTime > 0 && videoRef.value && Math.abs(videoRef.value.currentTime - resumeTime) > 2) seekToResume()
        }, 300)
      })
      hls.on(Hls.Events.ERROR, (event, data) => { if (data.fatal) playError.value = '视频加载失败。' })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = finalPlayUrl
      video.addEventListener('loadedmetadata', () => { seekToResume(); video.play().catch(() => {}) }, { once: true })
    }
  } else {
    video.src = finalPlayUrl
    video.addEventListener('loadedmetadata', () => { seekToResume(); video.play().catch(() => {}) }, { once: true })
  }
}

function onVideoError() { if (videoRef.value?.src) playError.value = '视频流加载失败。' }
function forceReload() { playError.value = ''; initPlayer() }

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden' && videoRef.value && store.currentVideo && store.currentPlayEpisode) {
    if (!store.currentPlayEpisode.url.startsWith('file://')) {
      store.updateHistory(store.currentVideo, store.currentPlayEpisode, Math.floor(videoRef.value.currentTime))
    }
  }
}

onMounted(() => { 
  const targetEp = store.currentPlayEpisode
  const resumeTime = store.resumeProgress

  if (targetEp) {
    currentFrom.value = targetEp.from || ''
    playEpisodeByObj(targetEp, resumeTime)
  } else if (store.episodes.length > 0) {
    currentFrom.value = store.episodes[0].from || ''
    playEpisodeByObj(store.episodes[0], 0)
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onBeforeUnmount(() => { 
  if (hls) hls.destroy()
  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  
  if (videoRef.value && store.currentVideo && store.currentPlayEpisode) {
    if (!store.currentPlayEpisode.url.startsWith('file://')) {
      store.updateHistory(store.currentVideo, store.currentPlayEpisode, Math.floor(videoRef.value.currentTime))
    }
  }
})
</script>

<style scoped>
.player-page { height: 100vh; display: flex; flex-direction: column; background-color: #fff; overflow: hidden; }
.top-bar { height: 48px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #eee; -webkit-app-region: drag; background-color: #fff; }
.left-btn { -webkit-app-region: no-drag; padding: 0 20px; display: flex; align-items: center; gap: 6px; cursor: pointer; color: #555; font-size: 14px; transition: color 0.2s; height: 100%; }
.left-btn:hover { color: #ff6b00; background-color: #f8f9fa; }
.center-title { font-size: 16px; font-weight: bold; color: #333; }
.window-controls { display: flex; -webkit-app-region: no-drag; height: 100%; }
/* 同步优化播放器窗口控制按钮 */
.ctrl-btn { width: 46px; height: 100%; border: none; background: transparent; color: #555; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
.ctrl-btn:hover { background-color: #f0f0f0; }
.ctrl-btn.close:hover { background-color: #e81123; color: white; }
.main-content { flex: 1; display: flex; overflow: hidden; background-color: #000; }
.video-area { flex: 1; display: flex; justify-content: center; align-items: center; position: relative; }
.video-player { width: 100%; height: 100%; max-height: 100vh; outline: none; }
.error-mask { position: absolute; inset: 0; background: rgba(0,0,0,0.85); display: flex; flex-direction: column; justify-content: center; align-items: center; z-index: 20; }
.side-panel { width: 380px; background-color: #fff; display: flex; flex-direction: column; position: relative; transition: width 0.3s ease; border-left: 1px solid #eee; }
.side-panel.is-collapsed { width: 0; }
.panel-toggle { position: absolute; left: -24px; top: 50%; transform: translateY(-50%); width: 24px; height: 60px; background-color: #fff; border: 1px solid #eee; border-right: none; border-radius: 8px 0 0 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: -2px 0 5px rgba(0,0,0,0.05); color: #666; z-index: 10; }
.panel-toggle:hover { color: #ff6b00; }
.panel-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.video-info { padding: 20px; border-bottom: 1px solid #eee; }
.video-info .title { font-size: 20px; font-weight: bold; margin-bottom: 10px; color: #333; }
.video-info .meta { display: flex; gap: 12px; font-size: 13px; color: #888; margin-bottom: 15px; }
.video-info .score { color: #ff6b00; font-weight: bold; }
.actions { display: flex; gap: 10px; }
.episodes-section { flex: 1; display: flex; flex-direction: column; overflow: hidden; padding: 20px; }
.section-title { font-size: 16px; font-weight: bold; color: #333; display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
.ep-scroll { flex: 1; }
.ep-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(70px, 1fr)); gap: 10px; padding-bottom: 20px; }
.ep-btn { padding: 10px 0; text-align: center; background-color: #f5f7fa; border-radius: 6px; font-size: 14px; color: #555; cursor: pointer; transition: all 0.2s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ep-btn:hover { background-color: #e6e8eb; }
.ep-btn.active { background-color: #ff6b00; color: #fff; font-weight: bold; box-shadow: 0 2px 8px rgba(255,107,0,0.3); }
</style>