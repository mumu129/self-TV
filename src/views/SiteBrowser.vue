<template>
  <div class="app-container">
    <!-- 顶部标题栏 -->
    <div class="title-bar">
      <div class="logo">TV</div>
      <div class="drag-region" data-tauri-drag-region></div>
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

    <el-container class="main-layout">
      <el-aside width="64px" class="sidebar">
        <el-scrollbar>
          <el-menu :default-active="currentView" :collapse="true" class="side-menu" @select="handleMenuSelect">
            <el-menu-item index="home"><el-icon><HomeFilled /></el-icon></el-menu-item>
            <el-menu-item index="history"><el-icon><Clock /></el-icon></el-menu-item>
            <el-menu-item index="favorite"><el-icon><Star /></el-icon></el-menu-item>
            <el-menu-item index="download"><el-icon><Download /></el-icon></el-menu-item>
          </el-menu>
        </el-scrollbar>
        <div class="sidebar-footer">
          <el-button circle type="primary" style="width: 100%;" @click="settingsVisible = true">
            <el-icon><Setting /></el-icon>
          </el-button>
        </div>
      </el-aside>

      <el-main class="main-content">
        <div class="header-container" :class="{ 'is-hidden': isHeaderHidden }">
          <div class="top-bar">
            <div class="left-tools">
              <div class="nav-groups" v-if="currentView === 'home' && !store.searchKeyword">
                <div v-if="store.categoryGroups.length === 0 && !store.loading" style="color: #999; font-size: 14px;">没有找到分类</div>
                <div v-for="g in store.categoryGroups" :key="g.id" class="nav-group-item" :class="{ active: store.currentGroupId === g.id }" @click="store.handleGroupChange(g.id)">{{ g.name }}</div>
              </div>
              <div v-else-if="currentView !== 'home'" class="page-title">{{ menuTitles[currentView] }}</div>
            </div>
            <div class="right-tools">
              <el-input v-if="currentView === 'home'" v-model="searchInput" placeholder="搜索..." class="search-input" clearable @keyup.enter="handleSearch" @clear="handleSearchClear">
                <template #append><el-button @click="handleSearch">搜索</el-button></template>
              </el-input>
              <el-button v-if="currentView === 'download' && store.downloads.length > 0" type="danger" plain @click="handleClearAll">清空已完成</el-button>
            </div>
          </div>

          <!-- 核心修改：只有存在 children 时，才显示二级分类栏 -->
          <div class="sub-bar" v-if="currentView === 'home' && currentGroup && currentGroup.children.length > 0 && !store.searchKeyword">
            <div v-for="c in currentGroup.children" :key="c.id" class="sub-item" :class="{ active: store.currentCategoryId === c.id }" @click="store.handleCategoryChange(c.id)">{{ c.name }}</div>
          </div>
        </div>

        <div class="scroll-wrapper" v-loading="store.loading && store.currentPage === 1" @scroll="handleScroll">
          <!-- 首页 -->
          <template v-if="currentView === 'home'">
            <el-empty v-if="!store.loading && store.videos.length === 0" description="暂无相关影片" />
            <div class="video-grid">
              <div class="video-card" v-for="v in store.videos" :key="v.id" @click="openVideoDetail(v)">
                <div class="cover-wrap">
                  <el-image :src="v.pic" fit="cover" class="cover" lazy><template #error><div class="image-slot">暂无封面</div></template></el-image>
                  <div class="remarks" v-if="v.remarks">{{ v.remarks }}</div>
                </div>
                <div class="info"><div class="title" :title="v.name">{{ v.name }}</div></div>
              </div>
            </div>
            <div class="loading-more" v-if="store.loading && store.currentPage > 1">正在加载更多...</div>
            <div class="no-more" v-if="!store.loading && store.videos.length > 0 && !store.hasMore">已经到底啦</div>
          </template>

          <!-- 历史记录 -->
          <template v-if="currentView === 'history'">
            <el-empty v-if="store.historyList.length === 0" description="暂无观看记录" />
            <div class="list-container">
              <div class="list-card" v-for="(h, idx) in store.historyList" :key="idx">
                <div class="card-cover" @click="resumePlay(h)">
                  <el-image :src="h.video.pic" fit="cover" />
                  <div class="play-icon">▶</div>
                </div>
                <div class="card-info" @click="resumePlay(h)">
                  <div class="card-title">{{ h.video.name }}</div>
                  <div class="card-sub">看到：{{ h.episodeName }} (进度 {{ formatTime(h.progress) }})</div>
                </div>
                <div class="card-right">
                  <el-button type="danger" plain @click.stop="store.removeHistory(idx)">删除</el-button>
                </div>
              </div>
            </div>
          </template>

          <!-- 我的收藏 -->
          <template v-if="currentView === 'favorite'">
            <el-empty v-if="store.favorites.length === 0" description="暂无收藏" />
            <div class="list-container">
              <div class="list-card" v-for="f in store.favorites" :key="f.video.id">
                <div class="card-cover" @click="openFavorite(f)">
                  <el-image :src="f.video.pic" fit="cover" />
                  <div class="play-icon">▶</div>
                </div>
                <div class="card-info" @click="openFavorite(f)">
                  <div class="card-title">{{ f.video.name }}</div>
                  <div class="card-sub">类型：{{ f.video.typeName }} | 备注：<span class="highlight">{{ f.video.remarks || '暂无' }}</span></div>
                </div>
                <div class="card-right">
                  <el-button type="primary" plain @click.stop="handleFavoriteDownload(f)" :loading="downloadingFavId === f.video.id">下载</el-button>
                  <el-button type="danger" plain @click.stop="store.removeFavorite(f.video.id, f.siteKey)">取消收藏</el-button>
                </div>
              </div>
            </div>
          </template>

          <!-- 我的下载 -->
          <template v-if="currentView === 'download'">
            <div v-if="store.downloadingTasks.length > 0" class="download-section">
              <h3 class="section-title">正在下载</h3>
              <div class="list-container">
                <div class="list-card downloading-card" v-for="task in store.downloadingTasks" :key="task.id">
                  <div class="card-cover">
                    <el-image :src="task.pic" fit="cover" />
                  </div>
                  <div class="card-info">
                    <div class="card-title">{{ task.videoName }} - {{ task.episodeName }}</div>
                    <div class="progress-wrapper">
                      <el-progress :percentage="Math.floor((task.progress / task.total) * 100)" :stroke-width="12" striped striped-flow />
                      <div class="progress-text">
                        {{ task.progress }} / {{ task.total }} 分片
                      </div>
                    </div>
                  </div>
                  <div class="card-right">
                    <el-button type="danger" plain @click.stop="store.cancelDownloadTask(task.id)">取消</el-button>
                  </div>
                </div>
              </div>
            </div>

            <div class="download-section" style="margin-top: 30px;">
              <h3 class="section-title" v-if="store.downloads.length > 0">已完成</h3>
              <el-empty v-if="store.downloads.length === 0 && store.downloadingTasks.length === 0" description="暂无下载内容" />
              <div class="list-container" v-if="store.downloads.length > 0">
                <div class="list-card" v-for="d in store.downloads" :key="d.id">
                  <div class="card-cover" @click="playDownloaded(d)">
                    <el-image :src="d.pic" fit="cover" />
                    <div class="play-icon">▶</div>
                  </div>
                  <div class="card-info" @click="playDownloaded(d)">
                    <div class="card-title">{{ d.videoName }} - {{ d.episodeName }}</div>
                    <div class="card-sub">下载时间：{{ new Date(d.createdAt).toLocaleString() }}</div>
                  </div>
                  <div class="card-right">
                    <el-button type="danger" plain @click.stop="store.removeDownload(d.id)">删除</el-button>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </el-main>
    </el-container>

    <SettingsDrawer v-model="settingsVisible" />
    <DownloadSelectDialog v-model="downloadDialogVisible" :episodes="downloadEps" @confirm="handleStartDownload" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useTvboxStore } from '@/stores/tvbox'
import { Setting, HomeFilled, Clock, Star, Download } from '@element-plus/icons-vue'
import SettingsDrawer from '@/components/SettingsDrawer.vue'
import DownloadSelectDialog from '@/components/DownloadSelectDialog.vue'
import type { VideoItem, HistoryItem, FavoriteItem, DownloadItem, Episode } from '@/types/tvbox'
import { ElMessageBox, ElMessage } from 'element-plus'
import { convertFileSrc } from '@tauri-apps/api/core'

const store = useTvboxStore()
const router = useRouter()

const settingsVisible = ref(false)
const searchInput = ref('')
const currentView = ref<'home' | 'history' | 'favorite' | 'download'>('home')

const isHeaderHidden = ref(false)
let lastScrollTop = 0

const menuTitles: Record<string, string> = { home: '首页推荐', history: '历史记录', favorite: '我的收藏', download: '我的下载' }
const currentGroup = computed(() => store.categoryGroups.find(g => g.id === store.currentGroupId))

const downloadDialogVisible = ref(false)
const downloadEps = ref<Episode[]>([])
const downloadVideo = ref<VideoItem | null>(null)
const downloadingFavId = ref('')

onMounted(() => {
  if (store.savedSites && store.savedSites.length > 0) {
    if (!store.currentSite) store.selectSite(store.savedSites[0])
  } else {
    settingsVisible.value = true
  }
})

const minimize = () => window.desktopAPI.minimize()
const maximize = () => window.desktopAPI.maximize()
const close = () => window.desktopAPI.close()

function handleMenuSelect(index: string) { currentView.value = index as any; isHeaderHidden.value = false }

async function handleSearch() {
  if (!searchInput.value.trim()) return
  await store.search(searchInput.value)
}

function handleSearchClear() {
  searchInput.value = ''
  store.searchKeyword = ''
  store.loadVideos()
}

function handleClearAll() {
  ElMessageBox.confirm('确定要清空所有已完成的下载记录吗？', '警告', {
    confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning'
  }).then(() => {
    store.clearDownloads()
    ElMessage.success('已清空')
  }).catch(() => {})
}

function handleScroll(e: Event) {
  const el = e.target as HTMLElement
  const scrollTop = el.scrollTop
  if (el.scrollHeight - scrollTop - el.clientHeight < 200) {
    if (store.hasMore && !store.loading && currentView.value === 'home') store.loadVideos(true)
  }
  if (scrollTop > lastScrollTop && scrollTop > 50) isHeaderHidden.value = true
  else if (scrollTop < lastScrollTop || scrollTop < 30) isHeaderHidden.value = false
  lastScrollTop = scrollTop <= 0 ? 0 : scrollTop
}

async function openVideoDetail(video: VideoItem) {
  const success = await store.openVideo(video)
  if (success) router.push('/detail')
}

async function openFavorite(f: FavoriteItem) {
  const site = store.savedSites.find(s => s.key === f.siteKey)
  if (!site) return
  const success = await store.openVideo(f.video, site)
  if (success) router.push('/detail')
}

async function resumePlay(h: HistoryItem) {
  const site = store.savedSites.find(s => s.key === h.siteKey)
  if (!site) return
  const success = await store.openVideo(h.video, site)
  if (success) {
    const ep = store.episodes.find(e => e.url === h.episodeUrl)
    if (ep) {
      const resumeTime = store.getEpisodeProgress(h.video.id, ep.url)
      store.setPlayEpisode(ep, resumeTime)
      router.push('/player')
    } else {
      router.push('/detail')
    }
  }
}

function playDownloaded(d: DownloadItem) {
  const localEp = { name: d.episodeName, url: convertFileSrc(d.m3u8Path) }
  store.currentVideo = { id: d.id, name: d.videoName, pic: d.pic, remarks: '', year: '', area: '', typeName: '', actor: '', director: '', content: '', playFrom: '', playUrl: '' }
  store.episodes = [localEp]
  store.setPlayEpisode(localEp, 0)
  router.push('/player')
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}分${s}秒`
}

async function handleFavoriteDownload(f: FavoriteItem) {
  const site = store.savedSites.find(s => s.key === f.siteKey)
  if (!site) return
  downloadingFavId.value = f.video.id
  try {
    const success = await store.openVideo(f.video, site)
    if (!success) throw new Error('获取剧集失败')
    const m3u8Eps = store.episodes.filter(e => e.url.includes('.m3u8'))
    if (m3u8Eps.length === 0) return ElMessage.warning('该影片暂无可下载的 m3u8 剧集')

    if (m3u8Eps.length === 1) {
      store.addToDownloadQueue(store.currentVideo!, m3u8Eps)
    } else {
      downloadVideo.value = store.currentVideo!
      downloadEps.value = m3u8Eps
      downloadDialogVisible.value = true
    }
  } catch (e) {
    ElMessage.error('获取下载信息失败')
  } finally {
    downloadingFavId.value = ''
  }
}

function handleStartDownload(selected: Episode[]) {
  if (downloadVideo.value && selected.length > 0) {
    store.addToDownloadQueue(downloadVideo.value, selected)
  }
}
</script>

<style scoped>
.app-container { height: 100vh; display: flex; flex-direction: column; background-color: #f8f9fa; overflow: hidden; }
.title-bar { height: 36px; background-color: #f0f2f5; display: flex; align-items: center; justify-content: space-between; -webkit-app-region: drag; user-select: none; border-bottom: 1px solid #e4e7ed; padding-left: 16px; flex-shrink: 0; }
.title-bar .logo { font-size: 16px; font-weight: 900; color: #ff6b00; letter-spacing: 1px; }
.drag-region { flex: 1; height: 100%; }
.window-controls { display: flex; -webkit-app-region: no-drag; }
.ctrl-btn { width: 46px; height: 36px; border: none; background: transparent; color: #555; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
.ctrl-btn:hover { background-color: #e4e7ed; }
.ctrl-btn.close:hover { background-color: #e81123; color: white; }

.main-layout { flex: 1; overflow: hidden; }
.sidebar { background-color: #fff; border-right: 1px solid #eee; display: flex; flex-direction: column; }
.side-menu { border-right: none; }
.side-menu .el-menu-item.is-active { background-color: #fff4ec; color: #ff6b00; border-right: 3px solid #ff6b00; }
.sidebar-footer { padding: 15px; border-top: 1px solid #f0f0f0; margin-top: auto; }

.main-content { padding: 0; display: flex; flex-direction: column; background-color: #f8f9fa; overflow: hidden; }
.header-container { transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); background-color: #fff; z-index: 10; box-shadow: 0 2px 8px rgba(0,0,0,0.02); }
.header-container.is-hidden { margin-top: -110px; opacity: 0; pointer-events: none; }

.top-bar { height: 64px; display: flex; align-items: center; justify-content: space-between; padding: 0 30px; border-bottom: 1px solid #eee; flex-shrink: 0; }
.left-tools { display: flex; align-items: center; flex: 1; overflow: hidden; }
.nav-groups { display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 25px; }
.nav-groups::-webkit-scrollbar { display: none; }
.nav-group-item { font-size: 16px; cursor: pointer; color: #333; font-weight: 500; transition: all 0.2s; white-space: nowrap; }
.nav-group-item:hover { color: #ff6b00; }
.nav-group-item.active { color: #ff6b00; font-weight: bold; }
.page-title { font-size: 20px; font-weight: bold; color: #333; }
.right-tools { display: flex; align-items: center; gap: 15px; }
.search-input { width: 300px; }

.sub-bar { padding: 10px 30px; border-bottom: 1px solid #eee; display: flex; flex-wrap: wrap; gap: 10px; flex-shrink: 0; }
.sub-item { font-size: 14px; cursor: pointer; color: #666; padding: 4px 12px; border-radius: 4px; background-color: #f8f9fa; transition: all 0.2s; }
.sub-item:hover { color: #ff6b00; }
.sub-item.active { color: #fff; background-color: #ff6b00; }

.scroll-wrapper { flex: 1; overflow-y: auto; padding: 20px 30px 30px; }
.video-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 20px; }
.video-card { cursor: pointer; transition: transform 0.2s; }
.video-card:hover { transform: translateY(-4px); }
.cover-wrap { position: relative; width: 100%; aspect-ratio: 3/4; border-radius: 6px; overflow: hidden; background-color: #e0e0e0; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
.cover { width: 100%; height: 100%; }
.image-slot { display: flex; justify-content: center; align-items: center; width: 100%; height: 100%; color: #999; }
.remarks { position: absolute; top: 0; right: 0; background: rgba(255, 107, 0, 0.9); color: #fff; padding: 2px 8px; font-size: 12px; font-weight: bold; border-bottom-left-radius: 6px; }
.info { padding-top: 8px; text-align: center; }
.title { font-size: 14px; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }

.list-container { display: flex; flex-direction: column; gap: 15px; }
.list-card { display: flex; align-items: center; background: #fff; padding: 15px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.03); }
.card-cover { position: relative; width: 120px; height: 160px; border-radius: 6px; overflow: hidden; cursor: pointer; flex-shrink: 0; }
.card-cover .el-image { width: 100%; height: 100%; }
.play-icon { position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; background: rgba(0,0,0,0.3); color: white; font-size: 40px; opacity: 0; transition: opacity 0.2s; }
.card-cover:hover .play-icon { opacity: 1; }
.card-info { margin-left: 20px; flex: 1; cursor: pointer; }
.card-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; color: #333; }
.card-title:hover { color: #ff6b00; }
.card-sub { font-size: 14px; color: #888; }
.card-sub .highlight { color: #ff6b00; font-weight: bold; }
.card-right { margin-left: 20px; flex-shrink: 0; display: flex; gap: 10px; }

.download-section { margin-bottom: 20px; }
.section-title { font-size: 18px; font-weight: bold; color: #333; margin-bottom: 15px; padding-left: 10px; border-left: 4px solid #ff6b00; }
.downloading-card { border: 1px solid #e4e7ed; }
.progress-wrapper { display: flex; align-items: center; gap: 15px; margin-top: 10px; }
.progress-wrapper .el-progress { flex: 1; }
.progress-text { font-size: 12px; color: #888; white-space: nowrap; }

.loading-more, .no-more { text-align: center; padding: 20px 0; color: #999; font-size: 14px; }
</style>